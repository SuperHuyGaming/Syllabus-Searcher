import json
from pathlib import Path

from syllabus_scraper import cehd, listings
from syllabus_scraper.parse import Term

FIXTURES = Path(__file__).parent / "fixtures"
PAGE_2024 = (FIXTURES / "cehd_heal325_2024.html").read_text(encoding="utf-8")
PAGE_2020 = (FIXTURES / "cehd_heal325_2020.html").read_text(encoding="utf-8")


def test_course_page_rows():
    rows = cehd.parse_course_page(PAGE_2024)
    first = rows[0]
    assert (first.codes, first.section, first.title, first.instructors, first.term) == (
        ["HEAL325"], "DL1", "Human Sexuality", ["Karczmarczyk, Diana"], Term("Spring", 2024))
    assert first.href == "https://cehd.gmu.edu/assets/docs/syllabi/2024/syllabus_48196.pdf"
    assert first.source == "gmu-cehd"
    # Sections listed without a syllabus link ("Fall 2024, Section: DL2*") are left out.
    assert all("/syllabi/" in r.href for r in rows)
    assert Term("Fall", 2024) not in {r.term for r in rows}


def test_older_layout_with_linked_instructor_names():
    rows = cehd.parse_course_page(PAGE_2020)
    assert [(r.term.label, r.section, r.instructors) for r in rows[:2]] == [
        ("Summer 2020", "A01", ["Griesse, Rebecca"]), ("Summer 2020", "B01", ["Karczmarczyk, Diana"])]
    assert rows[0].title == "Health Aspects of Human Sexuality"


def test_instructor_names():
    assert cehd.instructors("Diana Karczmarczyk") == ["Karczmarczyk, Diana"]
    assert cehd.instructors("Amanda Gordon, Susan Milstein") == ["Gordon, Amanda", "Milstein, Susan"]
    assert cehd.instructors("TBA") == ["Staff"]
    assert cehd.instructors("") == ["Staff"]


class Res:
    def __init__(self, text, url=""):
        self.content = text.encode("utf-8")
        self.url = url

    def json(self):
        return json.loads(self.content)


class Archive:
    """Serves CDX answers and page captures; records what was asked."""

    def __init__(self, captures, cdx_list=None, cdx_last=None):
        self.captures, self.cdx_list, self.cdx_last, self.asked = captures, cdx_list, cdx_last, []

    def get(self, url):
        self.asked.append(url)
        if "/cdx/" in url:
            if "matchType=prefix" in url:
                return Res(json.dumps(self.cdx_list)) if self.cdx_list is not None else None
            return Res(json.dumps(self.cdx_last)) if self.cdx_last else None
        for stamp, html in self.captures.items():
            if f"/web/{stamp}" in url:
                return Res(html, f"https://web.archive.org/web/{stamp}id_/x")
        # Wayback answers the nearest capture: the first one here.
        stamp, html = next(iter(self.captures.items()))
        return Res(html, f"https://web.archive.org/web/{stamp}id_/x")


def test_course_pages_from_the_archive_list():
    archive = Archive({}, cdx_list=[["timestamp", "original"],
                                    ["20150101000000", "http://cehd.gmu.edu/courses/HEAL-325"],
                                    ["20190101000000", "https://cehd.gmu.edu/courses/EDUC-655/"],
                                    ["20250101000000", "https://cehd.gmu.edu/courses/KINE-999"],  # first seen after the links were gone
                                    ["20190101000000", "https://cehd.gmu.edu/courses/"]])
    assert cehd.course_pages(archive) == {"HEAL325": "https://cehd.gmu.edu/courses/HEAL-325",
                                          "EDUC655": "https://cehd.gmu.edu/courses/EDUC-655"}
    assert cehd.course_pages(Archive({})) is None


def test_last_capture_before_the_links_were_removed():
    # The nearest capture is from November 2024 (no links): ask the archive for the last one before.
    archive = Archive({"20241110180147": "<h1>HEAL 325</h1>", "20240723144746": PAGE_2024},
                      cdx_last=[["timestamp"], ["20240723144746"]])
    stamp, html = cehd.last_capture(archive, "https://cehd.gmu.edu/courses/HEAL-325")
    assert stamp == "20240723144746" and html == PAGE_2024
    assert any("to=20240831" in url for url in archive.asked)

    archive = Archive({"20240707204054": PAGE_2024})
    assert cehd.last_capture(archive, "https://cehd.gmu.edu/courses/HEAL-325")[0] == "20240707204054"


class Cache(dict):
    def listing_page(self, url):
        return self.get(url)

    def save_listing_page(self, url, doc):
        self[url] = doc


def test_rows_keep_read_pages_and_stop_at_the_page_limit(monkeypatch):
    pages = {"EDUC655": "https://cehd.gmu.edu/courses/EDUC-655", "HEAL325": "https://cehd.gmu.edu/courses/HEAL-325"}
    monkeypatch.setattr(cehd, "course_pages", lambda fetcher: pages)
    archive = Archive({"20240707204054": PAGE_2024})
    cache = Cache()

    first = list(cehd.rows(archive, listings.SINCE, cache=cache, pages_per_run=1))
    assert list(cache) == [pages["EDUC655"]]  # one page this run; HEAL 325 waits
    assert all(item.timestamp == "20240707204054" for item in first)

    asked = len(archive.asked)
    second = list(cehd.rows(archive, listings.SINCE, cache=cache, pages_per_run=1))
    assert set(cache) == set(pages.values())
    assert len(archive.asked) == asked + 1  # EDUC 655 came from the cache
    heal = [item for item in second if item.row.href.endswith("syllabus_48196.pdf")]
    assert heal and heal[0].row.term == Term("Spring", 2024) and heal[0].row.source == "gmu-cehd"
    # Rows before the cutoff term are left out.
    assert not list(cehd.rows(archive, Term("Fall", 2030), cache=cache))
