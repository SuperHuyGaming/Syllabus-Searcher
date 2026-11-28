from datetime import date, datetime, timedelta, timezone
import io
import zipfile

import pytest

from syllabus_scraper import search, sources
from syllabus_scraper.listings import MAX_FILE_BYTES


def make_docx_bytes(text):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body>"
            "</w:document>"
        )
        zf.writestr("word/document.xml", xml.encode("utf-8"))
    return buf.getvalue()


VALID_HTML = (
    b"<!doctype html><html><body>"
    b"<h1>CS 310 Data Structures - Fall 2024</h1>"
    b"<p>Section: 002</p>"
    b"<p>Instructor: Dr. Jane Doe</p>"
    b"<p>Grading: Homework 30%, Exams 70%. Office hours: Tue 2-4pm. Attendance is required.</p>"
    b"</body></html>"
)

VALID_PDF = b"%PDF-1.4 CS 310 Spring 2025 Grading: Exams 100% Office Hours: Mon 1-3pm Attendance required."


class FakeMongoCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def _match(self, doc, filt):
        if not filt:
            return True
        for k, v in filt.items():
            if doc.get(k) != v:
                return False
        return True

    def find(self, filt=None, projection=None):
        return [d for d in self.docs if self._match(d, filt)]

    def find_one(self, filt=None, projection=None):
        for d in self.docs:
            if self._match(d, filt):
                return d
        return None

    def replace_one(self, filt, doc, upsert=False):
        for i, d in enumerate(self.docs):
            if self._match(d, filt):
                self.docs[i] = dict(doc)
                return
        if upsert:
            self.docs.append(dict(doc))

    def update_one(self, filt, update, upsert=False):
        target = self.find_one(filt)
        if target is None:
            if not upsert:
                return
            target = dict(filt)
            self.docs.append(target)
        if "$set" in update:
            target.update(update["$set"])
        if "$inc" in update:
            for k, v in update["$inc"].items():
                target[k] = target.get(k, 0) + v


class FakeStore:
    def __init__(self, coverage_doc=None, search_usage=None, search_state=None, syllabus_text=None, full=False):
        self.db = {
            "coverage": FakeMongoCollection([coverage_doc] if coverage_doc else []),
            "courses": FakeMongoCollection([]),
            "syllabus_text": FakeMongoCollection(syllabus_text or []),
            "search_usage": FakeMongoCollection(search_usage or []),
            "search_state": FakeMongoCollection(search_state or []),
            "syllabus_hints": FakeMongoCollection([]),
        }
        self.full = full
        self.files = {}
        self.linked = {}
        self.copied = {}
        self.offerings = []
        self.texts = {}
        self.summaries = {}

    def is_curated(self, url):
        return "curated" in url

    def file_for(self, url):
        return self.files.get(url)

    def link_file(self, url, content_type, length=0, filename=None):
        fid = f"{len(self.files) + 1:024x}"
        self.files[url] = (fid, content_type)
        self.linked[url] = (fid, content_type, length)
        return fid

    def save_file(self, data, url, content_type):
        if self.full:
            return None
        fid = f"{len(self.files) + 1:024x}"
        self.files[url] = (fid, content_type)
        self.copied[url] = (fid, content_type, len(data))
        return fid

    def course_title(self, code):
        return {"CS310": "Data Structures"}.get(code)

    def save_offering(self, dept, code, row, file_id, content_type, url):
        self.offerings.append((dept, code, row, file_id, content_type, url))

    def save_text(self, file_id, doc):
        self.texts[file_id] = doc
        self.db["syllabus_text"].replace_one({"_id": file_id}, {"_id": file_id, **doc}, upsert=True)

    def save_summary(self, file_id, summary, provider):
        self.summaries[file_id] = (provider, summary)


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, content=b"", headers=None):
        self.status_code = status_code
        self._json = json_data
        self.content = content
        self.headers = headers or {}

    def json(self):
        return self._json


class FakeSession:
    def __init__(self, search_responses=None, downloads=None):
        self.headers = {}
        self.search_responses = search_responses or {}
        self.downloads = downloads or {}
        self.search_calls = []
        self.download_calls = []

    def get(self, url, params=None, timeout=30):
        if url == search.CUSTOM_SEARCH_URL:
            q = params["q"]
            self.search_calls.append(dict(params))
            items = self.search_responses.get(q, [])
            return FakeResponse(200, json_data={"items": items})
        self.download_calls.append(url)
        if url in self.downloads:
            content, ct = self.downloads[url]
            return FakeResponse(200, content=content, headers={"Content-Type": ct})
        return FakeResponse(404)


def test_validate_budget_enforces_free_quota_cap():
    assert search.validate_budget(0) == 0
    assert search.validate_budget(95) == 95
    assert search.validate_budget(100) == 100
    with pytest.raises(ValueError):
        search.validate_budget(101)
    with pytest.raises(ValueError):
        search.validate_budget(-1)


def test_classify_host_and_wayback_normalization():
    assert search.classify_host("https://cs.gmu.edu/media/CS310.pdf") == "link"
    assert search.classify_host("https://gmu.edu/syllabus.html") == "link"
    assert search.classify_host("https://d101vc9winf8ln.cloudfront.net/syllabuses/1/CS310.pdf") == "link"
    assert search.classify_host("https://web.archive.org/web/20230101000000/https://cs.gmu.edu/a.pdf") == "wayback"
    for host in ("sites.google.com", "docs.google.com", "drive.google.com", "github.com", "gmu.box.com", "archive.org"):
        assert search.classify_host(f"https://{host}/path/syllabus.pdf") == "copy"
    assert search.classify_host("https://www.studocu.com/en-us/document/gmu/cs310") == "hint"
    assert search.classify_host("https://www.coursehero.com/file/12345/CS310/") == "hint"
    assert search.classify_host("https://example.com/random.pdf") is None

    assert (
        search.normalize_wayback_url("https://web.archive.org/web/20230501120000/https://cs.gmu.edu/CS310.pdf")
        == "https://web.archive.org/web/20230501120000id_/https://cs.gmu.edu/CS310.pdf"
    )
    assert (
        search.normalize_wayback_url("https://web.archive.org/web/20230501120000id_/https://cs.gmu.edu/CS310.pdf")
        == "https://web.archive.org/web/20230501120000id_/https://cs.gmu.edu/CS310.pdf"
    )
    assert search.normalize_wayback_url("https://web.archive.org/") is None


def test_budget_tracker_persists_across_runs():
    store = FakeStore()
    today = date(2026, 11, 28)
    t1 = search.BudgetTracker(store.db, limit=3, today=today)
    assert t1.remaining() == 3
    assert t1.spend() is True
    assert t1.spend() is True
    assert t1.remaining() == 1

    # Second run on the same day shares the same Mongo search_usage doc
    t2 = search.BudgetTracker(store.db, limit=3, today=today)
    assert t2.used() == 2
    assert t2.remaining() == 1
    assert t2.spend() is True
    assert t2.spend() is False
    assert store.db["search_usage"].find_one({"_id": "2026-11-28"}) == {"_id": "2026-11-28", "queries": 3}


def test_select_targets_orders_by_dept_size_and_respects_90_day_cooldown():
    now = datetime(2026, 11, 28, 12, 0, 0, tzinfo=timezone.utc)
    cov = {
        "_id": "gmu",
        "school": "gmu",
        "totals": {"courses": 80, "withSyllabi": 40, "withoutSyllabi": 4},
        "departments": [
            {"dept": "HIST", "courses": 20, "withSyllabi": 19, "withoutSyllabi": 1, "missingCourses": ["HIST 100"]},
            {"dept": "CS", "courses": 60, "withSyllabi": 57, "withoutSyllabi": 3, "missingCourses": ["CS 321", "CS 112", "CS 310"]},
        ],
    }
    state = [
        {"_id": "gmu:CS 112", "school": "gmu", "code": "CS 112", "lastSearched": now - timedelta(days=30), "ok": True},
        {"_id": "gmu:CS 310", "school": "gmu", "code": "CS 310", "lastSearched": now - timedelta(days=91), "ok": True},
        # Written by a run whose API calls all failed (no "ok"): not a real search, so no cooldown.
        {"_id": "gmu:CS 321", "school": "gmu", "code": "CS 321", "lastSearched": now - timedelta(days=1)},
    ]
    store = FakeStore(coverage_doc=cov, search_state=state)
    targets = search.select_targets(store.db, school="gmu", now=now)
    # CS (60 courses) before HIST (20 courses); CS 112 skipped (<90d), CS 310 included (>90d), catalog order
    assert targets == ["CS 310", "CS 321", "HIST 100"]


class ErrorSession(FakeSession):
    """Custom Search answers every query with the given status and Google-style error body."""

    def __init__(self, status, message="API key not valid. Please pass a valid API key.", reason="badRequest"):
        super().__init__()
        self.status = status
        self.body = {"error": {"code": status, "message": message, "errors": [{"reason": reason}]}}

    def get(self, url, params=None, timeout=30):
        if url == search.CUSTOM_SEARCH_URL:
            self.search_calls.append(dict(params))
            return FakeResponse(self.status, json_data=self.body)
        return super().get(url, params=params, timeout=timeout)


def _three_missing_cs():
    return {
        "_id": "gmu",
        "school": "gmu",
        "totals": {"courses": 3, "withSyllabi": 0, "withoutSyllabi": 3},
        "departments": [
            {"dept": "CS", "courses": 3, "withSyllabi": 0, "withoutSyllabi": 3, "missingCourses": ["CS 101", "CS 102", "CS 103"]},
        ],
    }


def test_google_search_error_carries_googles_message():
    with pytest.raises(search.SearchError) as exc:
        search.google_search(ErrorSession(400), "q", api_key="k", cx="c")
    assert exc.value.status == 400 and exc.value.fatal
    assert "API key not valid" in str(exc.value) and "badRequest" in str(exc.value)

    with pytest.raises(search.SearchError) as exc:
        search.google_search(ErrorSession(503, message="Backend Error", reason="backendError"), "q", api_key="k", cx="c")
    assert not exc.value.fatal


def test_refused_api_stops_run_without_cooldown(caplog):
    store = FakeStore(coverage_doc=_three_missing_cs())
    session = ErrorSession(400)
    with caplog.at_level("WARNING"):
        counts = search.run_search(store, budget=20, api_key="k", cx="c", session=session, sleep=lambda _: None)
    # One refused query is enough: the rest of the budget is kept and no course is put on cooldown.
    assert counts["queries"] == 1 and counts["errors"] == 1 and counts["searched"] == 0
    assert len(session.search_calls) == 1
    assert store.db["search_state"].docs == []
    assert "API key not valid" in caplog.text


def test_transient_api_error_skips_course_without_cooldown():
    store = FakeStore(coverage_doc=_three_missing_cs())
    session = ErrorSession(503, message="Backend Error", reason="backendError")
    counts = search.run_search(store, budget=20, api_key="k", cx="c", session=session, sleep=lambda _: None)
    # Both queries of every course are tried, none is marked searched.
    assert counts["queries"] == 6 and counts["errors"] == 6 and counts["searched"] == 0
    assert store.db["search_state"].docs == []


def test_verify_syllabus_handles_html_pdf_docx_and_rejects_invalid(monkeypatch):
    monkeypatch.setattr(search, "extract_text", lambda data, ct: data.decode("latin-1"))

    # Valid HTML
    res_html = search.verify_syllabus(VALID_HTML, "https://cs.gmu.edu/cs310.html", "CS310")
    assert res_html is not None
    assert res_html[0] == "text/html; charset=utf-8"

    # Valid PDF
    res_pdf = search.verify_syllabus(VALID_PDF, "https://cs.gmu.edu/cs310.pdf", "CS310")
    assert res_pdf is not None and res_pdf[0] == "application/pdf"

    # Valid DOCX
    docx_bytes = make_docx_bytes("CS 310 Syllabus Fall 2024 Grading: 100% Exams Textbook: CLRS")
    res_docx = search.verify_syllabus(docx_bytes, "https://github.com/u/r/cs310.docx", "CS310")
    assert res_docx is not None and res_docx[0] == search.DOCX_CONTENT_TYPE

    # Rejects missing course code
    no_course = b"<html><body>Grading: 50% exams. Office hours: Mon 2pm.</body></html>"
    assert search.verify_syllabus(no_course, "https://cs.gmu.edu/page.html", "CS310") is None

    # Rejects fewer than 2 syllabus keywords
    one_kw = b"<html><body>CS 310 page mentioning grading only.</body></html>"
    assert search.verify_syllabus(one_kw, "https://cs.gmu.edu/page.html", "CS310") is None

    # Rejects oversized file
    oversized = b"%PDF-1.4 CS 310 grading office hours " + b"x" * MAX_FILE_BYTES
    assert search.verify_syllabus(oversized, "https://cs.gmu.edu/big.pdf", "CS310") is None


def test_run_search_host_policies_hints_wayback_dedupe_and_politeness(monkeypatch):
    monkeypatch.setattr(search, "extract_text", lambda data, ct: data.decode("latin-1"))
    now = datetime(2026, 11, 28, 12, 0, 0, tzinfo=timezone.utc)
    cov = {
        "_id": "gmu",
        "school": "gmu",
        "totals": {"courses": 2, "withSyllabi": 0, "withoutSyllabi": 2},
        "departments": [
            {"dept": "CS", "courses": 2, "withSyllabi": 0, "withoutSyllabi": 2, "missingCourses": ["CS 310", "CS 321"]},
        ],
    }
    store = FakeStore(coverage_doc=cov)

    gmu_url = "https://cs.gmu.edu/media/cs310.html"
    wayback_raw = "https://web.archive.org/web/20230501000000/https://cs.gmu.edu/old310.pdf"
    wayback_id = "https://web.archive.org/web/20230501000000id_/https://cs.gmu.edu/old310.pdf"
    github_url = "https://github.com/prof/cs321/blob/main/syllabus.docx"
    studocu_url = "https://www.studocu.com/en-us/document/gmu/cs310/12345"
    coursehero_url = "https://www.coursehero.com/file/999/CS310-Syllabus/"

    cs321_docx = make_docx_bytes(
        "CS 321 Software Engineering Grading: Projects 60% Attendance 10% Prerequisite: CS 310"
    )

    session = FakeSession(
        search_responses={
            '"CS 310" syllabus "George Mason"': [
                {"link": studocu_url, "title": "CS 310 Syllabus - Studocu", "snippet": "CS 310 Fall 2024"},
                {"link": coursehero_url, "title": "CS 310 - CourseHero", "snippet": "Syllabus"},
                {"link": gmu_url, "title": "CS 310", "snippet": "Data Structures"},
                # Same text as gmu_url under a different GMU URL -> deduped by text hash!
                {"link": "https://cs.gmu.edu/media/cs310-copy.html", "title": "CS 310 copy", "snippet": ""},
                {"link": wayback_raw, "title": "Archived CS 310", "snippet": "Spring 2025"},
            ],
            # CS 321: primary returns nothing -> fallback query runs!
            '"CS 321" syllabus "George Mason"': [],
            "CS321 syllabus gmu": [
                {"link": github_url, "title": "CS 321 Syllabus", "snippet": "Syllabus for Spring 2024"},
            ],
        },
        downloads={
            gmu_url: (VALID_HTML, "text/html"),
            "https://cs.gmu.edu/media/cs310-copy.html": (VALID_HTML, "text/html"),
            wayback_id: (VALID_PDF, "application/pdf"),
            github_url: (cs321_docx, search.DOCX_CONTENT_TYPE),
        },
    )

    sleeps = []
    counts = search.run_search(
        store,
        school="gmu",
        budget=10,
        delay=0.2,  # must be clamped to >= 1.0s
        api_key="fake-key",
        cx="fake-cx",
        session=session,
        sleep=sleeps.append,
        now=now,
    )

    # User-Agent set to scraper UA
    assert session.headers["User-Agent"] == sources.USER_AGENT
    # Politeness: every download slept at least 1.0s
    assert len(sleeps) == 4 and all(s >= 1.0 for s in sleeps)

    # Studocu & CourseHero were NEVER fetched!
    assert studocu_url not in session.download_calls
    assert coursehero_url not in session.download_calls
    # Wayback was fetched via id_ raw URL, never the toolbar URL
    assert wayback_id in session.download_calls
    assert wayback_raw not in session.download_calls

    # Queries: CS 310 used primary only (found results); CS 321 used primary + fallback
    assert [c["q"] for c in session.search_calls] == [
        '"CS 310" syllabus "George Mason"',
        '"CS 321" syllabus "George Mason"',
        "CS321 syllabus gmu",
    ]
    assert counts["queries"] == 3
    assert counts["searched"] == 2
    assert counts["hints"] == 2
    assert counts["linked"] == 2  # gmu_url + wayback_id (cs310-copy deduped by text hash)
    assert counts["copied"] == 1  # github_url
    assert counts["saved"] == 3

    # Verify LINK-ONLY vs COPY routing
    assert gmu_url in store.linked and gmu_url not in store.copied
    assert wayback_id in store.linked and wayback_id not in store.copied
    assert github_url in store.copied and github_url not in store.linked

    # Verify hints saved in syllabus_hints
    hints = store.db["syllabus_hints"].docs
    assert len(hints) == 2
    assert {h["host"] for h in hints} == {"www.studocu.com", "www.coursehero.com"}
    assert all(h["code"] == "CS 310" and h["school"] == "gmu" for h in hints)

    # Verify metadata parsing & source name
    by_url = {url: row for _, _, row, _, _, url in store.offerings}
    assert by_url[gmu_url].source == "gmu-search"
    assert by_url[gmu_url].term.label == "Fall 2024"
    assert by_url[gmu_url].section == "002"
    assert by_url[gmu_url].instructors == ["Jane Doe"]
    # CS 321 DOCX had no term in text -> picked up "Spring 2024" from snippet!
    assert by_url[github_url].term.label == "Spring 2024"
    assert by_url[github_url].source == "gmu-search"

    # Verify search_state updated for both courses
    assert store.db["search_state"].find_one({"_id": "gmu:CS 310"})["lastSearched"] == now
    assert store.db["search_state"].find_one({"_id": "gmu:CS 321"})["lastSearched"] == now


def test_unknown_term_fallback_when_no_term_found(monkeypatch):
    monkeypatch.setattr(search, "extract_text", lambda data, ct: data.decode("latin-1"))
    cov = {
        "_id": "gmu",
        "school": "gmu",
        "totals": {"courses": 1, "withSyllabi": 0, "withoutSyllabi": 1},
        "departments": [{"dept": "CS", "courses": 1, "withSyllabi": 0, "withoutSyllabi": 1, "missingCourses": ["CS 310"]}],
    }
    store = FakeStore(coverage_doc=cov)
    url = "https://cs.gmu.edu/syllabus.html"
    no_term_html = b"<html><body>CS 310 Grading: 100% exams. Attendance required.</body></html>"
    session = FakeSession(
        search_responses={'"CS 310" syllabus "George Mason"': [{"link": url, "title": "CS 310", "snippet": "Syllabus"}]},
        downloads={url: (no_term_html, "text/html")},
    )
    counts = search.run_search(store, budget=5, api_key="k", cx="c", session=session, sleep=lambda _: None)
    assert counts["saved"] == 1
    row = store.offerings[0][2]
    assert row.term.label == "Unknown term"
    assert row.term.key == "0000-0"


def test_dry_run_makes_no_api_calls_or_writes():
    cov = {
        "_id": "gmu",
        "school": "gmu",
        "totals": {"courses": 1, "withSyllabi": 0, "withoutSyllabi": 1},
        "departments": [{"dept": "CS", "courses": 1, "withSyllabi": 0, "withoutSyllabi": 1, "missingCourses": ["CS 310"]}],
    }
    store = FakeStore(coverage_doc=cov)
    session = FakeSession()
    counts = search.run_search(store, budget=5, dry_run=True, session=session, sleep=lambda _: None)
    assert counts["queries"] == 0 and counts["saved"] == 0
    assert session.search_calls == [] and session.download_calls == []
    assert store.db["search_usage"].docs == []
    assert store.db["search_state"].docs == []
    assert store.offerings == []


def test_budget_exhaustion_stops_cleanly():
    cov = {
        "_id": "gmu",
        "school": "gmu",
        "totals": {"courses": 3, "withSyllabi": 0, "withoutSyllabi": 3},
        "departments": [
            {"dept": "CS", "courses": 3, "withSyllabi": 0, "withoutSyllabi": 3, "missingCourses": ["CS 101", "CS 102", "CS 103"]},
        ],
    }
    now = datetime(2026, 11, 28, 12, 0, 0, tzinfo=timezone.utc)
    store = FakeStore(
        coverage_doc=cov,
        search_usage=[{"_id": "2026-11-28", "queries": 94}],
    )
    session = FakeSession()
    counts = search.run_search(
        store,
        budget=95,
        api_key="k",
        cx="c",
        session=session,
        sleep=lambda _: None,
        now=now,
    )
    # Only 1 query remained (95 - 94 = 1), so only primary query for CS 101 ran (no fallback, no CS 102)
    assert counts["queries"] == 1
    assert len(session.search_calls) == 1
    assert session.search_calls[0]["q"] == '"CS 101" syllabus "George Mason"'
    assert store.db["search_usage"].find_one({"_id": "2026-11-28"})["queries"] == 95


def test_storage_full_on_copy_host_stops_cleanly(monkeypatch):
    monkeypatch.setattr(search, "extract_text", lambda data, ct: data.decode("latin-1"))
    cov = {
        "_id": "gmu",
        "school": "gmu",
        "totals": {"courses": 1, "withSyllabi": 0, "withoutSyllabi": 1},
        "departments": [{"dept": "CS", "courses": 1, "withSyllabi": 0, "withoutSyllabi": 1, "missingCourses": ["CS 310"]}],
    }
    store = FakeStore(coverage_doc=cov, full=True)
    gh_url = "https://github.com/prof/cs310/syllabus.html"
    session = FakeSession(
        search_responses={'"CS 310" syllabus "George Mason"': [{"link": gh_url, "title": "CS 310", "snippet": ""}]},
        downloads={gh_url: (VALID_HTML, "text/html")},
    )
    counts = search.run_search(store, budget=5, api_key="k", cx="c", session=session, sleep=lambda _: None)
    assert counts["full"] is True
    assert counts["saved"] == 0
    assert store.offerings == []


def test_cross_run_text_hash_dedupe_and_non_gmu_skip(monkeypatch):
    monkeypatch.setattr(search, "extract_text", lambda data, ct: data.decode("latin-1"))
    existing_hash = search.compute_text_hash(VALID_HTML.decode("latin-1"))
    cov = {
        "_id": "gmu",
        "school": "gmu",
        "totals": {"courses": 1, "withSyllabi": 0, "withoutSyllabi": 1},
        "departments": [{"dept": "CS", "courses": 1, "withSyllabi": 0, "withoutSyllabi": 1, "missingCourses": ["CS 310"]}],
    }
    store = FakeStore(coverage_doc=cov, syllabus_text=[{"_id": "old", "textHash": existing_hash}])
    url = "https://cs.gmu.edu/new-url.html"
    session = FakeSession(
        search_responses={'"CS 310" syllabus "George Mason"': [{"link": url, "title": "CS 310", "snippet": ""}]},
        downloads={url: (VALID_HTML, "text/html")},
    )
    counts = search.run_search(store, budget=5, api_key="k", cx="c", session=session, sleep=lambda _: None)
    assert counts["saved"] == 0 and counts["skipped"] >= 1
    assert store.linked == {}

    # Non-GMU skips cleanly without making any calls
    session2 = FakeSession()
    counts2 = search.run_search(store, school="unc", budget=5, api_key="k", cx="c", session=session2, sleep=lambda _: None)
    assert counts2["queries"] == 0 and session2.search_calls == []


def test_scrape_cli_search_source_and_budget_guard(monkeypatch):
    import scrape

    monkeypatch.setattr(scrape, "load_dotenv", lambda: None)

    # Budget > 100 is refused by CLI
    with pytest.raises(SystemExit) as exc:
        scrape.main(["--sources", "search", "--search-budget", "101", "--dry-run", "--no-catalog"])
    assert exc.value.code == 2

    # Dry-run works without creating a Store or making network calls
    def fail_store():
        raise AssertionError("Store() must not be called during --dry-run")

    monkeypatch.setattr(scrape, "Store", fail_store)
    assert scrape.main(["--sources", "search", "--search-budget", "50", "--dry-run", "--no-catalog"]) == 0

    # Registered in scrape.py when requested, but NOT in default sources
    seen_calls = []

    def fake_run_search(store, **kwargs):
        seen_calls.append(kwargs)
        return {"searched": 0, "queries": 0, "saved": 0, "linked": 0, "copied": 0, "hints": 0, "skipped": 0, "full": False}

    class DummyStore:
        pool = type("P", (), {"report": lambda self: []})()
        index_text = lambda self, reindex=False: 0
        resolve_names = lambda self: 0
        make_pdfs = lambda self: 0
        count_syllabi = lambda self: 0
        mark_scraped = lambda self: None

    monkeypatch.setattr(scrape, "Store", DummyStore)
    monkeypatch.setattr(scrape.search, "run_search", fake_run_search)
    monkeypatch.setattr(scrape, "listing_rows", lambda fetcher, args, since: iter([]))
    for name in list(scrape.LISTING_SOURCES):
        monkeypatch.setitem(scrape.LISTING_SOURCES, name, lambda fetcher, since, **kw: iter([]))

    # Default --sources does NOT trigger search
    assert scrape.main(["--no-catalog", "--no-filenames"]) == 0
    assert seen_calls == []

    # Explicit --sources search triggers search with budget and school
    assert scrape.main(["--sources", "search", "--search-budget", "25", "--school", "gmu", "--no-catalog"]) == 0
    assert len(seen_calls) == 1
    assert seen_calls[0]["budget"] == 25 and seen_calls[0]["school"] == "gmu" and seen_calls[0]["dry_run"] is False


