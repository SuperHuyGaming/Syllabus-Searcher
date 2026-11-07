import re
from pathlib import Path

from syllabus_scraper.catalog import parse_catalog, parse_departments

PAGE = (Path(__file__).parent / "fixtures" / "catalog_cs.html").read_text(encoding="utf-8")


def test_reads_every_course_block():
    courses = {c["code"]: c for c in parse_catalog(PAGE)}
    assert list(courses) == ["CS100", "CS112", "CS211", "CS799"]
    assert courses["CS211"]["title"] == "Object-Oriented Programming"
    assert courses["CS799"]["credits"] == "1-6"
    assert courses["CS112"]["credits"] == "4"


def test_description_stops_before_the_offered_by_line():
    cs100 = parse_catalog(PAGE)[0]
    assert cs100["description"].startswith("This course is intended to help students")
    assert "Offered by" not in cs100["description"]


def test_prerequisites_are_plain_text_with_grades():
    courses = {c["code"]: c for c in parse_catalog(PAGE)}
    assert courses["CS211"]["prereqs"] == "CS 112 (C), 112 (XS) or 109 (C)"
    assert courses["CS100"]["prereqs"] == ""


def test_other_departments_are_ignored():
    assert parse_catalog(PAGE, dept="MATH") == []


INDEX = (Path(__file__).parent / "fixtures" / "catalog_index.html").read_text(encoding="utf-8")


def test_reads_each_department_once_from_the_a_to_z_list():
    departments = parse_departments(INDEX)
    assert [d["code"] for d in departments] == ["ACCT", "CS", "OSCM", "LAWG", "ISM"]
    oscm = departments[2]
    assert oscm["name"] == "Operations & Supply Chain Management"
    assert oscm["slug"] == "operations--supply-chain-management"
    assert departments[3]["name"] == "Law-Grad Law"


FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_odu_lists_departments_as_code_dash_name_without_an_a_to_z_box():
    departments = parse_departments(fixture("catalog_odu_index.html"))
    assert [d["code"] for d in departments] == ["AAST", "ACCT", "AI", "AL"]
    assert departments[0] == {"code": "AAST", "name": "African-American Studies", "slug": "aast"}


def test_georgia_tech_departments_live_under_coursesaz():
    departments = parse_departments(fixture("catalog_gatech_index.html"), prefix="/coursesaz/")
    assert [d["slug"] for d in departments] == ["acct", "ae", "as", "apph"]
    assert parse_departments(fixture("catalog_gatech_index.html")) == []


def test_georgia_tech_reads_the_whole_heading_with_four_digit_numbers():
    courses = parse_catalog(fixture("catalog_gatech_cs.html"), dept="CS")
    assert [c["code"] for c in courses] == ["CS1100", "CS1171", "CS1301", "CS1301R"]
    assert courses[0]["title"] == "Pathways in Computing"
    assert courses[0]["credits"] == "1"
    assert courses[2]["credits"] == "3"
    assert courses[0]["description"].startswith("Small group discussions")


def test_unc_reads_detail_spans_and_skips_two_digit_seminars():
    courses = parse_catalog(fixture("catalog_unc_comp.html"), dept="COMP")
    assert len(courses) == 2  # "COMP 50" first-year seminar is skipped: codes have 3-4 digits
    first = courses[0]
    assert re.fullmatch(r"COMP\d{3}[A-Z]?", first["code"])
    assert first["title"] and not first["title"].endswith(".")
    assert re.fullmatch(r"[\d.-]+", first["credits"])
    assert first["description"]


def test_odu_reads_xref_codes_and_credit_hours_in_parentheses():
    courses = parse_catalog(fixture("catalog_odu_cs.html"), dept="CS")
    assert courses[0]["code"] == "CS112"
    assert courses[0]["title"] == "Information Literacy for Former Engineering Majors"
    assert courses[0]["credits"] == "1"
    assert courses[0]["description"].startswith("The objective of this course")
