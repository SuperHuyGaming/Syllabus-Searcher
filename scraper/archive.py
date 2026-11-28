"""Download every syllabus from the public site API into a local archive folder.

Uses only the Python standard library and ``requests``. No database credentials
or scraper internals are required.

Example:
    python archive.py --dest E:\\SyllabusArchive
    python archive.py --dest ./archive --api https://findmysyllabus.bentruong.dev --school gmu --dept CS
"""

import argparse
import csv
import logging
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlsplit

import requests

DEFAULT_API = "https://findmysyllabus.bentruong.dev"
DEFAULT_DELAY = 1.0
DEFAULT_TIMEOUT = 60

CSV_COLUMNS = [
    "code",
    "title",
    "term",
    "section",
    "instructors",
    "source",
    "sourceUrl",
    "fileId",
    "savedPath",
]

# Windows reserved device names (case-insensitive, even with an extension).
WINDOWS_RESERVED = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)

CONTENT_TYPE_EXT = {
    "application/pdf": "pdf",
    "text/html": "html",
    "application/xhtml+xml": "html",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
    "text/plain": "txt",
    "application/rtf": "rtf",
    "text/rtf": "rtf",
}

_INVALID_WIN_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f\x7f]')
_WHITESPACE = re.compile(r"\s+")
_DISPOSITION_FILENAME = re.compile(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', re.IGNORECASE)

log = logging.getLogger("archive")


def strip_school_prefix(code):
    """Strip a leading '<school>:' prefix if present (e.g. 'unc:COMP110' -> 'COMP110')."""
    text = str(code or "")
    return text.split(":", 1)[1] if ":" in text else text


def sanitize_name(value, max_len=120, fallback="Unknown"):
    """Sanitize a single path segment for safe use on Windows and POSIX filesystems."""
    text = str(value or "")
    text = _INVALID_WIN_CHARS.sub("_", text)
    text = _WHITESPACE.sub(" ", text).strip(" .")
    if not text:
        text = fallback
    if len(text) > max_len:
        text = text[:max_len].rstrip(" .")
        if not text:
            text = fallback
    stem = text.split(".", 1)[0].upper()
    if stem in WINDOWS_RESERVED:
        text = f"_{text}"
        if len(text) > max_len:
            text = text[:max_len].rstrip(" .")
    return text


def sanitize_filename(stem, ext, max_len=120):
    """Build a Windows-safe '<stem>.<ext>' filename within max_len characters."""
    clean_ext = re.sub(r"[^a-z0-9]", "", str(ext or "").lstrip(".").lower()) or "bin"
    max_stem = max(1, max_len - len(clean_ext) - 1)
    safe_stem = sanitize_name(stem, max_len=max_stem)
    return f"{safe_stem}.{clean_ext}"


def extension_for(content_type=None, content_disposition=None, source_url=None, default="bin"):
    """Infer a file extension from Content-Type, Content-Disposition, or sourceUrl."""
    if content_type:
        mime = str(content_type).split(";", 1)[0].strip().lower()
        if mime in CONTENT_TYPE_EXT:
            return CONTENT_TYPE_EXT[mime]

    if content_disposition:
        match = _DISPOSITION_FILENAME.search(str(content_disposition))
        if match:
            suffix = Path(match.group(1).strip()).suffix.lstrip(".").lower()
            if re.fullmatch(r"[a-z0-9]{1,6}", suffix):
                return suffix

    if source_url:
        suffix = Path(urlsplit(str(source_url)).path).suffix.lstrip(".").lower()
        if re.fullmatch(r"[a-z0-9]{1,6}", suffix):
            return suffix

    return default


class RateLimiter:
    """Enforces a minimum interval between requests with injectable sleep/clock."""

    def __init__(self, delay=DEFAULT_DELAY, sleep=time.sleep, clock=time.monotonic):
        self.delay = float(delay)
        self.sleep = sleep
        self.clock = clock
        self._last = None

    def wait(self):
        if self.delay <= 0:
            return
        now = self.clock()
        if self._last is not None:
            remaining = self.delay - (now - self._last)
            if remaining > 0:
                self.sleep(remaining)
                now = self.clock()
        self._last = now


def _parse_content_length(headers):
    raw = headers.get("Content-Length") if headers else None
    if raw is None:
        return None
    try:
        size = int(str(raw).strip())
        return size if size >= 0 else None
    except ValueError:
        return None


def _reported_size(offering):
    for key in ("size", "length", "fileSize"):
        val = offering.get(key)
        if isinstance(val, int) and val > 0:
            return val
    return None


def _format_instructors(value, sep=", "):
    if isinstance(value, list):
        parts = [str(v).strip() for v in value if str(v).strip()]
        return sep.join(parts)
    return str(value or "").strip()


class Archiver:
    """Downloads all syllabi exposed by the public API into a local directory tree."""

    def __init__(
        self,
        api_base=DEFAULT_API,
        dest="SyllabusArchive",
        session=None,
        delay=DEFAULT_DELAY,
        timeout=DEFAULT_TIMEOUT,
        sleep=time.sleep,
        clock=time.monotonic,
    ):
        self.api_base = str(api_base).rstrip("/")
        self.dest = Path(dest)
        self.session = session or requests.Session()
        self.limiter = RateLimiter(delay=delay, sleep=sleep, clock=clock)
        self.timeout = timeout

    def _get(self, path, params=None, stream=False):
        self.limiter.wait()
        url = f"{self.api_base}{path}"
        resp = self.session.get(url, params=params, stream=stream, timeout=self.timeout)
        resp.raise_for_status()
        return resp

    def _get_json(self, path, params=None):
        resp = self._get(path, params=params)
        return resp.json()

    def build_dest_path(self, school, dept, code, offering, ext, used_paths):
        """Compute `<dest>/<school>/<DEPT>/<CODE>/<Term> - <Section> - <Instructor>.<ext>`."""
        safe_school = sanitize_name(school, fallback="unknown")
        safe_dept = sanitize_name(strip_school_prefix(dept).upper(), fallback="UNKNOWN")
        safe_code = sanitize_name(strip_school_prefix(code).upper(), fallback="UNKNOWN")

        term = offering.get("termLabel") or offering.get("termKey") or "Unknown Term"
        section = offering.get("section") or "Unknown"
        instructor = _format_instructors(offering.get("instructors"), sep=", ") or "Unknown"

        stem = f"{term} - {section} - {instructor}"
        filename = sanitize_filename(stem, ext)
        candidate = self.dest / safe_school / safe_dept / safe_code / filename

        file_id = str(offering.get("fileId") or "")
        if candidate in used_paths and used_paths[candidate] != file_id:
            suffix = file_id[:8] if file_id else str(len(used_paths))
            filename = sanitize_filename(f"{stem} ({suffix})", ext)
            candidate = self.dest / safe_school / safe_dept / safe_code / filename

        used_paths[candidate] = file_id
        return candidate

    def _download_offering(self, school, dept, code, offering, used_paths):
        """Download one syllabus file if not already present with matching size.

        Returns `(dest_path, status)` where status is `'downloaded'`, `'existing'`, or `'skipped'`.
        """
        file_id = offering.get("fileId")
        if not file_id:
            return None, "skipped"

        known_ext = extension_for(
            content_type=offering.get("contentType"),
            source_url=offering.get("sourceUrl"),
            default=None,
        )
        dest_path = None
        if known_ext:
            dest_path = self.build_dest_path(school, dept, code, offering, known_ext, used_paths)
            reported = _reported_size(offering)
            if dest_path.exists() and reported is not None and dest_path.stat().st_size == reported:
                return dest_path, "existing"

        resp = self._get(f"/api/syllabi/{quote(str(file_id), safe='')}", stream=True)
        try:
            if dest_path is None:
                ext = extension_for(
                    content_type=resp.headers.get("Content-Type"),
                    content_disposition=resp.headers.get("Content-Disposition"),
                    source_url=offering.get("sourceUrl"),
                )
                dest_path = self.build_dest_path(school, dept, code, offering, ext, used_paths)

            remote_size = _parse_content_length(resp.headers)
            if dest_path.exists() and remote_size is not None and dest_path.stat().st_size == remote_size:
                return dest_path, "existing"

            dest_path.parent.mkdir(parents=True, exist_ok=True)
            part_path = dest_path.with_name(dest_path.name + ".part")
            try:
                with part_path.open("wb") as fh:
                    for chunk in resp.iter_content(chunk_size=65536):
                        if chunk:
                            fh.write(chunk)
                os.replace(part_path, dest_path)
            except BaseException:
                if part_path.exists():
                    part_path.unlink(missing_ok=True)
                raise
            return dest_path, "downloaded"
        finally:
            resp.close()

    def run(self, schools_filter=None, depts_filter=None):
        """Archive all matching schools/departments and write `<dest>/catalog.csv`."""
        self.dest.mkdir(parents=True, exist_ok=True)
        wanted_schools = {s.strip().lower() for s in (schools_filter or []) if s.strip()}
        wanted_depts = {d.strip().upper() for d in (depts_filter or []) if d.strip()}

        schools_payload = self._get_json("/api/schools")
        schools = schools_payload.get("schools") or []

        used_paths = {}
        rows = []
        counts = {"downloaded": 0, "existing": 0, "skipped": 0, "failed": 0}

        for school_obj in schools:
            school_key = str(school_obj.get("key") or "").strip().lower()
            if not school_key:
                continue
            if wanted_schools and school_key not in wanted_schools:
                continue

            depts_payload = self._get_json("/api/departments", params={"school": school_key})
            departments = depts_payload.get("departments") or []

            for dept_obj in departments:
                dept_code = dept_obj.get("code") or ""
                bare_dept = strip_school_prefix(dept_obj.get("display") or dept_code).upper()
                if wanted_depts and bare_dept not in wanted_depts:
                    continue
                if dept_obj.get("withSyllabi") == 0:
                    continue

                courses_payload = self._get_json(
                    "/api/courses",
                    params={"dept": dept_code, "school": school_key},
                )
                courses = courses_payload.get("courses") or []

                for course_obj in courses:
                    if course_obj.get("hasSyllabi") is False:
                        continue
                    code = course_obj.get("code") or ""
                    if not code:
                        continue

                    try:
                        detail = self._get_json(f"/api/courses/{quote(code, safe=':')}")
                    except requests.RequestException as err:
                        log.warning("Failed to fetch course %s: %s", code, err)
                        counts["failed"] += 1
                        continue

                    course_code = detail.get("code") or code
                    course_dept = detail.get("dept") or dept_code or bare_dept
                    course_title = detail.get("title") or course_obj.get("title") or ""

                    for offering in detail.get("offerings") or []:
                        try:
                            dest_path, status = self._download_offering(
                                school_key, course_dept, course_code, offering, used_paths
                            )
                        except requests.RequestException as err:
                            log.warning("Failed to download %s (%s): %s", course_code, offering.get("fileId"), err)
                            counts["failed"] += 1
                            continue

                        counts[status] += 1
                        if dest_path is None:
                            continue

                        rows.append(
                            {
                                "code": course_code,
                                "title": offering.get("title") or course_title,
                                "term": offering.get("termLabel") or offering.get("termKey") or "",
                                "section": offering.get("section") or "",
                                "instructors": _format_instructors(offering.get("instructors"), sep="; "),
                                "source": offering.get("source") or "",
                                "sourceUrl": offering.get("sourceUrl") or "",
                                "fileId": offering.get("fileId") or "",
                                "savedPath": dest_path.relative_to(self.dest).as_posix(),
                            }
                        )

        self._write_catalog(rows)
        counts["total"] = len(rows)
        return counts

    def _write_catalog(self, rows):
        catalog_path = self.dest / "catalog.csv"
        part_path = self.dest / "catalog.csv.part"
        with part_path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
            writer.writeheader()
            writer.writerows(rows)
        os.replace(part_path, catalog_path)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--dest",
        required=True,
        help=r"Destination directory for downloaded syllabi and catalog.csv (e.g. E:\SyllabusArchive)",
    )
    parser.add_argument(
        "--api",
        default=DEFAULT_API,
        help=f"Base URL of the public site API (default: {DEFAULT_API})",
    )
    parser.add_argument(
        "--school",
        default="",
        help="Optional comma-separated school keys to archive (e.g. gmu,unc); default all schools",
    )
    parser.add_argument(
        "--dept",
        default="",
        help="Optional comma-separated department codes to archive (e.g. CS,MATH); default all departments",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY,
        help=f"Minimum seconds between API requests (default: {DEFAULT_DELAY})",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT,
        help=f"Per-request timeout in seconds (default: {DEFAULT_TIMEOUT})",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    schools = [s for s in args.school.split(",") if s.strip()] if args.school else None
    depts = [d for d in args.dept.split(",") if d.strip()] if args.dept else None

    archiver = Archiver(
        api_base=args.api,
        dest=args.dest,
        delay=args.delay,
        timeout=args.timeout,
    )
    counts = archiver.run(schools_filter=schools, depts_filter=depts)
    log.info(
        "Archived %d syllabi (%d downloaded, %d unchanged, %d failed)",
        counts["total"],
        counts["downloaded"],
        counts["existing"],
        counts["failed"],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
