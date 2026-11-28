"""Computes per-school and per-department syllabus coverage from MongoDB.

Reads the catalog (`courses`) and indexed syllabi (`syllabus_text`) from MongoDB
and writes one summary document per school to the `coverage` collection.

Shared schema with api/client:
{
    "_id": "gmu",
    "school": "gmu",
    "computedAt": <datetime>,
    "totals": {"courses": 100, "withSyllabi": 40, "withoutSyllabi": 60},
    "departments": [
        {
            "dept": "CS",
            "courses": 50,
            "withSyllabi": 30,
            "withoutSyllabi": 20,
            "missingCourses": ["CS 310", "CS 321"],
        }
    ],
}
"""

from collections import defaultdict
from datetime import datetime, timezone
import re

from .schools import DEFAULT_SCHOOL


def strip_school_prefix(code):
    """'unc:COMP110' -> 'COMP110', 'CS310' -> 'CS310'."""
    _, sep, bare = (code or "").rpartition(":")
    return bare if sep else (code or "")


def canonical_code(code, school=DEFAULT_SCHOOL):
    """Normalizes spacing/case so catalog codes and syllabus codes match reliably.
    'CS 310' -> 'CS310', 'unc:COMP 110' -> 'unc:COMP110', 'gmu:CS 310' -> 'CS310'."""
    raw = (code or "").strip()
    prefix, sep, bare = raw.rpartition(":")
    compact = re.sub(r"\s+", "", bare).upper()
    if sep:
        prefix = prefix.strip().lower()
        if prefix == DEFAULT_SCHOOL:
            return compact
        return f"{prefix}:{compact}"
    if school and school != DEFAULT_SCHOOL:
        return f"{school}:{compact}"
    return compact


def display_code(code):
    """Formats a course code for display and search: 'CS310' -> 'CS 310', 'unc:COMP110' -> 'COMP 110'."""
    bare = re.sub(r"\s+", "", strip_school_prefix(code)).upper()
    return re.sub(r"^([A-Z]+)(\d.*)$", r"\1 \2", bare)


def natural_sort_key(code):
    """Sort key that orders 'CS 99' < 'CS 100' < 'CS 100A' < 'CS 310' < 'CS 1010'."""
    return [int(part) if part.isdigit() else part.upper() for part in re.split(r"(\d+)", code or "")]


def _code_belongs_to_school(code, school):
    raw = (code or "").strip()
    if not raw:
        return False
    if ":" not in raw:
        return school == DEFAULT_SCHOOL
    prefix = raw.split(":", 1)[0].strip().lower()
    return prefix == school


def _dept_of(course_doc):
    dept = course_doc.get("dept")
    if dept:
        return strip_school_prefix(dept).strip().upper()
    bare = strip_school_prefix(course_doc.get("_id", "")).strip().upper()
    match = re.match(r"([A-Z]+)", bare)
    return match.group(1) if match else bare


def compute_coverage(db, school=DEFAULT_SCHOOL, now=None):
    """Computes the coverage document for `school` using MongoDB `courses` and `syllabus_text`."""
    school = (school or DEFAULT_SCHOOL).strip().lower()
    if school == DEFAULT_SCHOOL:
        course_query = {"$or": [{"school": school}, {"school": {"$exists": False}}]}
    else:
        course_query = {"school": school}

    covered = set()
    for doc in db["syllabus_text"].find({}, {"codes": 1}):
        for code in doc.get("codes") or []:
            if _code_belongs_to_school(code, school):
                covered.add(canonical_code(code, school=school))

    by_dept = defaultdict(dict)
    for course in db["courses"].find(course_query, {"_id": 1, "dept": 1, "school": 1}):
        course_id = course.get("_id")
        if not course_id:
            continue
        dept = _dept_of(course)
        key = canonical_code(course_id, school=school)
        by_dept[dept][key] = display_code(course_id)

    departments = []
    for dept, courses_map in by_dept.items():
        total = len(courses_map)
        missing = sorted(
            (disp for key, disp in courses_map.items() if key not in covered),
            key=natural_sort_key,
        )
        with_syllabi = total - len(missing)
        departments.append(
            {
                "dept": dept,
                "courses": total,
                "withSyllabi": with_syllabi,
                "withoutSyllabi": len(missing),
                "missingCourses": missing,
            }
        )

    departments.sort(key=lambda d: (-d["withoutSyllabi"], d["dept"]))

    totals = {
        "courses": sum(d["courses"] for d in departments),
        "withSyllabi": sum(d["withSyllabi"] for d in departments),
        "withoutSyllabi": sum(d["withoutSyllabi"] for d in departments),
    }

    return {
        "_id": school,
        "school": school,
        "computedAt": now if now is not None else datetime.now(timezone.utc),
        "totals": totals,
        "departments": departments,
    }


def save_coverage(db, doc):
    """Upserts the coverage document into MongoDB `coverage` collection."""
    db["coverage"].replace_one({"_id": doc["_id"]}, doc, upsert=True)
    return doc


def run_coverage(db, school=DEFAULT_SCHOOL, write=True, now=None):
    """Computes coverage and optionally writes it to MongoDB `coverage`."""
    doc = compute_coverage(db, school=school, now=now)
    if write:
        save_coverage(db, doc)
    return doc


def get_or_compute_coverage(db, school=DEFAULT_SCHOOL, now=None):
    """Returns the saved coverage document for `school`, or computes it on the fly."""
    school = (school or DEFAULT_SCHOOL).strip().lower()
    existing = db["coverage"].find_one({"_id": school})
    if existing:
        return existing
    return compute_coverage(db, school=school, now=now)


def format_summary(doc, max_departments=None):
    """Returns a human-readable multi-line coverage summary."""
    totals = doc["totals"]
    total_courses = totals["courses"]
    with_syllabi = totals["withSyllabi"]
    without_syllabi = totals["withoutSyllabi"]
    pct = (100.0 * with_syllabi / total_courses) if total_courses else 0.0

    lines = [
        f"Coverage for {doc['school']}: {with_syllabi}/{total_courses} courses have syllabi "
        f"({pct:.1f}%), {without_syllabi} missing across {len(doc['departments'])} departments"
    ]
    depts = doc["departments"]
    shown = depts if max_departments is None else depts[:max_departments]
    for d in shown:
        dpct = (100.0 * d["withSyllabi"] / d["courses"]) if d["courses"] else 0.0
        lines.append(
            f"  {d['dept']:<8} {d['withSyllabi']:>4}/{d['courses']:<4} ({dpct:5.1f}%)  "
            f"{d['withoutSyllabi']} missing"
        )
    if max_departments is not None and len(depts) > max_departments:
        lines.append(f"  ... and {len(depts) - max_departments} more departments")
    return "\n".join(lines)
