import scrape
from syllabus_scraper.store import Store


class FakeTable:
    def __init__(self):
        self.updates = []

    def update_item(self, **kwargs):
        self.updates.append(kwargs)


class FakeStore:
    """Stands in for Store in main(): every pass finds nothing to do."""

    def __init__(self):
        self.scraped = 0
        self.pool = type("FakePool", (), {"report": lambda self: []})()

    def index_text(self, reindex=False):
        return 0

    def resolve_names(self):
        return 0

    def make_pdfs(self):
        return 0

    def mark_scraped(self):
        self.scraped += 1

    def count_syllabi(self):
        return 0


def test_mark_scraped_only_sets_the_scrape_time():
    store = Store.__new__(Store)  # skip the database connections
    store.table = FakeTable()
    store.mark_scraped()
    (update,) = store.table.updates
    assert update["Key"] == {"PK": "STATUS", "SK": "UPDATED"}
    assert update["UpdateExpression"] == "SET scrapedAt = :now"
    assert update["ExpressionAttributeValues"][":now"].startswith("20")


def test_a_full_scrape_is_recorded_but_index_only_is_not(monkeypatch):
    fake = FakeStore()
    monkeypatch.setattr(scrape, "Store", lambda: fake)
    monkeypatch.setattr(scrape, "listing_rows", lambda fetcher, args, since: iter([]))
    monkeypatch.setattr(scrape, "load_dotenv", lambda: None)

    assert scrape.main(["--index-only", "--no-catalog"]) == 0
    assert fake.scraped == 0
    assert scrape.main(["--no-catalog", "--no-filenames", "--sources", "cs"]) == 0
    assert fake.scraped == 1


class FakeCollection:
    def __init__(self):
        self.calls = []

    def update_many(self, *args):
        self.calls.append(("many", *args))

    def update_one(self, *args, **kwargs):
        self.calls.append(("one", *args))


def test_count_syllabi_counts_courses_not_files_per_department():
    store = Store.__new__(Store)
    departments = FakeCollection()
    store.db = {"departments": departments}
    store.offerings_by_file = lambda: {
        "f1": [{"code": "CS310"}, {"code": "SWE310"}],
        "f2": [{"code": "CS310"}],
        "f3": [{"code": "CS483"}],
    }
    assert store.count_syllabi() == 2
    assert departments.calls[0] == ("many", {"_id": {"$nin": ["CS", "SWE"]}}, {"$set": {"withSyllabi": 0}})
    counts = {call[1]["_id"]: call[2]["$set"]["withSyllabi"] for call in departments.calls[1:]}
    assert counts == {"CS": 2, "SWE": 1}


class FakeCatalog(FakeCollection):
    def create_index(self, *args, **kwargs):
        pass

    def bulk_write(self, writes, ordered=True):
        self.calls.extend(("write", w._filter, w._doc) for w in writes)

    def delete_many(self, *args):
        self.calls.append(("delete", *args))


def test_other_schools_get_prefixed_keys_and_gmu_stays_bare():
    store = Store.__new__(Store)
    store.db = {"courses": FakeCatalog(), "departments": FakeCatalog()}
    course = {"code": "COMP110", "title": "Intro", "credits": "3", "description": "", "prereqs": ""}

    assert store.save_department("unc", {"code": "COMP", "name": "Computer Science"}, [course]) == 1
    _, filt, doc = store.db["courses"].calls[0]
    assert filt == {"_id": "unc:COMP110"}
    assert doc["$set"]["dept"] == "unc:COMP" and doc["$set"]["school"] == "unc"
    assert store.db["courses"].calls[1] == ("delete", {"dept": "unc:COMP", "_id": {"$nin": ["unc:COMP110"]}})
    assert store.db["departments"].calls[0][1] == {"_id": "unc:COMP"}

    store.db = {"courses": FakeCatalog(), "departments": FakeCatalog()}
    store.save_department("gmu", {"code": "CS", "name": "Computer Science"}, [{**course, "code": "CS310"}])
    _, filt, doc = store.db["courses"].calls[0]
    assert filt == {"_id": "CS310"} and doc["$set"]["dept"] == "CS" and doc["$set"]["school"] == "gmu"


def test_count_syllabi_keeps_schools_apart():
    store = Store.__new__(Store)
    departments = FakeCollection()
    store.db = {"departments": departments}
    store.offerings_by_file = lambda: {"f1": [{"code": "CS310"}], "f2": [{"code": "unc:COMP110"}, {"code": "unc:COMP210"}]}
    assert store.count_syllabi() == 2
    upserts = {call[1]["_id"]: call[2] for call in departments.calls[1:]}
    assert upserts["CS"]["$set"]["withSyllabi"] == 1
    assert upserts["unc:COMP"]["$set"]["withSyllabi"] == 2
    assert upserts["unc:COMP"]["$setOnInsert"] == {"school": "unc", "name": "COMP", "courses": 0}
    assert upserts["CS"]["$setOnInsert"]["school"] == "gmu"
