from syllabus_scraper import listings
from syllabus_scraper.listings import Listed
from syllabus_scraper.parse import Row, Term

PDF = b"%PDF-1.4 Grading: Homework 20% Quizzes 30% Final Exam 50%. Attendance is expected at every class meeting. " + b"x" * 200


def listed(code, term, section="001", href=None, names=("Smith",)):
    href = href or f"https://example.edu/{code}-{section}-{term.season}{term.year}.pdf"
    return Listed(Row(codes=[code], section=section, title="", instructors=list(names), href=href, term=term,
                      source="test"))


SPRING, FALL = Term("Spring", 2020), Term("Fall", 2021)


def test_choose_drops_repeats_and_keeps_every_math_syllabus():
    items = [
        listed("MATH113", SPRING, "001"),
        listed("MATH113", SPRING, "001"),  # same URL
        listed("MATH113", SPRING, "001", href="https://example.edu/other-name.pdf"),  # same section, other file
        listed("MATH113", FALL, "002"),
        listed("MATH113", SPRING, "N/A", href="https://example.edu/a.pdf"),
        listed("MATH113", SPRING, "N/A", href="https://example.edu/b.pdf"),  # no section: can't tell, keep both
    ]
    chosen = listings.choose(items)
    assert [(i.row.term.label, i.row.section) for i in chosen] == [
        ("Spring 2020", "001"), ("Fall 2021", "002"), ("Spring 2020", "N/A"), ("Spring 2020", "N/A")]


def test_choose_keeps_only_the_newest_syllabus_of_other_subjects():
    items = [listed("HEAL325", SPRING), listed("HEAL325", FALL, "002"), listed("HEAL325", FALL, "003"),
             listed("EDUC500", SPRING)]
    chosen = listings.choose(items)
    assert [(i.row.codes[0], i.row.term.label, i.row.section) for i in chosen] == [
        ("HEAL325", "Fall 2021", "002"), ("EDUC500", "Spring 2020", "001")]


class FakeStore:
    def __init__(self, offerings=None, full=False):
        self.offerings = offerings or {}
        self.full = full
        self.files, self.saved, self.texts, self.summaries, self.removed = {}, [], {}, {}, []

    def is_curated(self, url):
        return url.endswith("curated.pdf")

    def file_for(self, url):
        return self.files.get(url)

    def course_offerings(self, code):
        return self.offerings.get(code, [])

    def remove_offering(self, offering):
        self.removed.append(offering)

    def content_type(self, data, url):
        return "application/pdf" if data.startswith(b"%PDF-") else None

    def save_file(self, data, url, content_type):
        if self.full:
            return None
        file_id = f"{len(self.files):024x}"
        self.files[url] = (file_id, content_type)
        return file_id

    def course_title(self, code):
        return "Calculus" if code == "MATH113" else None

    def save_offering(self, dept, code, row, file_id, content_type, url):
        self.saved.append((dept, code, row.title, file_id, url))

    def save_text(self, file_id, doc):
        self.texts[file_id] = doc

    def save_summary(self, file_id, summary, provider):
        self.summaries[file_id] = (provider, summary)


def fake_fetch(monkeypatch, data=PDF):
    calls = []

    def fetch_file(fetcher, href, timestamp=None):
        calls.append((href, timestamp))
        return data, href

    monkeypatch.setattr(listings.sources, "fetch_file", fetch_file)
    monkeypatch.setattr(listings, "extract_text", lambda data, ct: data.decode("latin-1"))
    return calls


def test_save_one_keeps_a_copy_text_and_rule_summary(monkeypatch):
    calls = fake_fetch(monkeypatch)
    store = FakeStore()
    item = listed("MATH113", SPRING, href="https://math.gmu.edu/syllabi/S18/113-001%20-%20Smith.pdf")
    item.timestamp = "20200101000000"
    assert listings.save_one(store, None, item) == "saved"
    assert calls == [("https://math.gmu.edu/syllabi/S18/113-001%20-%20Smith.pdf", "20200101000000")]
    (dept, code, title, file_id, url), = store.saved
    assert (dept, code, title) == ("MATH", "MATH113", "Calculus")
    assert url == "https://math.gmu.edu/syllabi/S18/113-001 - Smith.pdf"  # decoded, like the CS source
    assert store.texts[file_id]["codes"] == ["MATH113"] and store.texts[file_id]["termKey"] == SPRING.key
    provider, summary = store.summaries[file_id]
    assert provider == "rules" and summary["grading"][0] == {"item": "Homework", "weight": "20%"}
    # A second run finds the file and does nothing.
    assert listings.save_one(store, None, item) == "exists"
    assert len(calls) == 1


def test_save_one_skips_curated_and_non_files(monkeypatch):
    fake_fetch(monkeypatch, data=b"PK\x03\x04 a docx")
    store = FakeStore()
    assert listings.save_one(store, None, listed("MATH113", SPRING, href="https://x.edu/curated.pdf")) == "exists"
    assert listings.save_one(store, None, listed("MATH113", SPRING)) == "skipped"
    assert store.saved == []


def test_newer_syllabus_replaces_older_scraped_ones_outside_keep_all(monkeypatch):
    fake_fetch(monkeypatch)
    older = {"PK": "COURSE#HEAL325", "SK": "TERM#2020-1#SEC#001#a", "termKey": SPRING.key, "termLabel": "Spring 2020",
             "source": "gmu-cehd", "sourceUrl": "https://x.edu/old.pdf", "code": "HEAL325", "fileId": "a"}
    upload = {**older, "SK": "TERM#2019-3#SEC#001#b", "termKey": "2019-3", "source": "upload"}
    store = FakeStore({"HEAL325": [older, upload]})
    assert listings.save_one(store, None, listed("HEAL325", FALL)) == "saved"
    assert store.removed == [older]  # the student upload stays

    store = FakeStore({"HEAL325": [{**older, "termKey": FALL.key}]})
    assert listings.save_one(store, None, listed("HEAL325", SPRING)) == "skipped"
    assert store.saved == []


def test_save_all_stops_at_the_limit_and_when_storage_is_full(monkeypatch):
    fake_fetch(monkeypatch)
    items = [listed("MATH113", SPRING, s) for s in ("001", "002", "003")]
    counts = listings.save_all(FakeStore(), None, items, limit=2)
    assert counts == {"saved": 2, "exists": 0, "skipped": 0}

    counts = listings.save_all(FakeStore(full=True), None, items)
    assert counts["saved"] == 0 and counts["full"] is True
