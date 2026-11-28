from datetime import datetime, timezone

from syllabus_scraper import coverage


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.replaced = []

    def _matches(self, doc, query):
        if not query:
            return True
        for key, cond in query.items():
            if key == "$or":
                if not any(self._matches(doc, sub) for sub in cond):
                    return False
            elif isinstance(cond, dict):
                if "$exists" in cond:
                    exists = key in doc
                    if exists != cond["$exists"]:
                        return False
            else:
                if doc.get(key) != cond:
                    return False
        return True

    def find(self, query=None, projection=None):
        return [d for d in self.docs if self._matches(d, query)]

    def find_one(self, query=None, projection=None):
        for d in self.docs:
            if self._matches(d, query):
                return d
        return None

    def replace_one(self, filt, doc, upsert=False):
        self.replaced.append((filt, doc, upsert))
        for i, existing in enumerate(self.docs):
            if self._matches(existing, filt):
                self.docs[i] = doc
                return
        if upsert:
            self.docs.append(doc)


def make_db(courses=None, syllabus_text=None, coverage_docs=None):
    return {
        "courses": FakeCollection(courses),
        "syllabus_text": FakeCollection(syllabus_text),
        "coverage": FakeCollection(coverage_docs),
    }


def test_compute_coverage_schema_and_sorting():
    fixed_now = datetime(2026, 11, 28, 12, 0, 0, tzinfo=timezone.utc)
    db = make_db(
        courses=[
            {"_id": "CS1010", "dept": "CS", "school": "gmu"},
            {"_id": "CS112", "dept": "CS", "school": "gmu"},
            {"_id": "CS310", "dept": "CS", "school": "gmu"},
            {"_id": "CS99", "dept": "CS", "school": "gmu"},
            {"_id": "MATH113", "dept": "MATH", "school": "gmu"},
            {"_id": "MATH114", "dept": "MATH", "school": "gmu"},
            {"_id": "MATH213", "dept": "MATH", "school": "gmu"},
            {"_id": "BIOL101", "dept": "BIOL", "school": "gmu"},
            {"_id": "BIOL102", "dept": "BIOL", "school": "gmu"},
            {"_id": "HIST100", "dept": "HIST"},  # legacy GMU doc without explicit school
        ],
        syllabus_text=[
            {"_id": "f1", "codes": ["CS112"]},
            {"_id": "f2", "codes": ["MATH 113"]},  # spaced form still matches
            {"_id": "f3", "codes": ["unc:COMP110"]},  # other school ignored for gmu
        ],
    )

    doc = coverage.compute_coverage(db, school="gmu", now=fixed_now)

    assert doc["_id"] == "gmu"
    assert doc["school"] == "gmu"
    assert doc["computedAt"] == fixed_now
    assert doc["totals"] == {"courses": 10, "withSyllabi": 2, "withoutSyllabi": 8}

    # CS: 3 missing, BIOL: 2 missing, MATH: 2 missing (tie -> BIOL before MATH), HIST: 1 missing
    assert [d["dept"] for d in doc["departments"]] == ["CS", "BIOL", "MATH", "HIST"]

    cs = doc["departments"][0]
    assert cs == {
        "dept": "CS",
        "courses": 4,
        "withSyllabi": 1,
        "withoutSyllabi": 3,
        "missingCourses": ["CS 99", "CS 310", "CS 1010"],
    }
    assert doc["departments"][1]["missingCourses"] == ["BIOL 101", "BIOL 102"]
    assert doc["departments"][2]["missingCourses"] == ["MATH 114", "MATH 213"]
    assert doc["departments"][3]["missingCourses"] == ["HIST 100"]


def test_compute_coverage_isolates_non_gmu_school():
    db = make_db(
        courses=[
            {"_id": "CS310", "dept": "CS", "school": "gmu"},
            {"_id": "unc:COMP110", "dept": "unc:COMP", "school": "unc"},
            {"_id": "unc:COMP210", "dept": "unc:COMP", "school": "unc"},
        ],
        syllabus_text=[
            {"_id": "f1", "codes": ["CS310"]},
            {"_id": "f2", "codes": ["unc:COMP110"]},
        ],
    )

    doc = coverage.compute_coverage(db, school="unc")
    assert doc["_id"] == "unc"
    assert doc["totals"] == {"courses": 2, "withSyllabi": 1, "withoutSyllabi": 1}
    assert doc["departments"] == [
        {
            "dept": "COMP",
            "courses": 2,
            "withSyllabi": 1,
            "withoutSyllabi": 1,
            "missingCourses": ["COMP 210"],
        }
    ]


def test_run_coverage_writes_only_when_enabled():
    db = make_db(courses=[{"_id": "CS310", "dept": "CS", "school": "gmu"}])

    doc_dry = coverage.run_coverage(db, school="gmu", write=False)
    assert doc_dry["totals"]["withoutSyllabi"] == 1
    assert db["coverage"].replaced == []

    doc_written = coverage.run_coverage(db, school="gmu", write=True)
    assert len(db["coverage"].replaced) == 1
    filt, saved, upsert = db["coverage"].replaced[0]
    assert filt == {"_id": "gmu"} and upsert is True and saved == doc_written


def test_get_or_compute_coverage_uses_cached_doc_or_computes():
    cached = {
        "_id": "gmu",
        "school": "gmu",
        "totals": {"courses": 1, "withSyllabi": 0, "withoutSyllabi": 1},
        "departments": [{"dept": "CS", "courses": 1, "withSyllabi": 0, "withoutSyllabi": 1, "missingCourses": ["CS 310"]}],
    }
    db_cached = make_db(coverage_docs=[cached])
    assert coverage.get_or_compute_coverage(db_cached, "gmu") == cached

    db_empty = make_db(courses=[{"_id": "CS310", "dept": "CS", "school": "gmu"}])
    computed = coverage.get_or_compute_coverage(db_empty, "gmu")
    assert computed["totals"] == {"courses": 1, "withSyllabi": 0, "withoutSyllabi": 1}
    assert db_empty["coverage"].replaced == []


def test_format_summary_handles_empty_and_populated():
    empty_doc = {
        "_id": "gmu",
        "school": "gmu",
        "totals": {"courses": 0, "withSyllabi": 0, "withoutSyllabi": 0},
        "departments": [],
    }
    summary = coverage.format_summary(empty_doc)
    assert "0/0 courses have syllabi (0.0%)" in summary

    populated = {
        "_id": "gmu",
        "school": "gmu",
        "totals": {"courses": 100, "withSyllabi": 40, "withoutSyllabi": 60},
        "departments": [
            {"dept": "MATH", "courses": 50, "withSyllabi": 10, "withoutSyllabi": 40, "missingCourses": []},
            {"dept": "CS", "courses": 50, "withSyllabi": 30, "withoutSyllabi": 20, "missingCourses": []},
        ],
    }
    text = coverage.format_summary(populated)
    assert "40/100 courses have syllabi (40.0%), 60 missing across 2 departments" in text
    assert "MATH" in text and "CS" in text


def test_scrape_cli_coverage_mode(monkeypatch, capsys):
    import scrape

    db = make_db(
        courses=[
            {"_id": "CS112", "dept": "CS", "school": "gmu"},
            {"_id": "CS310", "dept": "CS", "school": "gmu"},
        ],
        syllabus_text=[{"_id": "f1", "codes": ["CS112"]}],
    )
    fake_store = type("FakeStore", (), {"db": db})()
    monkeypatch.setattr(scrape, "Store", lambda: fake_store)
    monkeypatch.setattr(scrape, "load_dotenv", lambda: None)

    assert scrape.main(["--coverage", "--school", "gmu"]) == 0
    out = capsys.readouterr().out
    assert "Coverage for gmu: 1/2 courses have syllabi (50.0%), 1 missing" in out
    assert len(db["coverage"].replaced) == 1

    # --dry-run computes and prints without writing
    db["coverage"].replaced.clear()
    assert scrape.main(["--coverage", "--school", "gmu", "--dry-run"]) == 0
    assert db["coverage"].replaced == []

