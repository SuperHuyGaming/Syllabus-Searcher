from datetime import datetime, timedelta, timezone

from syllabus_scraper import seor, wayback
from syllabus_scraper.listings import SINCE, choose
from syllabus_scraper.parse import Term

OFFLINE = b"<html><head><title>Internet Archive: Temporarily Offline</title></head><body>offline</body></html>"


class Res:
    def __init__(self, body, url="", text=None):
        self.content = body if isinstance(body, bytes) else body.encode()
        self.text = text if text is not None else self.content.decode()
        self.url = url

    def json(self):
        import json

        return json.loads(self.content)


class FakeFetcher:
    """Answers URLs by substring; each value is a list of answers used in turn (last one repeats)."""

    def __init__(self, answers):
        self.answers = {k: list(v) if isinstance(v, list) else [v] for k, v in answers.items()}
        self.calls = []

    def get(self, url, retries=3):
        self.calls.append(url)
        for key, values in self.answers.items():
            if key in url:
                value = values.pop(0) if len(values) > 1 else values[0]
                return None if value is None else Res(value, url)
        return None


class FakeCache:
    def __init__(self, catalog=(), pages=None):
        self.catalog = set(catalog)
        self.pages = dict(pages or {})

    def listing_page(self, url):
        return self.pages.get(url)

    def save_listing_page(self, url, doc):
        self.pages[url] = {"_id": url, **doc}

    def course_title(self, code):
        return f"Title of {code}" if code in self.catalog else None


def cdx_json(*rows):
    import json

    return json.dumps([["timestamp", "original"], *[list(r) for r in rows]])


# ---------- file names ----------

def test_parse_ece_reads_course_and_term_and_skips_slides():
    row = wayback.parse_ece("http://ece.gmu.edu:80/coursewebpages/BENG/BENG304/BENG304_S11.pdf")
    assert row.codes == ["BENG304"] and row.term == Term("Spring", 2011)
    assert row.href == "https://ece.gmu.edu/coursewebpages/BENG/BENG304/BENG304_S11.pdf"
    assert row.source == "gmu-ece"
    assert wayback.parse_ece("http://ece.gmu.edu/coursewebpages/TCOM/TCOM610/TCOM610_F08.pdf").term == Term("Fall", 2008)
    assert wayback.parse_ece("http://ece.gmu.edu/coursewebpages/ECE/ECE447/ECE447_Su10.pdf").term == Term("Summer", 2010)
    for other in (
        "http://ece.gmu.edu/coursewebpages/ECE/ECE448/S12/exams/ECE448_S12_class_midterm.pdf",
        "http://ece.gmu.edu/coursewebpages/ECE/ECE635/ECE635_S11_files/ECE635_S11_sched.pdf",
        "http://ece.gmu.edu/coursewebpages/ECE/ECE545/F10/viewgraphs/ECE545_lecture8.pdf",
    ):
        assert wayback.parse_ece(other) is None


def test_parse_ite_reads_folder_term_section_and_instructor():
    row = wayback.parse_ite("http://ite.gmu.edu/ait/syllabi/fall2006/IT214_003_Eftekhari.htm")
    assert row.codes == ["IT214"] and row.term == Term("Fall", 2006)
    assert row.section == "003" and row.instructors == ["Eftekhari"]
    row = wayback.parse_ite("http://ite.gmu.edu:80/ait/syllabi/Spring2006/IT-108-007%20Prog-Fund-Java_Bruno.htm")
    assert row.codes == ["IT108"] and row.section == "007" and row.term == Term("Spring", 2006)
    row = wayback.parse_ite("http://ite.gmu.edu/ait/syllabi/fall%202007/IT250.pdf")
    assert row.codes == ["IT250"] and row.section == "All" and row.instructors == ["Staff"]
    assert row.term == Term("Fall", 2007)
    # Index pages, files outside a term folder and folders are not syllabi.
    assert wayback.parse_ite("http://ite.gmu.edu/ait/syllabi/fall2005/syllabi_fall2005.htm") is None
    assert wayback.parse_ite("http://ite.gmu.edu/ait/syllabi/it103spring.html") is None
    assert wayback.parse_ite("http://ite.gmu.edu/ait/syllabi/fall%202007/") is None


def test_parse_ist_and_schar_from_report_examples():
    row = wayback.parse_ist("https://ist.gmu.edu/wp-content/uploads/2019/08/IT106Fall2019Syllabus.pdf")
    assert row.codes == ["IT106"] and row.term == Term("Fall", 2019) and row.source == "gmu-ist"
    assert wayback.parse_ist("https://ist.gmu.edu/wp-content/uploads/2019/08/logo.png") is None

    row = wayback.parse_schar("https://webdocs.gmu.edu/wp-content/uploads/Shark-PUAD-680-FA-25-Accessible.pdf")
    assert row.codes == ["PUAD680"] and row.term == Term("Fall", 2025) and row.instructors == ["Shark"]
    assert row.section == "All" and row.source == "gmu-schar"
    row = wayback.parse_schar("https://webdocs.gmu.edu/wp-content/uploads/Smith-GOVT-510-001-SP-26-Accessible.pdf")
    assert row.codes == ["GOVT510"] and row.section == "001" and row.term == Term("Spring", 2026)
    assert wayback.parse_schar("https://webdocs.gmu.edu/wp-content/uploads/annual-report.pdf") is None


# ---------- archive listing ----------

def test_cdx_rows_waits_out_the_offline_page():
    harvest = wayback.HARVESTS["ece"]
    fetcher = FakeFetcher({"cdx/search": [OFFLINE, OFFLINE, cdx_json(("20100619022456", "http://ece.gmu.edu/x.pdf"))]})
    pauses = []
    rows = wayback.cdx_rows(fetcher, harvest, sleep=pauses.append)
    assert rows == [("20100619022456", "http://ece.gmu.edu/x.pdf")]
    assert pauses == [wayback.OFFLINE_PAUSE, wayback.OFFLINE_PAUSE * 2]
    assert "filter=mimetype%3Aapplication%2Fpdf" in fetcher.calls[0]

    always_offline = FakeFetcher({"cdx/search": OFFLINE})
    assert wayback.cdx_rows(always_offline, harvest, sleep=lambda _: None) is None
    assert len(always_offline.calls) == wayback.CDX_TRIES


def test_listed_urls_keeps_the_list_and_falls_back_to_it_when_offline():
    harvest = wayback.HARVESTS["ece"]
    now = datetime(2026, 11, 28, tzinfo=timezone.utc)
    cache = FakeCache()
    fresh = FakeFetcher({"cdx/search": cdx_json(("20100619022456", "http://ece.gmu.edu/a.pdf"))})
    assert wayback.listed_urls(fresh, harvest, cache=cache, now=now) == [("20100619022456", "http://ece.gmu.edu/a.pdf")]

    # Within REFRESH_DAYS the kept list is used without asking the archive.
    quiet = FakeFetcher({})
    assert wayback.listed_urls(quiet, harvest, cache=cache, now=now + timedelta(days=5)) == [
        ("20100619022456", "http://ece.gmu.edu/a.pdf")]
    assert quiet.calls == []

    # Stale and the archive is offline: the old list still works.
    offline = FakeFetcher({"cdx/search": OFFLINE})
    later = now + timedelta(days=wayback.REFRESH_DAYS + 1)
    assert wayback.listed_urls(offline, harvest, cache=cache, now=later, sleep=lambda _: None) == [
        ("20100619022456", "http://ece.gmu.edu/a.pdf")]

    # No kept list and offline: nothing to go on.
    assert wayback.listed_urls(offline, harvest, cache=FakeCache(), now=now, sleep=lambda _: None) is None


def test_harvest_rows_reads_from_the_archive_and_drops_unknown_and_unparsed():
    harvest = wayback.HARVESTS["ece"]
    fetcher = FakeFetcher({"cdx/search": cdx_json(
        ("20100619022456", "http://ece.gmu.edu/coursewebpages/ECE/ECE220/ECE220_S09.pdf"),
        ("20150701185459", "http://ece.gmu.edu:80/coursewebpages/ECE/ECE220/ECE220_F11.pdf"),
        ("20100618235017", "http://ece.gmu.edu/coursewebpages/ECE/ECE999/ECE999_F08.pdf"),  # not in the catalog
        ("20100618235017", "http://ece.gmu.edu/coursewebpages/ECE/ECE448/S12/exams/mid.pdf"),  # not a syllabus
    )})
    cache = FakeCache(catalog={"ECE220"})
    items = list(wayback.harvest_rows(fetcher, harvest, since=SINCE, cache=cache))
    assert [(i.row.codes[0], i.row.term.label) for i in items] == [("ECE220", "Fall 2011"), ("ECE220", "Spring 2009")]
    # Archive-only sites are read from the archive's raw copy, not the dead live URL.
    assert items[0].row.href == (
        "https://web.archive.org/web/20150701185459id_/https://ece.gmu.edu/coursewebpages/ECE/ECE220/ECE220_F11.pdf")
    # The shared path keeps the newest one per course.
    assert [i.row.term.label for i in choose(items)] == ["Fall 2011"]


def test_harvest_rows_drops_old_keep_all_subjects_and_keeps_live_urls_for_schar():
    harvest = wayback.HARVESTS["schar"]
    fetcher = FakeFetcher({"cdx/search": cdx_json(
        ("20251001000000", "https://webdocs.gmu.edu/wp-content/uploads/Shark-PUAD-680-FA-25-Accessible.pdf"),
    )})
    items = list(wayback.harvest_rows(fetcher, harvest, since=SINCE, cache=FakeCache(catalog={"PUAD680"})))
    assert items[0].row.href == "https://webdocs.gmu.edu/wp-content/uploads/Shark-PUAD-680-FA-25-Accessible.pdf"
    assert items[0].timestamp == "20251001000000"

    old_cs = wayback.Harvest("t", "x/", lambda url: wayback.Row(
        codes=["CS310"], section="All", title="", instructors=["Staff"], href=url, term=Term("Fall", 2010)))
    fetcher = FakeFetcher({"cdx/search": cdx_json(("20101001000000", "https://x/cs310.pdf"))})
    assert list(wayback.harvest_rows(fetcher, old_cs, since=SINCE, cache=FakeCache(catalog={"CS310"}))) == []


def test_harvest_rows_waits_when_archive_is_offline_with_no_kept_list(monkeypatch):
    monkeypatch.setattr(wayback, "OFFLINE_PAUSE", 0)
    fetcher = FakeFetcher({"cdx/search": OFFLINE})
    assert list(wayback.harvest_rows(fetcher, wayback.HARVESTS["ite"], cache=FakeCache(), sleep=lambda _: None)) == []


# ---------- SEOR (live) ----------

SEOR_INDEX = """<html><body>
<a href="http://seor.gmu.edu">SEOR</a><a href="OR_BookList.pdf">Books</a>
<a href="fall15.php">Fall 2015</a><a href="spring16.php">Spring 2016</a></body></html>"""

SEOR_FALL15 = """<html><body><table>
<tr><td><a href="15F/OR441.pdf">OR\n441 (PDF)</a></td><td>Deterministic\nOperations Research</td><td>NEYSHABOURI, S</td></tr>
<tr><td><a href="http://seor.gmu.edu/~cchen9/or442.htm">OR 442</a></td><td>Stochastic OR</td><td>CHEN, CH</td></tr>
<tr><td><a href="15F/OR531-3.pdf">OR 531 (PDF)</a></td><td>Analytics/ Decision Analysis</td><td>COMER, K</td></tr>
<tr><td>OR 649</td><td>Agent-Based Modeling</td><td>COMER, K</td></tr>
<tr><td><a href="syllabi/01B/syst681.htm">SYST 681</a></td><td>Doubled folder</td><td>YOUNGREN, M A</td></tr>
<tr><td><a href="15F/SYST999.pdf">SYST 999 (PDF)</a></td><td>Not in catalog</td><td>XU, JIE</td></tr>
</table></body></html>"""


def test_seor_term_pages_and_rows():
    pages = seor.term_pages(SEOR_INDEX)
    assert pages == {Term("Fall", 2015): seor.INDEX + "fall15.php", Term("Spring", 2016): seor.INDEX + "spring16.php"}

    rows = seor.parse_term_page(SEOR_FALL15, Term("Fall", 2015), seor.INDEX + "fall15.php")
    assert [(r.codes[0], r.section, r.instructors, r.href) for r in rows] == [
        ("OR441", "All", ["Neyshabouri, S"], "https://www3.gmu.edu/schools/vse/seor/syllabi/15F/OR441.pdf"),
        ("OR531", "003", ["Comer, K"], "https://www3.gmu.edu/schools/vse/seor/syllabi/15F/OR531-3.pdf"),
        ("SYST681", "All", ["Youngren, M A"], "https://www3.gmu.edu/schools/vse/seor/syllabi/01B/syst681.htm"),
        ("SYST999", "All", ["Xu, Jie"], "https://www3.gmu.edu/schools/vse/seor/syllabi/15F/SYST999.pdf"),
    ]
    assert rows[0].title == "Deterministic Operations Research" and rows[0].source == "gmu-seor"


def test_seor_rows_skip_courses_missing_from_the_catalog():
    fetcher = FakeFetcher({"fall15.php": SEOR_FALL15, "spring16.php": "<html></html>", "syllabi/": SEOR_INDEX})
    items = list(seor.rows(fetcher, SINCE, cache=FakeCache(catalog={"OR441", "OR531"})))
    assert sorted(i.row.codes[0] for i in items) == ["OR441", "OR531"]
