from bson import ObjectId

from syllabus_scraper import pool as pool_module
from syllabus_scraper.pool import MB, Pool, SupabaseMember, pool_uris


def test_pool_uris_main_first_then_numbered():
    env = {"MONGODB_URI": "main", "MONGODB_URI_10": "ten", "MONGODB_URI_2": "two", "MONGODB_URI_3": " ", "OTHER": "x"}
    assert pool_uris(env) == ["main", "two", "ten"]
    assert pool_uris({}) == ["mongodb://localhost:27017"]


class FakeMember:
    """An Atlas cluster stand-in: files by id, and fixed usage numbers."""

    def __init__(self, name, cluster_mb, db_mb):
        self.name = name
        self.label = f"Storage cluster {name}"
        self.files = {}
        self.sizes = [cluster_mb * MB, db_mb * MB]
        self.measured = 0
        self.cap = 470 * MB

    def cluster_bytes(self):
        self.measured += 1
        return self.sizes[0]

    def db_bytes(self):
        return self.sizes[1]

    def upload(self, data, filename, metadata, file_id=None):
        file_id = str(file_id or ObjectId())
        self.files[file_id] = (filename, data, metadata)
        return file_id

    def find_all(self, query, projection=None):
        return [{"_id": i, "filename": f, "length": len(d), "metadata": m} for i, (f, d, m) in self.files.items()]

    def open(self, file_id):
        entry = self.files.get(str(file_id))
        return pool_module.Stored(entry[1], entry[2]) if entry else None

    def delete(self, file_id):
        return self.files.pop(str(file_id), None) is not None

    def names(self):
        return [f for f, _, _ in self.files.values()]


def test_files_go_to_the_first_cluster_with_room():
    main, second = FakeMember("1", 469, 100), FakeMember("2", 10, 0)
    pool = Pool([main, second], cap=470 * MB)
    assert pool.save(b"x" * 1000, "a.pdf", {}) is not None
    assert main.names() == ["a.pdf"]
    # Main fills up; the next file goes to the second cluster.
    pool.save(b"x" * (MB // 2), "b.pdf", {})
    pool.save(b"x" * (MB // 2), "c.pdf", {})
    assert main.names() == ["a.pdf", "b.pdf"] and second.names() == ["c.pdf"]


def test_budget_keeps_a_site_to_a_sample_and_full_pool_returns_none():
    staging = FakeMember("1", 100, 49.9)
    pool = Pool([staging], cap=470 * MB, budget=50 * MB)
    assert pool.save(b"x" * 1000, "a.pdf", {}) is not None
    assert pool.save(b"x" * MB, "b.pdf", {}) is None
    assert any("budget 50 MB" in line for line in pool.report())


def test_usage_is_measured_again_so_text_written_beside_files_counts(monkeypatch):
    monkeypatch.setattr(pool_module, "REMEASURE_EVERY", 3)
    main = FakeMember("1", 100, 100)
    pool = Pool([main], cap=470 * MB)
    for n in range(7):
        pool.save(b"x", f"{n}.pdf", {})
    assert main.measured == 3  # first save, then after saves 3 and 6


class FakeResponse:
    def __init__(self, status=200, content=b""):
        self.status_code = status
        self.content = content

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class FakeSession:
    """Supabase Storage's REST API: objects by path."""

    def __init__(self):
        self.headers, self.objects, self.buckets = {}, {}, []

    def post(self, url, json=None, data=None, timeout=None, headers=None):
        if url.endswith("/storage/v1/bucket"):
            self.buckets.append(json["id"])
            return FakeResponse(200 if len(self.buckets) == 1 else 409)
        self.objects[url.rsplit("/", 1)[1]] = data
        return FakeResponse()

    def get(self, url, timeout=None):
        data = self.objects.get(url.rsplit("/", 1)[1])
        return FakeResponse(200, data) if data is not None else FakeResponse(404)

    def delete(self, url, timeout=None):
        self.objects.pop(url.rsplit("/", 1)[1], None)
        return FakeResponse()


class FakeIndex:
    """The "stored_files" collection."""

    def __init__(self):
        self.docs = {}

    def _match(self, doc, query):
        for key, value in query.items():
            current = doc
            for part in key.split("."):
                current = (current or {}).get(part)
            if current != value:
                return False
        return True

    def replace_one(self, query, doc, upsert=False):
        self.docs[doc["_id"]] = doc

    def find_one(self, query, projection=None):
        return next((d for d in self.docs.values() if self._match(d, query)), None)

    def find(self, query, projection=None):
        return [d for d in self.docs.values() if self._match(d, query)]

    def delete_one(self, query):
        self.docs.pop(query["_id"], None)

    def aggregate(self, pipeline):
        return [{"bytes": sum(d["length"] for d in self.docs.values())}] if self.docs else []


def supabase(cap_mb=950):
    return SupabaseMember("https://x.supabase.co", "key", FakeIndex(), cap=cap_mb * MB, session=FakeSession())


def test_supabase_storage_first_with_the_same_kind_of_ids():
    store, main = supabase(), FakeMember("1", 400, 200)
    pool = Pool([store, main], budget=None)
    assert pool.main is main
    file_id = pool.save(b"%PDF-1", "a.pdf", {"contentType": "application/pdf", "sourceUrl": "https://u/a.pdf"})
    assert ObjectId.is_valid(file_id) and main.files == {}
    assert store.session.objects[file_id] == b"%PDF-1"
    assert store.session.headers["Authorization"] == "Bearer key"
    assert pool.find({"metadata.sourceUrl": "https://u/a.pdf"})["_id"] == ObjectId(file_id)
    stream = pool.open(file_id)
    assert stream.read() == b"%PDF-1" and stream.metadata["contentType"] == "application/pdf"
    assert store.db_bytes() == 6
    assert pool.delete(file_id) and store.session.objects == {} and store.index.docs == {}
    assert pool.open(file_id) is None


def test_full_supabase_falls_back_to_atlas():
    store, main = supabase(cap_mb=1), FakeMember("1", 100, 50)
    pool = Pool([store, main])
    pool.save(b"x" * (MB // 2), "a.pdf", {})
    pool.save(b"x" * MB, "b.pdf", {})
    assert len(store.index.docs) == 1 and main.names() == ["b.pdf"]
    assert pool.report()[0].startswith("Supabase Storage: 0.5 MB used of 1 MB")


def test_move_files_from_atlas_to_supabase_keeps_ids():
    store, main = supabase(), FakeMember("1", 480, 300)
    ids = [main.upload(b"x" * 1000, f"{n}.pdf", {"sourceUrl": f"u{n}"}) for n in range(3)]
    pool = Pool([store, main])
    assert pool.move_to_supabase() == (3, 3000)
    assert main.files == {}
    assert sorted(str(i) for i in store.index.docs) == sorted(ids)
    assert pool.open(ids[0]).read() == b"x" * 1000

    # A limit stops it early.
    main2 = FakeMember("1", 480, 300)
    for n in range(3):
        main2.upload(b"x" * MB, f"{n}.pdf", {})
    assert Pool([supabase(), main2]).move_to_supabase(limit_mb=1.5)[0] == 2
    # Nothing to move to without Supabase.
    assert Pool([FakeMember("1", 1, 1)]).move_to_supabase() == (0, 0)
