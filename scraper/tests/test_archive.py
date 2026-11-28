"""Unit tests for scraper/archive.py using a mocked public API (no real network calls)."""

import ast
import csv
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pytest
import requests

import archive


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, content=b"", headers=None):
        self.status_code = status_code
        self._json = json_data
        self._content = content
        self.headers = dict(headers or {})
        self.closed = False
        self.iter_content_calls = 0

    def raise_for_status(self):
        if self.status_code >= 400:
            err = requests.HTTPError(f"HTTP {self.status_code}")
            err.response = self
            raise err

    def json(self):
        return self._json

    def iter_content(self, chunk_size=65536):
        self.iter_content_calls += 1
        for i in range(0, len(self._content), chunk_size):
            yield self._content[i : i + chunk_size]

    def close(self):
        self.closed = True


class FailingStreamResponse(FakeResponse):
    def iter_content(self, chunk_size=65536):
        self.iter_content_calls += 1
        yield b"partial"
        raise requests.ConnectionError("connection dropped mid-stream")


class FakeSession:
    """In-memory mock of the public FindMySyllabus HTTP API."""

    def __init__(self, schools, departments, courses, course_details, files):
        self.schools = schools
        self.departments = departments
        self.courses = courses
        self.course_details = course_details
        self.files = files
        self.requests = []
        self.responses = []

    def get(self, url, params=None, stream=False, timeout=None):
        parsed = urlsplit(url)
        path = parsed.path
        self.requests.append((path, dict(params or {}), stream))

        if path == "/api/schools":
            resp = FakeResponse(json_data={"schools": self.schools})
        elif path == "/api/departments":
            school = (params or {}).get("school", "gmu")
            resp = FakeResponse(json_data={"school": school, "departments": self.departments.get(school, [])})
        elif path == "/api/courses":
            dept = (params or {}).get("dept", "")
            resp = FakeResponse(json_data={"dept": dept, "courses": self.courses.get(dept, [])})
        elif path.startswith("/api/courses/"):
            code = unquote(path[len("/api/courses/") :])
            if code in self.course_details:
                resp = FakeResponse(json_data=self.course_details[code])
            else:
                resp = FakeResponse(status_code=404)
        elif path.startswith("/api/syllabi/"):
            file_id = unquote(path[len("/api/syllabi/") :])
            entry = self.files.get(file_id)
            if entry is None:
                resp = FakeResponse(status_code=404)
            elif isinstance(entry, FakeResponse):
                resp = entry
            else:
                content, headers = entry
                resp = FakeResponse(content=content, headers=headers)
        else:
            resp = FakeResponse(status_code=404)

        self.responses.append((path, resp))
        return resp


def make_clock(step=0.0):
    """Returns a deterministic (clock, sleep, sleeps) triple for testing RateLimiter."""
    now = [100.0]
    sleeps = []

    def clock():
        val = now[0]
        now[0] += step
        return val

    def sleep(seconds):
        sleeps.append(seconds)
        now[0] += seconds

    return clock, sleep, sleeps


def test_only_stdlib_and_requests_imported():
    src = Path(archive.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    non_stdlib = imported - set(archive.sys.stdlib_module_names)
    assert non_stdlib == {"requests"}


@pytest.mark.parametrize(
    "raw,expected",
    [
        ('Fall 2024: <CS> "Intro" / \\ | ? *', "Fall 2024_ _CS_ _Intro_ _ _ _ _ _"),
        ("  trailing dots and spaces...   ", "trailing dots and spaces"),
        ("CON", "_CON"),
        ("prn", "_prn"),
        ("NUL.txt", "_NUL.txt"),
        ("com1", "_com1"),
        ("LPT9", "_LPT9"),
        ("   ...   ", "Unknown"),
        ("Line1\x00\x1fLine2", "Line1__Line2"),
    ],
)
def test_sanitize_name_windows_rules(raw, expected):
    assert archive.sanitize_name(raw) == expected


def test_sanitize_filename_truncates_and_preserves_extension():
    long_stem = "A" * 200
    name = archive.sanitize_filename(long_stem, "pdf", max_len=60)
    assert len(name) <= 60
    assert name.endswith(".pdf")


def test_extension_for_fallbacks():
    assert archive.extension_for(content_type="application/pdf; charset=binary") == "pdf"
    assert archive.extension_for(content_type="text/html; charset=utf-8") == "html"
    assert archive.extension_for(content_disposition='inline; filename="syllabus.DOCX"') == "docx"
    assert archive.extension_for(source_url="https://example.edu/files/cs101.txt?v=1") == "txt"
    assert archive.extension_for() == "bin"


def _sample_api():
    pdf_bytes = b"%PDF-1.4 sample cs310 syllabus"
    html_bytes = b"<html><body>CS 483 Syllabus</body></html>"
    unc_pdf = b"%PDF-1.4 unc comp110"

    return FakeSession(
        schools=[
            {"key": "gmu", "name": "George Mason University"},
            {"key": "unc", "name": "University of North Carolina"},
        ],
        departments={
            "gmu": [
                {"code": "CS", "display": "CS", "name": "Computer Science", "withSyllabi": 2},
                {"code": "EMPTY", "display": "EMPTY", "name": "No Syllabi Dept", "withSyllabi": 0},
            ],
            "unc": [
                {"code": "unc:COMP", "display": "COMP", "name": "Computer Science", "withSyllabi": 1},
            ],
        },
        courses={
            "CS": [
                {"code": "CS310", "title": "Data Structures", "hasSyllabi": True},
                {"code": "CS483", "title": "Analysis of Algorithms", "hasSyllabi": True},
                {"code": "CS999", "title": "No Syllabus Course", "hasSyllabi": False},
            ],
            "unc:COMP": [
                {"code": "unc:COMP110", "title": "Intro to Programming", "hasSyllabi": True},
            ],
        },
        course_details={
            "CS310": {
                "code": "CS310",
                "title": "Data Structures",
                "school": "gmu",
                "dept": "CS",
                "offerings": [
                    {
                        "termKey": "2024-3",
                        "termLabel": "Fall 2024",
                        "section": "001",
                        "instructors": ["Snyder, Mark"],
                        "title": "Data Structures",
                        "fileId": "507f1f77bcf86cd799439011",
                        "contentType": "application/pdf",
                        "source": "cs",
                        "sourceUrl": "https://cs.gmu.edu/media/syllabi/Fall2024/CS310.pdf",
                    },
                    {
                        # Same term/section/instructor with different fileId -> collision suffix
                        "termKey": "2024-3",
                        "termLabel": "Fall 2024",
                        "section": "001",
                        "instructors": ["Snyder, Mark"],
                        "title": "Data Structures",
                        "fileId": "507f1f77bcf86cd799439012",
                        "contentType": "application/pdf",
                        "source": "upload",
                        "sourceUrl": "",
                    },
                ],
            },
            "CS483": {
                "code": "CS483",
                "title": "Analysis of Algorithms",
                "school": "gmu",
                "dept": "CS",
                "offerings": [
                    {
                        "termKey": "2025-1",
                        "termLabel": "Spring 2025",
                        "section": "DL1",
                        "instructors": ["CON", "José: García?"],
                        "fileId": "507f1f77bcf86cd799439013",
                        "source": "cs",
                        "sourceUrl": "https://cs.gmu.edu/syllabi/cs483.html",
                    }
                ],
            },
            "unc:COMP110": {
                "code": "unc:COMP110",
                "title": "Intro to Programming",
                "school": "unc",
                "dept": "unc:COMP",
                "offerings": [
                    {
                        "termKey": "2025-1",
                        "termLabel": "Spring 2025",
                        "section": "002",
                        "instructors": ["Jordan, Kris"],
                        "fileId": "507f1f77bcf86cd799439014",
                        "contentType": "application/pdf",
                        "source": "upload",
                    }
                ],
            },
        },
        files={
            "507f1f77bcf86cd799439011": (
                pdf_bytes,
                {"Content-Type": "application/pdf", "Content-Length": str(len(pdf_bytes))},
            ),
            "507f1f77bcf86cd799439012": (
                pdf_bytes + b" v2",
                {"Content-Type": "application/pdf", "Content-Length": str(len(pdf_bytes) + 3)},
            ),
            "507f1f77bcf86cd799439013": (
                html_bytes,
                {"Content-Type": "text/html; charset=utf-8", "Content-Length": str(len(html_bytes))},
            ),
            "507f1f77bcf86cd799439014": (
                unc_pdf,
                {"Content-Type": "application/pdf", "Content-Length": str(len(unc_pdf))},
            ),
        },
    )


def test_full_archive_structure_and_catalog_csv(tmp_path):
    session = _sample_api()
    clock, sleep, sleeps = make_clock(step=0.0)
    archiver = archive.Archiver(
        api_base="https://findmysyllabus.bentruong.dev",
        dest=tmp_path,
        session=session,
        delay=1.0,
        sleep=sleep,
        clock=clock,
    )

    counts = archiver.run()
    assert counts == {"downloaded": 4, "existing": 0, "skipped": 0, "failed": 0, "total": 4}

    # Verify skipped empty dept and course with hasSyllabi=False
    paths = [req[0] for req in session.requests]
    assert "/api/courses/CS999" not in paths
    assert all(req[1].get("dept") != "EMPTY" for req in session.requests if req[0] == "/api/courses")

    # Verify folder layout: <dest>/<school>/<DEPT>/<CODE>/<Term> - <Section> - <Instructor>.<ext>
    cs310_1 = tmp_path / "gmu" / "CS" / "CS310" / "Fall 2024 - 001 - Snyder, Mark.pdf"
    cs310_2 = tmp_path / "gmu" / "CS" / "CS310" / "Fall 2024 - 001 - Snyder, Mark (507f1f77).pdf"
    cs483 = tmp_path / "gmu" / "CS" / "CS483" / "Spring 2025 - DL1 - CON, José_ García_.html"
    unc_file = tmp_path / "unc" / "COMP" / "COMP110" / "Spring 2025 - 002 - Jordan, Kris.pdf"

    assert cs310_1.read_bytes() == b"%PDF-1.4 sample cs310 syllabus"
    assert cs310_2.read_bytes() == b"%PDF-1.4 sample cs310 syllabus v2"
    assert cs483.read_bytes() == b"<html><body>CS 483 Syllabus</body></html>"
    assert unc_file.read_bytes() == b"%PDF-1.4 unc comp110"

    # Verify catalog.csv columns and contents
    catalog_path = tmp_path / "catalog.csv"
    with catalog_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        assert reader.fieldnames == [
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
        rows = list(reader)

    assert len(rows) == 4
    assert rows[0]["code"] == "CS310"
    assert rows[0]["title"] == "Data Structures"
    assert rows[0]["term"] == "Fall 2024"
    assert rows[0]["section"] == "001"
    assert rows[0]["instructors"] == "Snyder, Mark"
    assert rows[0]["source"] == "cs"
    assert rows[0]["sourceUrl"] == "https://cs.gmu.edu/media/syllabi/Fall2024/CS310.pdf"
    assert rows[0]["fileId"] == "507f1f77bcf86cd799439011"
    assert rows[0]["savedPath"] == "gmu/CS/CS310/Fall 2024 - 001 - Snyder, Mark.pdf"

    assert rows[2]["instructors"] == "CON; José: García?"
    assert rows[3]["code"] == "unc:COMP110"
    assert rows[3]["savedPath"] == "unc/COMP/COMP110/Spring 2025 - 002 - Jordan, Kris.pdf"

    # Rate limiter slept 1.0s between every pair of requests
    assert len(sleeps) == len(session.requests) - 1
    assert all(s == pytest.approx(1.0) for s in sleeps)


def test_incremental_skips_unchanged_and_redownloads_changed(tmp_path):
    session = _sample_api()
    clock, sleep, _ = make_clock(step=0.0)
    archiver = archive.Archiver(dest=tmp_path, session=session, delay=1.0, sleep=sleep, clock=clock)

    first = archiver.run(schools_filter=["gmu"], depts_filter=["CS"])
    assert first["downloaded"] == 3
    assert first["existing"] == 0

    # Mutate one file on the server so its Content-Length changes
    updated_bytes = b"%PDF-1.4 updated syllabus with more content"
    session.files["507f1f77bcf86cd799439011"] = (
        updated_bytes,
        {"Content-Type": "application/pdf", "Content-Length": str(len(updated_bytes))},
    )
    session.responses.clear()

    second = archiver.run(schools_filter=["gmu"], depts_filter=["CS"])
    assert second["downloaded"] == 1
    assert second["existing"] == 2
    assert second["total"] == 3

    # Verify unchanged files never streamed their body
    file_resps = {path: resp for path, resp in session.responses if path.startswith("/api/syllabi/")}
    assert file_resps["/api/syllabi/507f1f77bcf86cd799439011"].iter_content_calls == 1
    assert file_resps["/api/syllabi/507f1f77bcf86cd799439012"].iter_content_calls == 0
    assert file_resps["/api/syllabi/507f1f77bcf86cd799439013"].iter_content_calls == 0
    assert all(resp.closed for resp in file_resps.values())

    cs310_1 = tmp_path / "gmu" / "CS" / "CS310" / "Fall 2024 - 001 - Snyder, Mark.pdf"
    assert cs310_1.read_bytes() == updated_bytes


def test_incremental_skips_request_when_reported_size_matches(tmp_path):
    pdf_bytes = b"%PDF-1.4 reported size"
    session = FakeSession(
        schools=[{"key": "gmu"}],
        departments={"gmu": [{"code": "CS", "display": "CS", "withSyllabi": 1}]},
        courses={"CS": [{"code": "CS112", "title": "Intro", "hasSyllabi": True}]},
        course_details={
            "CS112": {
                "code": "CS112",
                "title": "Intro",
                "school": "gmu",
                "dept": "CS",
                "offerings": [
                    {
                        "termLabel": "Fall 2024",
                        "section": "001",
                        "instructors": ["Doe, Jane"],
                        "fileId": "aaaaaaaaaaaaaaaaaaaaaaaa",
                        "contentType": "application/pdf",
                        "size": len(pdf_bytes),
                    }
                ],
            }
        },
        files={
            "aaaaaaaaaaaaaaaaaaaaaaaa": (
                pdf_bytes,
                {"Content-Type": "application/pdf", "Content-Length": str(len(pdf_bytes))},
            )
        },
    )

    clock, sleep, _ = make_clock()
    archiver = archive.Archiver(dest=tmp_path, session=session, delay=0.0, sleep=sleep, clock=clock)
    assert archiver.run()["downloaded"] == 1

    session.requests.clear()
    counts = archiver.run()
    assert counts["existing"] == 1
    assert counts["downloaded"] == 0
    assert all(not path.startswith("/api/syllabi/") for path, _, _ in session.requests)


def test_failed_download_cleans_up_part_file_and_continues(tmp_path):
    good_bytes = b"%PDF-1.4 good"
    session = FakeSession(
        schools=[{"key": "gmu"}],
        departments={"gmu": [{"code": "CS", "display": "CS", "withSyllabi": 1}]},
        courses={"CS": [{"code": "CS211", "title": "OOP", "hasSyllabi": True}]},
        course_details={
            "CS211": {
                "code": "CS211",
                "title": "OOP",
                "school": "gmu",
                "dept": "CS",
                "offerings": [
                    {
                        "termLabel": "Fall 2024",
                        "section": "001",
                        "instructors": ["Broken Stream"],
                        "fileId": "bbbbbbbbbbbbbbbbbbbbbbbb",
                        "contentType": "application/pdf",
                    },
                    {
                        "termLabel": "Fall 2024",
                        "section": "002",
                        "instructors": ["Missing File"],
                        "fileId": "cccccccccccccccccccccccc",
                        "contentType": "application/pdf",
                    },
                    {
                        "termLabel": "Fall 2024",
                        "section": "003",
                        "instructors": ["Good Prof"],
                        "fileId": "dddddddddddddddddddddddd",
                        "contentType": "application/pdf",
                    },
                ],
            }
        },
        files={
            "bbbbbbbbbbbbbbbbbbbbbbbb": FailingStreamResponse(
                headers={"Content-Type": "application/pdf", "Content-Length": "999"}
            ),
            "dddddddddddddddddddddddd": (
                good_bytes,
                {"Content-Type": "application/pdf", "Content-Length": str(len(good_bytes))},
            ),
        },
    )

    clock, sleep, _ = make_clock()
    archiver = archive.Archiver(dest=tmp_path, session=session, delay=0.0, sleep=sleep, clock=clock)
    counts = archiver.run()

    assert counts == {"downloaded": 1, "existing": 0, "skipped": 0, "failed": 2, "total": 1}
    cs211_dir = tmp_path / "gmu" / "CS" / "CS211"
    assert list(cs211_dir.glob("*.part")) == []
    assert (cs211_dir / "Fall 2024 - 003 - Good Prof.pdf").read_bytes() == good_bytes


def test_rate_limiter_respects_elapsed_time():
    # Each clock() call advances by 0.4s; with delay=1.0, limiter should sleep 0.6s
    clock, sleep, sleeps = make_clock(step=0.4)
    limiter = archive.RateLimiter(delay=1.0, sleep=sleep, clock=clock)
    limiter.wait()
    limiter.wait()
    limiter.wait()
    assert len(sleeps) == 2
    assert all(s == pytest.approx(0.6) for s in sleeps)
