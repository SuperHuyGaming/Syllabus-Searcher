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
