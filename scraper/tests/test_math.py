from pathlib import Path

from syllabus_scraper import math
from syllabus_scraper.parse import Term

FIXTURES = Path(__file__).parent / "fixtures"


def read(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_course_cells():
    assert math.parse_course_cell("105-001 (Precalculus)") == ("MATH105", "001", "Precalculus")
    assert math.parse_course_cell("106-001\xa0(Quantitative Reasoning)") == ("MATH106", "001", "Quantitative Reasoning")
    assert math.parse_course_cell("105-DL1 (Precalculus)") == ("MATH105", "DL1", "Precalculus")
    assert math.parse_course_cell("MATH 113-002/003") == ("MATH113", "002, 003", "")
    assert math.parse_course_cell("214 (Elementary Differential Equations)") == ("MATH214", "N/A", "Elementary Differential Equations")
    assert math.parse_course_cell("STAT 344-001") == ("STAT344", "001", "")
    assert math.parse_course_cell("Course") is None


def test_term_page_rows_and_menu():
    html = read("math_spring2022.html")
    term, rows = math.parse_term_page(html)
    assert term == Term("Spring", 2022)
    assert [(r.codes, r.section, r.instructors) for r in rows[:3]] == [
        (["MATH105"], "001", ["Yusko"]),
        (["MATH105"], "002", ["Gaffney"]),
        (["MATH105"], "DL1", ["Sausville"]),
    ]
    assert rows[0].href == "https://science.gmu.edu/media/math105-yusko-spring2022"
    assert rows[0].title == "Precalculus" and rows[0].source == "gmu-math"
    assert len(rows) == 5  # the header row has no link

    pages = dict(math.menu_pages(html))
    assert pages[Term("Spring", 2022)] == f"{math.PAGES}/course-10"
    assert pages[Term("Fall", 2017)] == f"{math.PAGES}/course"
    assert list(pages)[0] == Term("Fall", 2017)  # oldest first


def test_folder_listing():
    rows = math.parse_folder(read("math_folder_s18.html"), "https://math.gmu.edu/syllabi/S18/", Term("Spring", 2018))
    assert [(r.codes[0], r.section, r.instructors) for r in rows] == [
        ("MATH105", "001", ["Andreani"]),
        ("MATH105", "003", ["Preston"]),
        ("MATH105", "DL1", ["Sausville"]),
        ("MATH106", "001", ["Haile"]),
        ("MATH113", "N/A", ["Sausville"]),
    ]
    assert rows[0].href == "https://math.gmu.edu/syllabi/S18/105-001%20-%20Andreani.pdf"
    # Spring 2019 dropped the dash: "105-001 Andreani.pdf"
    row = math.parse_folder_file("105-001 Andreani.pdf", Term("Spring", 2019))
    assert (row.codes, row.section, row.instructors) == (["MATH105"], "001", ["Andreani"])


def test_folder_terms():
    assert math.folder_term("S18") == Term("Spring", 2018)
    assert math.folder_term("F18/") == Term("Fall", 2018)
    assert math.folder_term("U19") == Term("Summer", 2019)
    assert math.folder_term("old") is None


def test_media_slugs_need_a_term():
    row = math.parse_media_slug("https://science.gmu.edu/media/math-213-bryan-summer-2023")
    assert (row.codes, row.section, row.instructors, row.term) == (["MATH213"], "N/A", ["Bryan"], Term("Summer", 2023))
    row = math.parse_media_slug("http://science.gmu.edu:80/media/math125-004-bruschi-spring2022")
    assert (row.codes, row.section, row.instructors, row.term) == (["MATH125"], "004", ["Bruschi"], Term("Spring", 2022))
    row = math.parse_media_slug("https://science.gmu.edu/media/math-124-macrina-summer-21")
    assert row.term == Term("Summer", 2021)
    row = math.parse_media_slug("https://science.gmu.edu/media/math-271-bray-and-yusko-fall-2021")
    assert row.instructors == ["Bray", "Yusko"]
    assert math.parse_media_slug("https://science.gmu.edu/media/106-calderon-0") is None
    assert math.parse_media_slug("https://science.gmu.edu/media/math-113-syllabus") is None
