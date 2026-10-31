from pathlib import Path

from syllabus_scraper.parse import Term, parse_codes, parse_index, parse_instructors, parse_term
from syllabus_scraper.store import detect_content_type

FIXTURE = Path(__file__).parent / "fixtures" / "spring2022_index.html"


def test_parses_the_archived_spring_2022_page():
    term, rows = parse_index(FIXTURE.read_text(encoding="utf-8", errors="replace"))
    assert term == Term("Spring", 2022)
    assert len(rows) == 55
    first = rows[0]
    assert first.codes == ["CS100"]
    assert first.section == "001"
    assert first.title == "Principles of Computing"
    assert first.instructors == ["Zaman, A"]
    assert first.href == "/media/syllabi/Spring2022/CS_100ZamanA001.pdf"


def test_rows_carry_their_term():
    _, rows = parse_index(FIXTURE.read_text(encoding="utf-8", errors="replace"))
    assert all(row.term.key == "2022-1" for row in rows)


def test_term_keys_match_the_api():
    assert Term("Spring", 2023).key == "2023-1"
    assert Term("Fall", 2022).key == "2022-3"
    assert parse_term("Fall 2022 Syllabi") == Term("Fall", 2022)
    assert parse_term("nothing here") is None


def test_course_codes():
    assert parse_codes("CS 310") == ["CS310"]
    assert parse_codes("CS471") == ["CS471"]
    assert parse_codes("CS 499/ 695") == ["CS499", "CS695"]
    assert parse_codes("CS/SWE-795") == ["CS795", "SWE795"]
    assert parse_codes("Topics") == []


def test_instructors():
    assert parse_instructors("Zaman, A ") == ["Zaman, A"]
    assert parse_instructors("Kamberi, Otten,  ") == ["Kamberi", "Otten"]
    assert parse_instructors("All,") == ["All instructors"]
    assert parse_instructors("") == ["Staff"]


def test_empty_sections_are_marked():
    _, rows = parse_index(FIXTURE.read_text(encoding="utf-8", errors="replace"))
    game_design = next(r for r in rows if r.codes == ["CS325"])
    assert game_design.section == "N/A"


def test_content_types():
    assert detect_content_type(b"%PDF-1.4 ...", "x.pdf") == "application/pdf"
    assert detect_content_type(b"<html><body>", "x.html").startswith("text/html")
    assert detect_content_type(b"PK\x03\x04", "x.docx") is None
