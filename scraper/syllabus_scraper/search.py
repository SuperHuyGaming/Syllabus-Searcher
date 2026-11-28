"""Discovers GMU syllabi for courses with zero coverage via Google Custom Search JSON API.

Budget:
- Hard cap of 100 queries/day (default 95) tracked in MongoDB `search_usage`
  ({_id: 'YYYY-MM-DD', queries: int}) so repeated runs share the daily quota.

State:
- Searched courses are recorded in MongoDB `search_state`
  ({_id: 'gmu:CS 310', school: 'gmu', code: 'CS 310', lastSearched: <datetime>})
  and skipped for 90 days.

Host policy:
- *.gmu.edu, d101vc9winf8ln.cloudfront.net -> download, verify, save LINK-ONLY (pool.link).
- web.archive.org -> normalize to raw id_ URL, download, verify, save LINK-ONLY.
- sites.google.com, docs.google.com, drive.google.com, github.com, gmu.box.com, archive.org
  -> download, verify, save COPY (pool.save).
- www.studocu.com, www.coursehero.com -> HINTS ONLY in MongoDB `syllabus_hints`;
  NEVER downloaded, fetched, linked, or stored.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import io
import logging
import os
import re
import time
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
import zipfile

import requests

from . import coverage, listings, rules, sources
from .listings import MAX_FILE_BYTES, dept_of, mentions_course
from .parse import Row, parse_term
from .schools import DEFAULT_SCHOOL
from .text import MAX_CHARS, extract_text

log = logging.getLogger("scraper")

CUSTOM_SEARCH_URL = "https://www.googleapis.com/customsearch/v1"
DEFAULT_DAILY_BUDGET = 95
MAX_DAILY_BUDGET = 100
SEARCH_COOLDOWN_DAYS = 90
MIN_DOWNLOAD_DELAY = 1.0
SOURCE_NAME = "gmu-search"

DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

SYLLABUS_KEYWORDS = (
    "grading",
    "office hours",
    "prerequisite",
    "schedule",
    "textbook",
    "course description",
    "learning outcomes",
    "attendance",
)
MIN_SYLLABUS_KEYWORDS = 2

LINK_ONLY_HOSTS = {"d101vc9winf8ln.cloudfront.net"}
WAYBACK_HOST = "web.archive.org"
COPY_HOSTS = {
    "sites.google.com",
    "docs.google.com",
    "drive.google.com",
    "github.com",
    "gmu.box.com",
    "archive.org",
}
HINT_DOMAIN_SUFFIXES = ("studocu.com", "coursehero.com")

WAYBACK_RE = re.compile(
    r"^https?://web\.archive\.org/web/(?P<ts>\d{1,14})(?:[a-z]{2}_)?/(?P<orig>.+)$",
    re.I,
)
SECTION_RE = re.compile(
    r"\b(?:section|sec\.?)\s*[:#-]?\s*(0?\d{2,3}|DL\d|H\d{2}|[A-Z]\d{2})\b",
    re.I,
)
INSTRUCTOR_RE = re.compile(
    r"\b(?i:instructor|professor|lecturer|faculty)\s*:\s*"
    r"(?:(?i:dr|prof)\.?\s+)?"
    r"([A-Z][a-zA-Z'\u2019-]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-zA-Z'\u2019-]+)",
)


@dataclass(frozen=True)
class UnknownTerm:
    key: str = "0000-0"
    label: str = "Unknown term"


UNKNOWN_TERM = UnknownTerm()


def validate_budget(budget):
    """Refuses budgets outside [0, MAX_DAILY_BUDGET] to protect the 100/day free quota."""
    if isinstance(budget, bool) or not isinstance(budget, int):
        raise ValueError(f"search budget must be an integer (got {budget!r})")
    if budget < 0 or budget > MAX_DAILY_BUDGET:
        raise ValueError(f"search budget must be between 0 and {MAX_DAILY_BUDGET} (got {budget})")
    return budget


def classify_host(url):
    """Returns 'hint', 'wayback', 'link', 'copy', or None for an unsupported host."""
    host = (urlsplit(url).hostname or "").lower().rstrip(".")
    if not host:
        return None
    if any(host == suffix or host.endswith(f".{suffix}") for suffix in HINT_DOMAIN_SUFFIXES):
        return "hint"
    if host == WAYBACK_HOST:
        return "wayback"
    if host == "gmu.edu" or host.endswith(".gmu.edu") or host in LINK_ONLY_HOSTS:
        return "link"
    if host in COPY_HOSTS:
        return "copy"
    return None


def normalize_wayback_url(url):
    """Converts a web.archive.org capture URL to its raw id_ form, or None if not a capture URL."""
    match = WAYBACK_RE.match((url or "").strip())
    if not match:
        return None
    return f"https://web.archive.org/web/{match.group('ts')}id_/{match.group('orig')}"


def build_queries(code):
    """Returns (primary_query, fallback_query) for a course code like 'CS 310'."""
    display = coverage.display_code(code)
    compact = re.sub(r"\s+", "", display)
    return (
        f'"{display}" syllabus "George Mason"',
        f"{compact} syllabus gmu",
    )


def detect_file_type(data, url, header_content_type=None):
    """Detects PDF, DOCX, or HTML within MAX_FILE_BYTES. Returns content-type string or None."""
    if not data or len(data) > MAX_FILE_BYTES:
        return None
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                if "word/document.xml" in zf.namelist():
                    return DOCX_CONTENT_TYPE
        except zipfile.BadZipFile:
            return None
        return None
    head = data[:512].lstrip().lower()
    path = urlsplit(url).path.lower()
    hdr = (header_content_type or "").split(";", 1)[0].strip().lower()
    if head.startswith((b"<!doctype html", b"<html")) or path.endswith((".html", ".htm")) or hdr == "text/html":
        return "text/html; charset=utf-8"
    return None


def extract_docx_text(data):
    """Extracts plain text from a DOCX zip archive without external dependencies."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            xml_bytes = zf.read("word/document.xml")
        root = ET.fromstring(xml_bytes)
        text = " ".join(part for part in root.itertext() if part)
    except Exception as err:  # noqa: BLE001
        log.warning("Couldn't read DOCX text: %s", err)
        return ""
    return re.sub(r"\s+", " ", text).strip()[:MAX_CHARS]


def extract_document_text(data, content_type):
    if content_type == DOCX_CONTENT_TYPE:
        return extract_docx_text(data)
    return extract_text(data, content_type)


def is_syllabus_text(text):
    """True when extracted text contains at least MIN_SYLLABUS_KEYWORDS syllabus markers."""
    lower = (text or "").lower()
    matches = sum(1 for kw in SYLLABUS_KEYWORDS if kw in lower)
    return matches >= MIN_SYLLABUS_KEYWORDS


def compute_text_hash(text):
    normalized = re.sub(r"\s+", " ", (text or "")).strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def verify_syllabus(data, url, compact_code, header_content_type=None):
    """Validates file type, size, course mention, and syllabus keywords.
    Returns (content_type, text, text_hash) or None."""
    content_type = detect_file_type(data, url, header_content_type=header_content_type)
    if not content_type:
        return None

    text = extract_document_text(data, content_type)
    if not text:
        return None

    # Reuse listings.mentions_course. For PDF/DOCX, check extracted text through mentions_course
    # since listings.mentions_course trusts non-HTML bytes directly.
    if content_type.startswith("text/html"):
        if not mentions_course(data, content_type, [compact_code]):
            return None
    else:
        if not mentions_course(text.encode("utf-8"), "text/html; charset=utf-8", [compact_code]):
            return None

    if not is_syllabus_text(text):
        return None

    return content_type, text, compute_text_hash(text)


def parse_term_from_result(text, snippet="", title="", url=""):
    """Parses Term from syllabus text, falling back to snippet/title/url, else UNKNOWN_TERM."""
    for candidate in (text, snippet, title, url):
        term = parse_term(candidate or "")
        if term:
            return term
    return UNKNOWN_TERM


def parse_section_from_text(text):
    match = SECTION_RE.search(text or "")
    return match.group(1).upper() if match else "N/A"


def parse_instructor_from_text(text):
    match = INSTRUCTOR_RE.search(text or "")
    return [match.group(1).strip()] if match else ["Staff"]


def _as_utc(dt):
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class BudgetTracker:
    """Tracks daily Google Custom Search API usage in MongoDB `search_usage`."""

    def __init__(self, db, limit=DEFAULT_DAILY_BUDGET, today=None):
        self.db = db
        self.limit = min(validate_budget(limit), MAX_DAILY_BUDGET)
        day = today if today is not None else datetime.now(timezone.utc).date()
        self.day_key = day.strftime("%Y-%m-%d")

    def used(self):
        doc = self.db["search_usage"].find_one({"_id": self.day_key})
        return int((doc or {}).get("queries", 0))

    def remaining(self):
        return max(0, self.limit - self.used())

    def can_spend(self):
        return self.remaining() > 0

    def spend(self):
        if not self.can_spend():
            return False
        self.db["search_usage"].update_one(
            {"_id": self.day_key},
            {"$inc": {"queries": 1}},
            upsert=True,
        )
        return True


def select_targets(db, school=DEFAULT_SCHOOL, now=None, cooldown_days=SEARCH_COOLDOWN_DAYS):
    """Returns uncovered course display codes ordered by department size desc, then catalog order,
    excluding courses searched within `cooldown_days`."""
    school = (school or DEFAULT_SCHOOL).strip().lower()
    now = now if now is not None else datetime.now(timezone.utc)
    cutoff = now - timedelta(days=cooldown_days)

    cov = coverage.get_or_compute_coverage(db, school=school, now=now)
    departments = sorted(
        cov.get("departments") or [],
        key=lambda d: (-d.get("courses", 0), -d.get("withoutSyllabi", 0), d.get("dept", "")),
    )

    targets = []
    state_col = db["search_state"]
    for dept in departments:
        missing = sorted(dept.get("missingCourses") or [], key=coverage.natural_sort_key)
        for code in missing:
            display = coverage.display_code(code)
            state = state_col.find_one({"_id": f"{school}:{display}"})
            if state and state.get("lastSearched") is not None:
                if _as_utc(state["lastSearched"]) > cutoff:
                    continue
            targets.append(display)
    return targets


def mark_searched(db, school, code, now=None):
    display = coverage.display_code(code)
    now = now if now is not None else datetime.now(timezone.utc)
    doc = {
        "_id": f"{school}:{display}",
        "school": school,
        "code": display,
        "lastSearched": now,
    }
    db["search_state"].replace_one({"_id": doc["_id"]}, doc, upsert=True)


def save_hint(db, school, code, url, title, snippet, host, now=None):
    """Records a hint-only result (e.g. Studocu / CourseHero) without fetching its file."""
    display = coverage.display_code(code)
    now = now if now is not None else datetime.now(timezone.utc)
    doc = {
        "code": display,
        "school": school,
        "url": url,
        "title": title or "",
        "snippet": snippet or "",
        "host": host,
        "foundAt": now,
    }
    db["syllabus_hints"].update_one({"code": display, "url": url}, {"$set": doc}, upsert=True)


def google_search(session, query, api_key, cx, num=10):
    """Executes one Google Custom Search JSON API query and returns its `items` list."""
    try:
        res = session.get(
            CUSTOM_SEARCH_URL,
            params={"key": api_key, "cx": cx, "q": query, "num": num},
            timeout=30,
        )
    except requests.RequestException as err:
        log.warning("Google search request failed for %r: %s", query, err.__class__.__name__)
        return []
    if res is None or res.status_code != 200:
        status = getattr(res, "status_code", "no response")
        log.warning("Google search returned %s for %r", status, query)
        return []
    try:
        payload = res.json()
    except ValueError:
        log.warning("Google search returned invalid JSON for %r", query)
        return []
    return payload.get("items") or []


def _download(session, url, delay, sleep):
    """Politely downloads a single candidate URL. Returns (bytes, content_type_header) or (None, None)."""
    sleep(max(MIN_DOWNLOAD_DELAY, delay))
    try:
        res = session.get(url, timeout=30)
    except requests.RequestException:
        return None, None
    if res is None or res.status_code != 200:
        return None, None
    return res.content, (res.headers or {}).get("Content-Type")


def _has_text_hash(db, text_hash):
    return db["syllabus_text"].find_one({"textHash": text_hash}, {"_id": 1}) is not None


def _process_result(
    store,
    session,
    item,
    *,
    school,
    display_code,
    compact_code,
    delay,
    sleep,
    now,
    seen_urls,
    seen_hashes,
):
    """Handles one Google Custom Search result item.
    Returns one of: 'linked', 'copied', 'hint', 'skipped', 'full'."""
    raw_url = (item.get("link") or "").strip()
    if not raw_url:
        return "skipped"

    kind = classify_host(raw_url)
    if kind is None:
        return "skipped"

    title = item.get("title") or ""
    snippet = item.get("snippet") or ""
    host = (urlsplit(raw_url).hostname or "").lower()

    if kind == "hint":
        save_hint(store.db, school, display_code, raw_url, title, snippet, host, now=now)
        return "hint"

    if kind == "wayback":
        target_url = normalize_wayback_url(raw_url)
        if not target_url:
            return "skipped"
        link_only = True
    elif kind == "link":
        target_url = raw_url
        link_only = True
    else:
        target_url = raw_url
        link_only = False

    canonical_url = unquote(target_url)
    if canonical_url in seen_urls:
        return "skipped"
    seen_urls.add(canonical_url)

    if store.is_curated(canonical_url) or store.file_for(canonical_url):
        return "skipped"

    data, hdr_ct = _download(session, target_url, delay=delay, sleep=sleep)
    if not data:
        return "skipped"

    verified = verify_syllabus(data, target_url, compact_code, header_content_type=hdr_ct)
    if not verified:
        return "skipped"

    content_type, text, text_hash = verified
    if text_hash in seen_hashes or _has_text_hash(store.db, text_hash):
        return "skipped"
    seen_hashes.add(text_hash)

    if link_only:
        file_id = store.link_file(canonical_url, content_type, len(data))
    else:
        file_id = store.save_file(data, canonical_url, content_type)
        if not file_id:
            return "full"

    term = parse_term_from_result(text, snippet=snippet, title=title, url=canonical_url)
    section = parse_section_from_text(text)
    instructors = parse_instructor_from_text(text)
    course_title = store.course_title(compact_code) or display_code

    row = Row(
        codes=[compact_code],
        section=section,
        title=course_title,
        instructors=instructors,
        href=canonical_url,
        term=term,
        source=SOURCE_NAME,
    )
    store.save_offering(dept_of(compact_code), compact_code, row, file_id, content_type, canonical_url)
    text_doc = {**listings.text_doc(row, [compact_code], text), "textHash": text_hash}
    store.save_text(file_id, text_doc)
    summary = rules.summarize(text)
    if summary:
        store.save_summary(file_id, summary, rules.PROVIDER)

    log.info("Discovered %s %s (%s, %s)", term.label, display_code, "link" if link_only else "copy", host)
    return "linked" if link_only else "copied"


def run_search(
    store,
    *,
    school=DEFAULT_SCHOOL,
    budget=DEFAULT_DAILY_BUDGET,
    limit=0,
    delay=MIN_DOWNLOAD_DELAY,
    dry_run=False,
    api_key=None,
    cx=None,
    session=None,
    sleep=time.sleep,
    now=None,
):
    """Runs Google Custom Search syllabus discovery for uncovered GMU courses."""
    budget = validate_budget(budget)
    school = (school or DEFAULT_SCHOOL).strip().lower()
    now = now if now is not None else datetime.now(timezone.utc)

    counts = {
        "searched": 0,
        "queries": 0,
        "saved": 0,
        "linked": 0,
        "copied": 0,
        "hints": 0,
        "skipped": 0,
        "full": False,
    }

    if school != DEFAULT_SCHOOL:
        log.warning("Search discovery currently supports GMU only (got %r); skipping", school)
        return counts

    if dry_run:
        if store is None:
            log.info("search (dry-run): would query up to %d Google Custom Search queries for GMU", budget)
            return counts
        targets = select_targets(store.db, school=school, now=now)
        tracker = BudgetTracker(store.db, limit=budget, today=now.date())
        remaining = tracker.remaining()
        planned = targets[:remaining]
        log.info(
            "search (dry-run): %d uncovered target courses, %d queries remaining today (budget %d)",
            len(targets),
            remaining,
            budget,
        )
        for code in planned:
            primary_q, _ = build_queries(code)
            log.info("  would search %-10s -> %s", code, primary_q)
        return counts

    api_key = api_key if api_key is not None else os.environ.get("GOOGLE_SEARCH_API_KEY", "").strip()
    cx = cx if cx is not None else os.environ.get("GOOGLE_SEARCH_CX", "").strip()
    if not api_key or not cx:
        log.warning("GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX must be set to run search discovery")
        return counts

    if session is None:
        session = requests.Session()
    if hasattr(session, "headers") and isinstance(session.headers, dict):
        session.headers["User-Agent"] = sources.USER_AGENT

    tracker = BudgetTracker(store.db, limit=budget, today=now.date())
    if not tracker.can_spend():
        log.info("search: daily budget (%d) already exhausted for %s", tracker.limit, tracker.day_key)
        return counts

    targets = select_targets(store.db, school=school, now=now)
    seen_urls = set()
    seen_hashes = set()

    for code in targets:
        if limit and counts["saved"] >= limit:
            break
        if not tracker.can_spend():
            log.info("search: daily budget (%d) exhausted; stopping cleanly", tracker.limit)
            break

        display = coverage.display_code(code)
        compact = re.sub(r"\s+", "", display)
        primary_q, fallback_q = build_queries(display)

        saved_for_course = 0
        for query_idx, query in enumerate((primary_q, fallback_q)):
            if query_idx == 1 and saved_for_course > 0:
                break
            if not tracker.spend():
                break
            counts["queries"] += 1
            items = google_search(session, query, api_key=api_key, cx=cx, num=10)
            for item in items:
                if limit and counts["saved"] >= limit:
                    break
                outcome = _process_result(
                    store,
                    session,
                    item,
                    school=school,
                    display_code=display,
                    compact_code=compact,
                    delay=delay,
                    sleep=sleep,
                    now=now,
                    seen_urls=seen_urls,
                    seen_hashes=seen_hashes,
                )
                if outcome == "full":
                    counts["full"] = True
                    log.warning("search: storage is full; stopping cleanly")
                    break
                if outcome in ("linked", "copied"):
                    counts[outcome] += 1
                    counts["saved"] += 1
                    saved_for_course += 1
                elif outcome == "hint":
                    counts["hints"] += 1
                else:
                    counts["skipped"] += 1
            if counts["full"] or (limit and counts["saved"] >= limit):
                break

        mark_searched(store.db, school, display, now=now)
        counts["searched"] += 1

        if counts["full"]:
            break

    return counts
