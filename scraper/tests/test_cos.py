from pathlib import Path

from syllabus_scraper import cos, listings
from syllabus_scraper.parse import Term

FIXTURES = Path(__file__).parent / "fixtures"
BASE = "https://science.gmu.edu/academics/departments-units/x/course-syllabi"


def page(name, base=BASE):
    return cos.parse_page((FIXTURES / name).read_text(encoding="utf-8"), base)


def test_course_cells():
    assert cos.parse_course("EVPP 480-DL2") == (["EVPP480"], "DL2", "")
    assert cos.parse_course("GGS 307 - 001") == (["GGS307"], "001", "")
    assert cos.parse_course("EVPP 337-001/337-002") == (["EVPP337"], "001, 002", "")
    assert cos.parse_course("EVPP 201-DL1 and DL2 Environment and You") == (["EVPP201"], "DL1, DL2", "Environment and You")
    assert cos.parse_course("EVPP 692/991") == (["EVPP692", "EVPP991"], "N/A", "")
    assert cos.parse_course("EVPP 692 991") == (["EVPP692", "EVPP991"], "N/A", "")
    assert cos.parse_course("ASTR 111 003 The Solar System") == (["ASTR111"], "003", "The Solar System")
    assert cos.parse_course("PHYS 160-004 University Physics I") == (["PHYS160"], "004", "University Physics I")
    assert cos.parse_course("BINF 701-001/BINF 701-DL1/BIOS 701-001, Systems Biology") == (
        ["BINF701", "BIOS701"], "001, DL1", "Systems Biology")
    assert cos.parse_course("NEUR 461/592 Transforming Academia") == (["NEUR461", "NEUR592"], "N/A", "Transforming Academia")
    # "IOL" is a typo for BIOL: an unknown subject is dropped, the rest kept.
    assert cos.parse_course("IOL 691-001/BIOS 710-001 Vectors") == (["BIOS710"], "001", "Vectors")
    assert cos.parse_course("LEC") is None
    assert cos.parse_course("Climate Course Repetition Plan") is None


def test_names_and_file_terms():
    assert cos.split_names("Dr. Ronald Resmini") == ["Resmini, Ronald"]
    assert cos.split_names("Professor Burl Self") == ["Self, Burl"]
    assert cos.split_names("A Berea") == ["Berea, A"]
    assert cos.split_names("Smith/Jones") == ["Smith", "Jones"]
    assert cos.split_names("(active learning format) with lab, 2 sections") == ["Staff"]
    assert cos.url_term("https://science.gmu.edu/media/geol-101-syllabus-spring-26") == Term("Spring", 2026)
    assert cos.url_term("https://science.gmu.edu/sites/default/files/2025-09/CLIM429_Syllabus_F2025_x.pdf") == Term("Fall", 2025)
    assert cos.url_term("https://science.gmu.edu/media/fa21-neur-101-lewis") == Term("Fall", 2021)
    assert cos.url_term("http://binf.gmu.edu/Syllabi/Spring2024/biol579_syllabus_S24.pdf") == Term("Spring", 2024)
    assert cos.url_term("https://science.gmu.edu/media/cds-151-russ") is None
    assert cos.column_term("Spr 25") == Term("Spring", 2025)


def test_term_page_table():
    term, rows, _ = page("cos_evpp_spring2021.html")
    assert term == Term("Spring", 2021)
    first = rows[0]
    assert (first.codes, first.section, first.title, first.instructors) == (
        ["EVPP108"], "N/A", "Ecosphere - Introduction to Environmental Science I", ["Largen"])
    assert first.href == "https://science.gmu.edu/media/evpp-108-lecture-spring-2021-largen"
    assert first.source == "gmu-cos"
    assert [r.section for r in rows if r.codes == ["EVPP201"]] == ["DL1, DL2"]

    _, rows, _ = page("cos_phys_spring2021.html")
    assert [(r.codes[0], r.section, r.instructors) for r in rows[:2]] == [
        ("ASTR111", "DL1", ["Belle"]), ("ASTR112", "N/A", ["Ericson"])]


def test_index_links_term_pages():
    _, rows, links = page("cos_evpp_index.html", cos.SITE + "environmental-science-policy/course-syllabi")
    assert rows == []
    assert cos.SITE + "environmental-science-policy/course-syllabi/course-syllabi-fall-2019" in links


def test_grid_takes_term_from_file_then_column():
    _, rows, _ = page("cos_aoes_geology.html")
    geol101 = [r for r in rows if r.codes == ["GEOL101"]]
    assert [r.term.label for r in geol101] == ["Fall 2026", "Spring 2026", "Fall 2025", "Spring 2025", "Fall 2024"]
    assert all(r.instructors == ["Staff"] and r.title == "Physical Geology" for r in geol101)


def test_term_headings():
    _, rows, _ = page("cos_neuroscience.html")
    assert (rows[0].term, rows[0].codes, rows[0].title, rows[0].instructors) == (
        Term("Spring", 2026), ["NEUR101"], "Intro to Neuroscience", ["Guerriero"])
    assert {r.term for r in rows} >= {Term("Fall", 2025), Term("Fall", 2021)}

    _, rows, _ = page("cos_sysbio.html")
    assert (rows[0].term, rows[0].codes, rows[0].section) == (Term("Fall", 2026), ["BINF401"], "DL2")
    assert rows[0].href == "http://binf.gmu.edu/Syllabi/Fall2026/BINF401_Syllabus_F26.pdf"
    assert Term("Spring", 2018) in {r.term for r in rows}


class Pages:
    """A fetcher that serves fixtures by URL."""

    def __init__(self, pages):
        self.pages = pages

    def get(self, url):
        name = self.pages.get(url)
        if not name:
            return None
        return type("Res", (), {"content": (FIXTURES / name).read_bytes()})()


def test_department_rows_follow_term_pages(monkeypatch):
    start = "environmental-science-policy/course-syllabi"
    fetcher = Pages({cos.SITE + start: "cos_evpp_index.html",
                     cos.SITE + start + "/course-syllabi-spring-2021": "cos_evpp_spring2021.html"})
    items = list(cos.department_rows(fetcher, "EVPP", [start], listings.SINCE))
    assert len(items) == 5 and {i.row.term for i in items} == {Term("Spring", 2021)}
    assert all(i.timestamp is None for i in items)
    # Pages before the cutoff are skipped.
    assert list(cos.department_rows(fetcher, "EVPP", [start], Term("Fall", 2021))) == []
