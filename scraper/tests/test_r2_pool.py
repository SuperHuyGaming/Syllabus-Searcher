import io
from datetime import datetime, timezone

import pytest
from bson import ObjectId

from syllabus_scraper import pool as pool_module
from syllabus_scraper.pool import (
    MB,
    R2_MAX_BYTES,
    R2_MAX_CLASS_A,
    R2_MAX_CLASS_B,
    Pool,
    R2CapExceeded,
    R2Member,
    SupabaseMember,
)
from tests.test_pool import FakeMember, FakeSession


class FakeS3Client:
    """In-memory S3 client stand-in for Cloudflare R2. Forbids list calls."""

    def __init__(self):
        self.objects = {}
        self.put_calls = []
        self.get_calls = []
        self.delete_calls = []

    def put_object(self, Bucket, Key, Body, ContentType=None):
        self.objects[(Bucket, Key)] = (Body, ContentType)
        self.put_calls.append((Bucket, Key, len(Body), ContentType))

    def get_object(self, Bucket, Key):
        self.get_calls.append((Bucket, Key))
        if (Bucket, Key) not in self.objects:
            raise KeyError(Key)
        data, _ = self.objects[(Bucket, Key)]
        return {"Body": io.BytesIO(data)}

    def delete_object(self, Bucket, Key):
        self.delete_calls.append((Bucket, Key))
        self.objects.pop((Bucket, Key), None)

    def list_objects(self, *args, **kwargs):
        raise AssertionError("R2 must never use list_objects to measure size")

    def list_objects_v2(self, *args, **kwargs):
        raise AssertionError("R2 must never use list_objects_v2 to measure size")


class FakeCollection:
    """In-memory MongoDB collection supporting stored_files and r2_usage operations."""

    def __init__(self):
        self.docs = {}
        self.aggregate_calls = 0

    @staticmethod
    def _match(doc, query):
        for key, value in query.items():
            current = doc
            for part in key.split("."):
                current = (current or {}).get(part)
            if isinstance(value, dict):
                if "$exists" in value and (key in doc) is not value["$exists"]:
                    return False
                if "$ne" in value and current == value["$ne"]:
                    return False
            elif current != value:
                return False
        return True

    def replace_one(self, query, doc, upsert=False):
        self.docs[doc["_id"]] = dict(doc)

    def update_one(self, query, update, upsert=False):
        doc_id = query["_id"]
        is_new = doc_id not in self.docs
        if is_new:
            if not upsert:
                return
            self.docs[doc_id] = {"_id": doc_id}
        doc = self.docs[doc_id]
        if is_new and "$setOnInsert" in update:
            for k, v in update["$setOnInsert"].items():
                doc.setdefault(k, v)
        if "$inc" in update:
            for k, v in update["$inc"].items():
                doc[k] = doc.get(k, 0) + v
        if "$set" in update:
            for k, v in update["$set"].items():
                doc[k] = v

    def find_one(self, query, projection=None):
        return next((d for d in self.docs.values() if self._match(d, query)), None)

    def find(self, query, projection=None):
        return [d for d in self.docs.values() if self._match(d, query)]

    def delete_one(self, query):
        self.docs.pop(query["_id"], None)

    def aggregate(self, pipeline):
        self.aggregate_calls += 1
        docs = list(self.docs.values())
        for stage in pipeline:
            if "$match" in stage:
                docs = [d for d in docs if self._match(d, stage["$match"])]
        return [{"_id": None, "bytes": sum(d["length"] for d in docs)}] if docs else []


def make_r2(index=None, usage=None, client=None, cap=R2_MAX_BYTES, now=None):
    return R2Member(
        endpoint="https://acct.r2.cloudflarestorage.com",
        access_key="ak",
        secret_key="sk",
        bucket="syllabi-r2",
        public_url="https://files.bentruong.dev/",
        index=index if index is not None else FakeCollection(),
        usage=usage if usage is not None else FakeCollection(),
        cap=cap,
        client=client if client is not None else FakeS3Client(),
        now=now or (lambda: datetime(2026, 11, 28, 12, 0, tzinfo=timezone.utc)),
    )


def test_r2_hard_cap_constants_and_clamping():
    assert R2_MAX_BYTES == 9_950_000_000
    assert R2_MAX_CLASS_A == 950_000
    assert R2_MAX_CLASS_B == 9_500_000

    # Passing a cap higher than R2_MAX_BYTES is clamped to R2_MAX_BYTES.
    r2 = make_r2(cap=R2_MAX_BYTES + 100_000_000)
    assert r2.cap == R2_MAX_BYTES

    pool = Pool([r2, FakeMember("1", 10, 10)], cap=R2_MAX_BYTES + 100_000_000)
    assert r2.cap == R2_MAX_BYTES


def test_from_env_requires_all_five_r2_vars_and_orders_r2_then_supabase_then_atlas(monkeypatch):
    created_s3 = []

    class FakeDb:
        def __init__(self):
            self.cols = {}

        def __getitem__(self, name):
            return self.cols.setdefault(name, FakeCollection())

    class FakeMongoClient:
        def __init__(self, uri):
            self.uri = uri
            self.db = FakeDb()

        def __getitem__(self, name):
            return self.db

    monkeypatch.setattr(pool_module, "MongoClient", FakeMongoClient)
    monkeypatch.setattr(pool_module.gridfs, "GridFSBucket", lambda db, bucket_name: object())

    def fake_boto3_client(service, **kwargs):
        created_s3.append((service, kwargs))
        return FakeS3Client()

    monkeypatch.setattr(pool_module.boto3, "client", fake_boto3_client)

    base_r2 = {
        "MONGODB_URI": "mongodb://main",
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "sb-key",
        "R2_ENDPOINT": "https://acct.r2.cloudflarestorage.com",
        "R2_ACCESS_KEY_ID": "key-id",
        "R2_SECRET_ACCESS_KEY": "secret",
        "R2_BUCKET": "syllabi",
        "R2_PUBLIC_URL": "https://files.bentruong.dev",
    }

    # Missing any single R2 env var disables R2.
    for required in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"):
        env = dict(base_r2)
        env[required] = "   "
        pool = Pool.from_env(env)
        assert [m.name for m in pool.members] == ["supabase", "1"]
    assert created_s3 == []

    # All 5 set -> R2 first, then Supabase, then Atlas.
    pool = Pool.from_env(base_r2)
    assert [m.name for m in pool.members] == ["r2", "supabase", "1"]
    assert isinstance(pool.members[0], R2Member)
    assert isinstance(pool.members[1], SupabaseMember)
    assert pool.main is pool.members[2]
    assert created_s3 == [
        (
            "s3",
            {
                "endpoint_url": "https://acct.r2.cloudflarestorage.com",
                "aws_access_key_id": "key-id",
                "aws_secret_access_key": "secret",
                "region_name": "auto",
            },
        )
    ]


def test_r2_upload_key_record_usage_open_and_delete():
    index, usage, s3 = FakeCollection(), FakeCollection(), FakeS3Client()
    r2 = make_r2(index=index, usage=usage, client=s3)
    sb = SupabaseMember("https://x.supabase.co", "key", index, cap=950 * MB, session=FakeSession())
    main = FakeMember("1", 100, 50)
    pool = Pool([r2, sb, main])

    data = b"%PDF-1.7 syllabus bytes"
    file_id = pool.save(data, "CS 310 (Fall 2026).PDF", {"contentType": "application/pdf", "sourceUrl": "https://u/a.pdf"})
    assert ObjectId.is_valid(file_id)
    assert sb.session.objects == {} and main.files == {}

    expected_key = f"{file_id}.pdf"
    assert " " not in expected_key
    assert s3.objects[("syllabi-r2", expected_key)] == (data, "application/pdf")

    doc = index.docs[ObjectId(file_id)]
    assert doc["storage"] == "r2"
    assert doc["link"] == f"https://files.bentruong.dev/{expected_key}"
    assert doc["length"] == len(data)
    assert doc["filename"] == "CS 310 (Fall 2026).PDF"
    assert doc["metadata"] == {"contentType": "application/pdf", "sourceUrl": "https://u/a.pdf"}

    # Usage counters incremented for YYYY-MM.
    assert usage.docs["2026-11"] == {"_id": "2026-11", "classA": 1, "classB": 0}
    assert r2.db_bytes() == len(data)
    # Supabase usage excludes R2 records because they have 'link'.
    assert sb.db_bytes() == 0

    # find_all does not duplicate records shared by R2 and Supabase.
    all_docs = pool.find_all({})
    assert len(all_docs) == 1 and all_docs[0]["_id"] == ObjectId(file_id)

    # Opening reads via R2 and increments classB.
    stream = pool.open(file_id)
    assert stream.read() == data
    assert stream.metadata["contentType"] == "application/pdf"
    assert usage.docs["2026-11"] == {"_id": "2026-11", "classA": 1, "classB": 1}

    # Deleting removes from R2 and stored_files without touching Supabase.
    assert pool.delete(file_id) is True
    assert s3.objects == {}
    assert index.docs == {}
    assert pool.open(file_id) is None


def test_r2_extension_fallback_from_content_type():
    r2 = make_r2()
    fid = r2.upload(b"<html>hi</html>", "syllabus", {"contentType": "text/html; charset=utf-8"})
    assert r2.index.docs[ObjectId(fid)]["link"] == f"https://files.bentruong.dev/{fid}.html"


def test_r2_hard_storage_cap_exact_boundary_and_fallthrough():
    index, usage, s3 = FakeCollection(), FakeCollection(), FakeS3Client()
    # Pre-populate stored_files so R2 is 10 bytes below the 9.95 GB hard cap.
    index.replace_one(
        {"_id": ObjectId()},
        {
            "_id": ObjectId(),
            "filename": "existing.pdf",
            "length": R2_MAX_BYTES - 10,
            "metadata": {},
            "link": "https://files.bentruong.dev/existing.pdf",
            "storage": "r2",
        },
        upsert=True,
    )
    r2 = make_r2(index=index, usage=usage, client=s3)
    sb = SupabaseMember("https://x.supabase.co", "key", index, cap=950 * MB, session=FakeSession())
    main = FakeMember("1", 100, 50)
    pool = Pool([r2, sb, main])

    # 11 bytes would exceed R2_MAX_BYTES by 1 byte -> refused by R2, falls through to Supabase.
    sb_id = pool.save(b"x" * 11, "over.pdf", {"contentType": "application/pdf"})
    assert sb_id in sb.session.objects
    assert s3.put_calls == []

    # 10 bytes hits R2_MAX_BYTES exactly -> allowed on R2.
    r2_id = pool.save(b"y" * 10, "exact.pdf", {"contentType": "application/pdf"})
    assert len(s3.put_calls) == 1
    assert index.docs[ObjectId(r2_id)]["storage"] == "r2"

    # Now at exact cap, even 1 byte falls through to Supabase.
    sb_id2 = pool.save(b"z", "next.pdf", {"contentType": "application/pdf"})
    assert sb_id2 in sb.session.objects
    assert len(s3.put_calls) == 1

    # Direct upload() also enforces the hard cap.
    with pytest.raises(R2CapExceeded):
        r2.upload(b"a", "direct.pdf", {})


def test_r2_measures_live_before_every_write():
    index, usage, s3 = FakeCollection(), FakeCollection(), FakeS3Client()
    r2 = make_r2(index=index, usage=usage, client=s3, cap=100)
    main = FakeMember("1", 10, 10)
    pool = Pool([r2, main])

    assert pool.save(b"a" * 40, "1.pdf", {}) is not None
    # Simulate another process inserting 55 bytes into stored_files between saves.
    index.replace_one(
        {"_id": ObjectId()},
        {"_id": ObjectId(), "filename": "other.pdf", "length": 55, "storage": "r2", "link": "https://files.bentruong.dev/other.pdf"},
        upsert=True,
    )
    # Next 10-byte write must measure live (40 + 55 + 10 = 105 > 100) and fall through to Atlas.
    agg_before = index.aggregate_calls
    pool.save(b"b" * 10, "2.pdf", {})
    assert index.aggregate_calls > agg_before
    assert main.names() == ["2.pdf"]


def test_r2_monthly_class_a_and_class_b_caps():
    index, usage, s3 = FakeCollection(), FakeCollection(), FakeS3Client()
    usage.docs["2026-11"] = {"_id": "2026-11", "classA": R2_MAX_CLASS_A - 1, "classB": R2_MAX_CLASS_B - 1}
    r2 = make_r2(index=index, usage=usage, client=s3)
    main = FakeMember("1", 10, 10)
    pool = Pool([r2, main])

    # One Class A write left -> succeeds on R2.
    r2_id = pool.save(b"ok", "a.pdf", {"contentType": "application/pdf"})
    assert usage.docs["2026-11"]["classA"] == R2_MAX_CLASS_A
    assert len(s3.put_calls) == 1

    # Next write would be R2_MAX_CLASS_A + 1 -> refused on R2, falls through to Atlas.
    pool.save(b"next", "b.pdf", {"contentType": "application/pdf"})
    assert len(s3.put_calls) == 1
    assert main.names() == ["b.pdf"]

    # Direct upload also refuses when Class A cap is reached.
    with pytest.raises(R2CapExceeded):
        r2.upload(b"nope", "c.pdf", {})

    # One Class B read left -> succeeds, next read is refused.
    assert pool.open(r2_id).read() == b"ok"
    assert usage.docs["2026-11"]["classB"] == R2_MAX_CLASS_B
    assert pool.open(r2_id) is None


def test_link_only_and_supabase_coexist_with_r2_on_delete():
    index, usage, s3 = FakeCollection(), FakeCollection(), FakeS3Client()
    r2 = make_r2(index=index, usage=usage, client=s3, cap=0)
    sb = SupabaseMember("https://x.supabase.co", "key", index, cap=950 * MB, session=FakeSession())
    main = FakeMember("1", 100, 50)
    pool = Pool([r2, sb, main])

    # R2 has cap=0 so save goes to Supabase.
    sb_id = pool.save(b"sb-data", "sb.pdf", {"contentType": "application/pdf"})
    assert sb_id in sb.session.objects

    # Link-only goes to stored_files with no bytes on R2 or Supabase.
    link_url = "https://d101vc9winf8ln.cloudfront.net/syllabuses/1/original/a.pdf"
    link_id = pool.link(link_url, "a.pdf", {"contentType": "application/pdf"}, length=50000)
    assert r2.db_bytes() == 0
    assert sb.db_bytes() == len(b"sb-data")
    assert s3.put_calls == []

    # Deleting link-only does not call R2 or Supabase delete.
    assert pool.delete(link_id) is True
    assert s3.delete_calls == []
    assert sb_id in sb.session.objects

    # Deleting Supabase file deletes Supabase blob, not R2.
    assert pool.delete(sb_id) is True
    assert sb.session.objects == {}
    assert s3.delete_calls == []


def test_move_to_r2_keeps_ids_and_respects_cap_and_limit():
    index, usage, s3 = FakeCollection(), FakeCollection(), FakeS3Client()
    r2 = make_r2(index=index, usage=usage, client=s3, cap=2500)
    main = FakeMember("1", 480, 300)
    ids = [main.upload(b"x" * 1000, f"{n}.pdf", {"sourceUrl": f"u{n}", "contentType": "application/pdf"}) for n in range(3)]
    pool = Pool([r2, main])

    # Only 2 files fit in 2500 bytes; 3rd stays in Atlas.
    moved, size = pool.move_to_r2()
    assert (moved, size) == (2, 2000)
    assert len(main.files) == 1
    assert len(s3.objects) == 2
    assert all(str(doc_id) in ids for doc_id in index.docs)

    # move_to_supabase ignores R2 files and moves only remaining Atlas file.
    sb = SupabaseMember("https://x.supabase.co", "key", index, cap=950 * MB, session=FakeSession())
    pool2 = Pool([r2, sb, main])
    assert pool2.move_to_supabase() == (1, 1000)
    assert main.files == {}
    assert len(s3.objects) == 2
