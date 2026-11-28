from syllabus_scraper import catalog, listings
from syllabus_scraper.listings import Listed
from syllabus_scraper.parse import Row, Term
from syllabus_scraper.store import Store
from syllabus_scraper.topics import (
    determine_topic,
    extract_raw_text,
    extract_topic_from_listing,
    extract_topic_from_text,
    is_special_topics_course,
)

SPRING = Term("Spring", 2025)
FALL = Term("Fall", 2026)


# --- 1. Special-topics catalog detection ---


def test_is_special_topics_course_matches_titles():
    assert is_special_topics_course("Special Topics in Computer Science")
    assert is_special_topics_course("Special Topics")
    assert is_special_topics_course("Selected Topics in Mathematics")
    assert is_special_topics_course("Topics in Software Engineering")
    assert is_special_topics_course("Topics: Artificial Intelligence")
    assert is_special_topics_course("SPECIAL TOPICS: AI, Technology & Society")


def test_is_special_topics_course_matches_repeatable_with_topic():
    assert is_special_topics_course(
        "Advanced Seminar",
        description="May be repeated for credit when topic is distinctly different.",
    )
    assert is_special_topics_course(
        "Research Seminar",
        description="In-depth study of a current research topic.",
        notes="May be repeated up to 9 credits.",
    )
    assert is_special_topics_course(
        "Graduate Seminar",
        notes="May be repeated within the degree as topics vary.",
    )


def test_is_special_topics_course_rejects_normal_and_non_topic_repeatable():
    assert not is_special_topics_course("Data Structures")
    assert not is_special_topics_course("MS Thesis", notes="May be repeated within the degree for a maximum 6 credits.")
    assert not is_special_topics_course("Algorithms", description="Covers many topics in algorithm design.")
    assert not is_special_topics_course("", "", "")
    assert not is_special_topics_course(None, None, None)


def test_catalog_flags_special_topics_including_notes_after_offered_by():
    html = """
    <html><body>
      <div class="courseblock">
        <div class="courseblocktitle"><strong class="cb_code">CS 399:</strong> <em class="cb_title">Special Topics in Computer Science.</em> 3 credits.</div>
        <div class="courseblockdesc">Variable content. Offered by <a href="#">Computer Science</a>.</div>
      </div>
      <div class="courseblock">
        <div class="courseblocktitle"><strong class="cb_code">CS 499:</strong> <em class="cb_title">Computer Science Seminar.</em> 3 credits.</div>
        <div class="courseblockdesc">Advanced seminar. Offered by <a href="#">Computer Science</a>. May be repeated for credit when topic is distinctly different.</div>
      </div>
      <div class="courseblock">
        <div class="courseblocktitle"><strong class="cb_code">CS 310:</strong> <em class="cb_title">Data Structures.</em> 3 credits.</div>
        <div class="courseblockdesc">Standard data structures. Offered by <a href="#">Computer Science</a>.</div>
      </div>
      <div class="courseblock">
        <div class="courseblocktitle"><strong class="cb_code">CS 799:</strong> <em class="cb_title">MS Thesis.</em> 1-6 credits.</div>
        <div class="courseblockdesc">Thesis research. Offered by <a href="#">Computer Science</a>. May be repeated for a maximum of 6 credits.</div>
      </div>
    </body></html>
    """
    courses = {c["code"]: c for c in catalog.parse_catalog(html, dept="CS")}
    assert courses["CS399"]["specialTopics"] is True
    assert courses["CS499"]["specialTopics"] is True
    assert courses["CS310"]["specialTopics"] is False
    assert courses["CS799"]["specialTopics"] is False


# --- 2. Per-offering topic extraction ---


def test_extract_topic_from_listing_strips_prefixes_and_detects_real_subject():
    cat = "Special Topics in Computer Science"
    assert extract_topic_from_listing("AI, Technology & Society", cat, ["CS399"]) == "AI, Technology & Society"
    assert extract_topic_from_listing("Special Topics: AI, Technology & Society", cat, ["CS399"]) == "AI, Technology & Society"
    assert extract_topic_from_listing("CS 399 - Special Topics in Computer Science: Quantum Computing", cat, ["CS399"]) == "Quantum Computing"
    assert extract_topic_from_listing("SWE 699: Software Supply Chain Security (Fall 2026)", "Special Topics in Software Engineering", ["SWE699"]) == "Software Supply Chain Security"
    assert extract_topic_from_listing("Special Topics in Quantum Computing", cat, ["CS399"]) == "Quantum Computing"


def test_extract_topic_from_listing_returns_empty_when_same_as_catalog_or_generic():
    cat = "Special Topics in Computer Science"
    assert extract_topic_from_listing(cat, cat, ["CS399"]) == ""
    assert extract_topic_from_listing("CS 399: Special Topics in Computer Science", cat, ["CS399"]) == ""
    assert extract_topic_from_listing("Special Topics", cat, ["CS399"]) == ""
    assert extract_topic_from_listing("CS 399", cat, ["CS399"]) == ""
    assert extract_topic_from_listing("", cat, ["CS399"]) == ""


def test_extract_topic_from_text_picks_first_strong_heading_skipping_boilerplate():
    text = (
        "George Mason University\n"
        "Department of Computer Science\n"
        "CS 399 - Fall 2026\n"
        "Course Syllabus\n"
        "AI, Technology & Society\n"
        "Instructor: Dr. Jane Doe\n"
        "Office Hours: Mon 2-4pm\n"
    )
    assert extract_topic_from_text(text, codes=["CS399"], catalog_title="Special Topics in Computer Science") == "AI, Technology & Society"


def test_extract_topic_from_text_handles_code_prefixed_heading_and_single_line():
    multiline = "SWE 699: Software Supply Chain Security\nSpring 2025\nInstructor: Prof. Smith"
    assert extract_topic_from_text(multiline, codes=["SWE699"], catalog_title="Special Topics in Software Engineering") == "Software Supply Chain Security"

    single_line = "George Mason University CS 499 Special Topics: Autonomous Robotics Instructor: Dr. Lee"
    assert extract_topic_from_text(single_line, codes=["CS499"], catalog_title="Special Topics in Computer Science") == "Autonomous Robotics"


def test_extract_topic_from_text_returns_empty_for_boilerplate_or_empty():
    boilerplate = (
        "George Mason University\n"
        "Department of History\n"
        "HIST 388\n"
        "Fall 2026\n"
        "Syllabus\n"
        "Instructor: Dr. Smith\n"
        "Email: smith@gmu.edu\n"
        "This course examines historical methods and primary sources across multiple periods in detail.\n"
    )
    assert extract_topic_from_text(boilerplate, codes=["HIST388"], catalog_title="Topics in History") == ""
    assert extract_topic_from_text("", codes=["CS399"]) == ""


def test_determine_topic_prefers_listing_over_text():
    text = "CS 399\nText Heading Topic\nInstructor: Jane"
    assert determine_topic("Special Topics: Listing Topic", "Special Topics in Computer Science", text, ["CS399"]) == "Listing Topic"
    assert determine_topic("Special Topics in Computer Science", "Special Topics in Computer Science", text, ["CS399"]) == "Text Heading Topic"


def test_extract_raw_text_preserves_html_headings():
    html = b"<html><body><h1>George Mason University</h1><h2>CS 399</h2><h3>AI, Technology &amp; Society</h3><p>Instructor: Smith</p></body></html>"
    raw = extract_raw_text(html, "text/html; charset=utf-8")
    assert extract_topic_from_text(raw, codes=["CS399"], catalog_title="Special Topics in Computer Science") == "AI, Technology & Society"


# --- 3. Listings: keep every syllabus for special-topics & pass topic to store ---


def _listed(code, term, section="001", title="", href=None, names=("Smith",)):
    href = href or f"https://example.edu/{code}-{section}-{term.season}{term.year}.pdf"
    return Listed(Row(codes=[code], section=section, title=title, instructors=list(names), href=href, term=term, source="test"))


def test_choose_keeps_every_term_and_section_for_special_topics_courses():
    items = [
        _listed("SWE699", SPRING, "001", title="Software Testing"),
        _listed("SWE699", FALL, "001", title="Cloud Security"),
        _listed("SWE699", FALL, "002", title="AI Engineering"),
        _listed("HIST388", SPRING, "001", title="Topics in History: Cold War"),
        _listed("HIST388", FALL, "001", title="Topics in History: Roman Empire"),
        _listed("HEAL325", SPRING, "001", title="Health"),
        _listed("HEAL325", FALL, "001", title="Health"),
    ]
    chosen = listings.choose(items, special_topics={"SWE699"})
    assert [(i.row.codes[0], i.row.term.label, i.row.section) for i in chosen] == [
        ("SWE699", "Spring 2025", "001"),
        ("SWE699", "Fall 2026", "001"),
        ("SWE699", "Fall 2026", "002"),
        ("HIST388", "Spring 2025", "001"),
        ("HIST388", "Fall 2026", "001"),
        ("HEAL325", "Fall 2026", "001"),
    ]


class FakeTopicStore:
    def __init__(self, special=None, titles=None, offerings=None):
        self.special = set(special or ())
        self.titles = dict(titles or {})
        self.offerings = dict(offerings or {})
        self.files = {}
        self.saved = []
        self.texts = {}
        self.summaries = {}
        self.removed = []

    def is_curated(self, url):
        return False

    def file_for(self, url):
        return self.files.get(url)

    def is_special_topics(self, code):
        return code in self.special

    def course_offerings(self, code):
        return self.offerings.get(code, [])

    def remove_offering(self, offering):
        self.removed.append(offering)

    def content_type(self, data, url):
        if data.startswith(b"%PDF-"):
            return "application/pdf"
        if data.lstrip().lower().startswith(b"<html"):
            return "text/html; charset=utf-8"
        return None

    def save_file(self, data, url, content_type):
        fid = f"{len(self.files):024x}"
        self.files[url] = (fid, content_type)
        return fid

    def course_title(self, code):
        return self.titles.get(code)

    def save_offering(self, dept, code, row, file_id, content_type, url, topic=None):
        self.saved.append({"dept": dept, "code": code, "title": row.title, "file_id": file_id, "topic": topic})

    def save_text(self, file_id, doc):
        self.texts[file_id] = doc

    def save_summary(self, file_id, summary, provider):
        self.summaries[file_id] = (provider, summary)


def test_save_all_keeps_all_special_topics_and_extracts_topic(monkeypatch):
    pdf_with_heading = (
        b"%PDF-1.4\nGeorge Mason University\nSWE 699\nSpring 2025\n"
        b"AI, Technology & Society\nInstructor: Dr. Ada\n"
    )
    monkeypatch.setattr(listings.sources, "fetch_file", lambda f, href, ts=None: (pdf_with_heading, href))
    monkeypatch.setattr(listings, "extract_text", lambda data, ct: data.decode("latin-1"))

    older = {
        "PK": "COURSE#SWE699", "SK": "TERM#2024-3#SEC#001#old",
        "termKey": "2024-3", "termLabel": "Fall 2024", "source": "test",
        "sourceUrl": "https://example.edu/old.pdf", "code": "SWE699", "fileId": "old",
    }
    store = FakeTopicStore(
        special={"SWE699"},
        titles={"SWE699": "Special Topics in Software Engineering"},
        offerings={"SWE699": [older]},
    )
    items = [
        _listed("SWE699", SPRING, "001", title="Special Topics in Software Engineering"),  # falls back to text
        _listed("SWE699", FALL, "002", title="Special Topics: Quantum Computing"),  # extracted from listing
    ]
    counts = listings.save_all(store, None, items)
    assert counts == {"saved": 2, "exists": 0, "skipped": 0}
    assert store.removed == []  # older special-topics offering is NOT removed
    assert [s["topic"] for s in store.saved] == ["AI, Technology & Society", "Quantum Computing"]

    # Search document stores `topic` and includes it in `text` for full-text search.
    doc_from_listing = store.texts[store.saved[1]["file_id"]]
    assert doc_from_listing["topic"] == "Quantum Computing"
    assert "Quantum Computing" in doc_from_listing["text"]


# --- 4. Store persistence and search indexing ---


class FakeDynamoTable:
    def __init__(self):
        self.items = []
        self.updates = []

    def put_item(self, Item):
        self.items.append(Item)

    def update_item(self, **kwargs):
        self.updates.append(kwargs)

    def scan(self, **kwargs):
        return {"Items": [i for i in self.items if i.get("SK", "").startswith("TERM#")]}


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}
        self.indexes = []

    def create_index(self, *args, **kwargs):
        self.indexes.append((args, kwargs))

    def find(self, query=None, projection=None):
        return list(self.docs.values())

    def replace_one(self, flt, doc, upsert=False):
        self.docs[flt["_id"]] = {"_id": flt["_id"], **doc}

    def bulk_write(self, ops, ordered=False):
        for op in ops:
            doc_id = op._filter["_id"]
            self.docs[doc_id] = {"_id": doc_id, **op._doc["$set"]}

    def delete_many(self, flt):
        pass

    def update_one(self, flt, update, upsert=False):
        pass


class FakeStream:
    def __init__(self, data, content_type="text/html; charset=utf-8"):
        self._data = data
        self.metadata = {"contentType": content_type}

    def read(self):
        return self._data


class FakePool:
    def __init__(self, files):
        self._files = files

    def open(self, file_id):
        return self._files.get(file_id)


def _make_store(courses=None, pool_files=None):
    store = Store.__new__(Store)
    store.table = FakeDynamoTable()
    store.db = {
        "courses": FakeCollection(courses),
        "departments": FakeCollection(),
        "syllabus_text": FakeCollection(),
    }
    store.pool = FakePool(pool_files or {})
    store._curated = set()
    store._special_topics = None
    return store


def test_store_save_offering_and_index_text_include_topic():
    store = _make_store(
        pool_files={"f1": FakeStream(b"<html><body><h1>CS 399 Syllabus</h1><p>Grading: 100% Project</p></body></html>")},
    )
    row = Row(
        codes=["CS399"],
        section="001",
        title="Special Topics in Computer Science",
        instructors=["Doe, J"],
        href="https://example.edu/cs399.html",
        term=FALL,
        source="gmu-cs",
    )
    store.save_offering("CS", "CS399", row, "f1", "text/html; charset=utf-8", row.href, topic="AI, Technology & Society")
    assert store.table.items[0]["topic"] == "AI, Technology & Society"

    # Offering without topic omits the field.
    store.save_offering("CS", "CS310", row, "f2", "text/html; charset=utf-8", row.href)
    assert "topic" not in store.table.items[1]

    # index_text writes `topic` and prepends it to `text` when missing from the body.
    assert store.index_text() == 1
    indexed = store.db["syllabus_text"].docs["f1"]
    assert indexed["topic"] == "AI, Technology & Society"
    assert "AI, Technology & Society" in indexed["text"]


def test_store_save_department_and_is_special_topics():
    store = _make_store(
        courses=[
            {"_id": "HIST388", "title": "Topics in History", "description": ""},
            {"_id": "BIOL101", "title": "Biology I", "description": "Intro biology."},
        ]
    )
    assert store.is_special_topics("HIST388") is True
    assert store.is_special_topics("BIOL101") is False

    store.save_department(
        "gmu",
        {"code": "SWE", "name": "Software Engineering"},
        [
            {"code": "SWE699", "title": "Special Topics in Software Engineering", "credits": "3", "description": "", "prereqs": ""},
            {"code": "SWE619", "title": "Object-Oriented Software Specification", "credits": "3", "description": "", "prereqs": ""},
        ],
    )
    assert store.db["courses"].docs["SWE699"]["specialTopics"] is True
    assert store.db["courses"].docs["SWE619"]["specialTopics"] is False
    assert store.is_special_topics("SWE699") is True
    assert store.is_special_topics("SWE619") is False
