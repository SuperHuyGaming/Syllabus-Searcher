"""Where syllabus files are kept: Cloudflare R2 first (9.95 GB hard cap), then the site's
Supabase Storage project (1 GB free), then GridFS bucket "syllabi" on one or more free MongoDB
Atlas clusters.

A free M0 cluster holds 512 MB, and both sites (production and staging databases) share the main
one, which also holds the search text, catalogs and student uploads. So new file copies go to
Cloudflare R2 when configured and under its hard cap, then Supabase Storage (bucket "syllabi",
each site has its own project) while it has room, then to the Atlas clusters. Every file id is a
plain ObjectId: GridFS uses it as the file's _id, R2 uses "<id>.<ext>" with storage="r2" and a
public link, Supabase uses the id as the object's name, and both R2 and Supabase keep a record in
the main database (collection "stored_files": filename, length, metadata) so files can be looked
up by source URL and counted. The API looks for a file in each Atlas cluster, then in
stored_files (api/src/repos/files.js).

    R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
                                     Cloudflare R2 bucket (all 5 required to enable R2)
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  the site's Supabase project (unset: no Supabase storage)
    SUPABASE_STORAGE_CAP_MB          stop filling Supabase Storage at this size (default 950 of the 1 GB)
    MONGODB_URI, MONGODB_URI_2, ...  clusters, main first (same database name on each: MONGODB_DB)
    STORAGE_CAP_MB                   stop filling a cluster at this size (default 470 of the 512 MB)
    STORAGE_BUDGET_MB                most this site may use in each place (unset: no limit);
                                     staging sets it so it keeps only a sample and production gets the space
"""

import io
import logging
import os
import re
from datetime import datetime, timezone

import boto3
import gridfs
import requests
from bson import ObjectId
from pymongo import MongoClient

log = logging.getLogger("scraper")

MB = 1024 * 1024
DEFAULT_CAP_MB = 470
DEFAULT_SUPABASE_CAP_MB = 950
BUCKET = "syllabi"
# Usage is measured again after this many saves, so search text and summaries written
# alongside the files (on the main cluster) are counted too.
REMEASURE_EVERY = 20

# Hard free-tier caps for Cloudflare R2 (see AGENTS.md: 10 GB storage, 1M Class A, 10M Class B/month).
# Never raise these or allow env vars to exceed them.
R2_MAX_BYTES = 9_950_000_000
R2_MAX_CLASS_A = 950_000
R2_MAX_CLASS_B = 9_500_000


class R2CapExceeded(RuntimeError):
    """Raised when a direct R2 write would exceed the hard storage or monthly Class A cap."""


def _r2_extension(filename, metadata):
    """Plain lowercase alphanumeric extension for R2 object keys ('<ObjectId>.<ext>')."""
    if filename and "." in filename:
        raw = filename.rsplit(".", 1)[1].lower()
        clean = re.sub(r"[^a-z0-9]", "", raw)
        if 1 <= len(clean) <= 10:
            return clean
    content_type = ((metadata or {}).get("contentType") or "").lower()
    if "pdf" in content_type:
        return "pdf"
    if "html" in content_type:
        return "html"
    if "text/plain" in content_type:
        return "txt"
    return "bin"


def pool_uris(env=os.environ):
    """The main cluster's URI, then MONGODB_URI_2, MONGODB_URI_3, ... in number order. Empty ones are skipped."""
    extra = sorted(
        (int(m.group(1)), value)
        for name, value in env.items()
        if (m := re.fullmatch(r"MONGODB_URI_(\d+)", name)) and value.strip()
    )
    return [env.get("MONGODB_URI", "mongodb://localhost:27017")] + [value.strip() for _, value in extra]


def _mb(value):
    try:
        return float(value) * MB if value not in (None, "") else None
    except ValueError:
        return None


class Stored(io.BytesIO):
    """A downloaded file with its metadata, read like a GridFS stream."""

    def __init__(self, data, metadata):
        super().__init__(data)
        self.metadata = metadata or {}


class Member:
    """One Atlas cluster: this site's database and its "syllabi" bucket."""

    def __init__(self, name, db, cap=DEFAULT_CAP_MB * MB):
        self.name = name
        self.label = f"Storage cluster {name}"
        self.db = db
        self.cap = cap
        self.bucket = gridfs.GridFSBucket(db, bucket_name=BUCKET)

    def db_bytes(self):
        stats = self.db.command("dbStats")
        return stats.get("dataSize", 0) + stats.get("indexSize", 0)

    def cluster_bytes(self):
        """Everything on the cluster (both sites count against one 512 MB). Falls back to
        this database alone if listing databases isn't allowed."""
        try:
            client = self.db.client
            total = 0
            for name in client.list_database_names():
                if name in ("admin", "local", "config"):
                    continue
                stats = client[name].command("dbStats")
                total += stats.get("dataSize", 0) + stats.get("indexSize", 0)
            return total
        except Exception as err:  # noqa: BLE001 - a usage check must not stop the scrape
            log.warning("Couldn't list databases on cluster %s (%s); counting this site only", self.name, err)
            return self.db_bytes()

    def upload(self, data, filename, metadata, file_id=None):
        file_id = file_id or ObjectId()
        self.bucket.upload_from_stream_with_id(file_id, filename, data, metadata=metadata)
        return str(file_id)

    def find(self, query, projection=None):
        return self.db[f"{BUCKET}.files"].find_one(query, projection)

    def find_all(self, query, projection=None):
        return list(self.db[f"{BUCKET}.files"].find(query, projection))

    def open(self, file_id):
        try:
            return self.bucket.open_download_stream(ObjectId(file_id))
        except gridfs.errors.NoFile:
            return None

    def delete(self, file_id):
        try:
            self.bucket.delete(ObjectId(file_id))
            return True
        except gridfs.errors.NoFile:
            return False


class SupabaseMember:
    """The site's Supabase Storage bucket "syllabi". Objects are named by file id; their records
    (filename, length, metadata) are in the main database's "stored_files" collection."""

    name = "supabase"
    label = "Supabase Storage"

    def __init__(self, url, key, index, cap=DEFAULT_SUPABASE_CAP_MB * MB, session=None):
        self.base = f"{url.rstrip('/')}/storage/v1"
        self.index = index
        self.cap = cap
        self.session = session or requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {key}", "apikey": key})
        self._bucket_ready = False

    def _object(self, file_id):
        return f"{self.base}/object/{BUCKET}/{file_id}"

    def _ensure_bucket(self):
        if self._bucket_ready:
            return
        res = self.session.post(f"{self.base}/bucket", json={"id": BUCKET, "name": BUCKET, "public": False}, timeout=30)
        # 200: created. 400/409: it already exists.
        if res.status_code not in (200, 400, 409):
            res.raise_for_status()
        self._bucket_ready = True

    def db_bytes(self):
        total = list(self.index.aggregate([
            {"$match": {"link": {"$exists": False}}},
            {"$group": {"_id": None, "bytes": {"$sum": "$length"}}},
        ]))
        return total[0]["bytes"] if total else 0

    cluster_bytes = db_bytes  # each site has its own Supabase project

    def upload(self, data, filename, metadata, file_id=None):
        self._ensure_bucket()
        file_id = file_id or ObjectId()
        res = self.session.post(self._object(file_id), data=data, timeout=120, headers={
            "Content-Type": metadata.get("contentType") or "application/octet-stream", "x-upsert": "true"})
        res.raise_for_status()
        self.index.replace_one({"_id": ObjectId(file_id)}, {"_id": ObjectId(file_id), "filename": filename,
                                                            "length": len(data), "metadata": metadata}, upsert=True)
        return str(file_id)

    def find(self, query, projection=None):
        return self.index.find_one(query, projection)

    def find_all(self, query, projection=None):
        return list(self.index.find(query, projection))

    def open(self, file_id):
        doc = self.index.find_one({"_id": ObjectId(file_id)})
        if not doc or doc.get("link"):
            return None
        res = self.session.get(self._object(file_id), timeout=120)
        if res.status_code != 200:
            log.warning("Supabase Storage has no object %s (%s)", file_id, res.status_code)
            return None
        return Stored(res.content, doc.get("metadata"))

    def delete(self, file_id):
        doc = self.index.find_one({"_id": ObjectId(file_id)}, {"_id": 1, "link": 1})
        if not doc:
            return False
        if not doc.get("link"):
            self.session.delete(self._object(file_id), timeout=30)
        self.index.delete_one({"_id": ObjectId(file_id)})
        return True


class R2Member:
    """Cloudflare R2 bucket (S3-compatible) with a hard 9.95 GB storage cap and monthly Class A/B
    operation counters stored in MongoDB ('r2_usage'). Records live in the main database's
    'stored_files' collection with storage='r2' and a public link."""

    name = "r2"
    label = "Cloudflare R2"

    def __init__(
        self,
        endpoint,
        access_key,
        secret_key,
        bucket,
        public_url,
        index,
        usage,
        cap=R2_MAX_BYTES,
        client=None,
        now=None,
    ):
        self.endpoint = endpoint.rstrip("/")
        self.bucket = bucket
        self.public_url = public_url.rstrip("/")
        self.index = index
        self.usage = usage
        self.cap = min(cap, R2_MAX_BYTES)
        self._now = now or (lambda: datetime.now(timezone.utc))
        self.client = client or boto3.client(
            "s3",
            endpoint_url=self.endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
        )

    def _month(self):
        return self._now().strftime("%Y-%m")

    def month_usage(self):
        doc = self.usage.find_one({"_id": self._month()}) or {}
        return int(doc.get("classA", 0)), int(doc.get("classB", 0))

    def db_bytes(self):
        total = list(self.index.aggregate([
            {"$match": {"storage": "r2"}},
            {"$group": {"_id": None, "bytes": {"$sum": "$length"}}},
        ]))
        return total[0]["bytes"] if total else 0

    cluster_bytes = db_bytes

    def has_room_for(self, size):
        used = self.db_bytes()
        if used + size > min(self.cap, R2_MAX_BYTES):
            return False
        class_a, _ = self.month_usage()
        return class_a + 1 <= R2_MAX_CLASS_A

    @staticmethod
    def _object_key(doc):
        if doc.get("key"):
            return doc["key"]
        link = doc.get("link") or ""
        return link.rsplit("/", 1)[-1] if "/" in link else None

    def upload(self, data, filename, metadata, file_id=None):
        used = self.db_bytes()
        limit = min(self.cap, R2_MAX_BYTES)
        if used + len(data) > limit:
            raise R2CapExceeded(f"R2 storage cap exceeded ({used + len(data)} > {limit})")
        class_a, _ = self.month_usage()
        if class_a + 1 > R2_MAX_CLASS_A:
            raise R2CapExceeded(f"R2 monthly Class A cap exceeded ({class_a + 1} > {R2_MAX_CLASS_A})")
        file_id = ObjectId(file_id) if file_id else ObjectId()
        key = f"{file_id}.{_r2_extension(filename, metadata)}"
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=(metadata or {}).get("contentType") or "application/octet-stream",
        )
        self.usage.update_one(
            {"_id": self._month()},
            {"$inc": {"classA": 1}, "$setOnInsert": {"classB": 0}},
            upsert=True,
        )
        self.index.replace_one(
            {"_id": file_id},
            {
                "_id": file_id,
                "filename": filename,
                "length": len(data),
                "metadata": metadata,
                "link": f"{self.public_url}/{key}",
                "storage": "r2",
                "key": key,
                "uploadDate": self._now(),
            },
            upsert=True,
        )
        return str(file_id)

    def find(self, query, projection=None):
        return self.index.find_one({**query, "storage": "r2"}, projection)

    def find_all(self, query, projection=None):
        return list(self.index.find({**query, "storage": "r2"}, projection))

    def open(self, file_id):
        doc = self.index.find_one({"_id": ObjectId(file_id)})
        if not doc or doc.get("storage") != "r2":
            return None
        key = self._object_key(doc)
        if not key:
            return None
        _, class_b = self.month_usage()
        if class_b + 1 > R2_MAX_CLASS_B:
            log.warning("Cloudflare R2 monthly Class B cap reached; refusing read of %s", file_id)
            return None
        try:
            res = self.client.get_object(Bucket=self.bucket, Key=key)
            data = res["Body"].read()
        except Exception as err:  # noqa: BLE001 - a missing/unreachable R2 object should not crash callers
            log.warning("Cloudflare R2 could not read object %s (%s)", key, err)
            return None
        self.usage.update_one(
            {"_id": self._month()},
            {"$inc": {"classB": 1}, "$setOnInsert": {"classA": 0}},
            upsert=True,
        )
        return Stored(data, doc.get("metadata"))

    def delete(self, file_id):
        doc = self.index.find_one({"_id": ObjectId(file_id)}, {"_id": 1, "storage": 1, "key": 1, "link": 1})
        if not doc or doc.get("storage") != "r2":
            return False
        key = self._object_key(doc)
        if key:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        self.index.delete_one({"_id": ObjectId(file_id)})
        return True


class Pool:
    def __init__(self, members, cap=None, budget=None, stored_files=None):
        self.members = members
        # The main Atlas cluster: search text, catalogs and uploads live there.
        self.main = next(m for m in members if not isinstance(m, (R2Member, SupabaseMember)))
        self._r2 = next((m for m in members if isinstance(m, R2Member)), None)
        self._supabase = next((m for m in members if isinstance(m, SupabaseMember)), None)
        if stored_files is not None:
            self.stored_files = stored_files
        elif self._r2 is not None:
            self.stored_files = self._r2.index
        elif self._supabase is not None:
            self.stored_files = self._supabase.index
        elif hasattr(self.main, "db") and self.main.db is not None:
            self.stored_files = self.main.db["stored_files"]
        else:
            self.stored_files = None
        if cap is not None:  # one cap for every member (tests)
            for member in members:
                member.cap = min(cap, R2_MAX_BYTES) if isinstance(member, R2Member) else cap
        self.budget = budget
        self._usage = {}  # member name -> [total bytes, this site's bytes], kept up to date as files are added
        self._saves = 0

    @classmethod
    def from_env(cls, env=os.environ):
        db_name = env.get("MONGODB_DB", "syllabus_searcher")
        cap = _mb(env.get("STORAGE_CAP_MB")) or DEFAULT_CAP_MB * MB
        clusters = [Member(str(i + 1), MongoClient(uri)[db_name], cap) for i, uri in enumerate(pool_uris(env))]
        members = list(clusters)
        stored_files = clusters[0].db["stored_files"]
        url, key = env.get("SUPABASE_URL", "").strip(), env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if url and key:
            supabase_cap = _mb(env.get("SUPABASE_STORAGE_CAP_MB")) or DEFAULT_SUPABASE_CAP_MB * MB
            members.insert(0, SupabaseMember(url, key, stored_files, supabase_cap))
        r2_vars = (
            env.get("R2_ENDPOINT", "").strip(),
            env.get("R2_ACCESS_KEY_ID", "").strip(),
            env.get("R2_SECRET_ACCESS_KEY", "").strip(),
            env.get("R2_BUCKET", "").strip(),
            env.get("R2_PUBLIC_URL", "").strip(),
        )
        if all(r2_vars):
            members.insert(0, R2Member(*r2_vars, stored_files, clusters[0].db["r2_usage"]))
        return cls(members, budget=_mb(env.get("STORAGE_BUDGET_MB")))

    @property
    def clusters(self):
        return [m for m in self.members if not isinstance(m, (R2Member, SupabaseMember))]

    def usage(self, member):
        if member.name not in self._usage:
            self._usage[member.name] = [member.cluster_bytes(), member.db_bytes()]
        return self._usage[member.name]

    def has_room(self, member, size):
        if isinstance(member, R2Member):
            # Always measure live from stored_files aggregation before every R2 write (AGENTS.md 9.95 GB hard cap).
            used = member.db_bytes()
            self._usage[member.name] = [used, used]
            if used + size > min(member.cap, R2_MAX_BYTES):
                return False
            if self.budget is not None and used + size > self.budget:
                return False
            class_a, _ = member.month_usage()
            return class_a + 1 <= R2_MAX_CLASS_A
        total, mine = self.usage(member)
        if total + size > member.cap:
            return False
        return self.budget is None or mine + size <= self.budget

    def save(self, data, filename, metadata, members=None):
        """Saves a file in the first place with room. Returns its id, or None when everything is full."""
        self._saves += 1
        if self._saves % REMEASURE_EVERY == 0:
            self._usage.clear()
        for member in members or self.members:
            if self.has_room(member, len(data)):
                file_id = member.upload(data, filename, metadata)
                usage = self._usage[member.name]
                usage[0] += len(data)
                usage[1] += len(data)
                return file_id
        return None

    def link(self, source_url, filename, metadata, length=0, file_id=None):
        """Records a link-only file in the main database's stored_files collection without saving
        any bytes. Never counts toward storage caps or budgets and never returns None."""
        if self.stored_files is None:
            raise RuntimeError("Pool has no stored_files collection for link-only records")
        file_id = ObjectId(file_id) if file_id else ObjectId()
        self.stored_files.replace_one(
            {"_id": file_id},
            {
                "_id": file_id,
                "filename": filename,
                "length": length,
                "metadata": metadata,
                "link": source_url,
                "uploadDate": datetime.now(timezone.utc),
            },
            upsert=True,
        )
        return str(file_id)

    def find(self, query, projection=None):
        """The first stored file record matching a query (GridFS files shape), from anywhere."""
        for member in self.members:
            doc = member.find(query, projection)
            if doc:
                return doc
        if self._supabase is None and self.stored_files is not None:
            return self.stored_files.find_one(query, projection)
        return None

    def find_all(self, query, projection=None):
        docs = []
        seen = set()
        for member in self.members:
            for doc in member.find_all(query, projection):
                doc_id = doc.get("_id")
                if doc_id is not None:
                    if doc_id in seen:
                        continue
                    seen.add(doc_id)
                docs.append(doc)
        if self._supabase is None and self.stored_files is not None:
            for doc in self.stored_files.find(query, projection):
                doc_id = doc.get("_id")
                if doc_id is not None:
                    if doc_id in seen:
                        continue
                    seen.add(doc_id)
                docs.append(doc)
        return docs

    def open(self, file_id):
        """A readable file (.read(), .metadata) from wherever it is, or None."""
        for member in self.members:
            stream = member.open(file_id)
            if stream is not None:
                return stream
        return None

    def delete(self, file_id):
        if any(member.delete(file_id) for member in self.members):
            return True
        if self._supabase is None and self.stored_files is not None:
            if self.stored_files.find_one({"_id": ObjectId(file_id)}, {"_id": 1}):
                self.stored_files.delete_one({"_id": ObjectId(file_id)})
                return True
        return False

    def move_to_r2(self, limit_mb=None):
        """Moves files from the Atlas clusters to Cloudflare R2, keeping their ids, to free the
        main cluster for search text and uploads. Stops at limit_mb moved or when R2 is full
        (9.95 GB hard cap or monthly Class A cap). Returns (files moved, bytes moved)."""
        target = next((m for m in self.members if isinstance(m, R2Member)), None)
        if target is None:
            log.warning("No Cloudflare R2 configured; nothing moved")
            return 0, 0
        moved, size = 0, 0
        for cluster in self.clusters:
            for doc in cluster.find_all({}, {"_id": 1, "filename": 1, "length": 1, "metadata": 1}):
                if limit_mb is not None and size >= limit_mb * MB:
                    return moved, size
                if not self.has_room(target, doc.get("length", 0)):
                    log.warning("Cloudflare R2 is full; stopped moving files")
                    return moved, size
                stream = cluster.open(doc["_id"])
                if stream is None:
                    continue
                data = stream.read()
                if not self.has_room(target, len(data)):
                    log.warning("Cloudflare R2 is full; stopped moving files")
                    return moved, size
                target.upload(data, doc.get("filename", str(doc["_id"])), doc.get("metadata") or {}, file_id=doc["_id"])
                cluster.delete(doc["_id"])
                self._usage[target.name][0] += len(data)
                self._usage[target.name][1] += len(data)
                moved, size = moved + 1, size + len(data)
                if moved % 50 == 0:
                    log.info("Moved %d files (%.1f MB) to Cloudflare R2", moved, size / MB)
        return moved, size

    def move_to_supabase(self, limit_mb=None):
        """Moves files from the Atlas clusters to Supabase Storage, keeping their ids, to free the
        main cluster for search text and uploads. Stops at limit_mb moved or when Supabase is full.
        Returns (files moved, bytes moved)."""
        target = next((m for m in self.members if isinstance(m, SupabaseMember)), None)
        if target is None:
            log.warning("No Supabase Storage configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY); nothing moved")
            return 0, 0
        moved, size = 0, 0
        for cluster in self.clusters:
            for doc in cluster.find_all({}, {"_id": 1, "filename": 1, "length": 1, "metadata": 1}):
                if limit_mb is not None and size >= limit_mb * MB:
                    return moved, size
                if not self.has_room(target, doc.get("length", 0)):
                    log.warning("Supabase Storage is full; stopped moving files")
                    return moved, size
                stream = cluster.open(doc["_id"])
                if stream is None:
                    continue
                data = stream.read()
                target.upload(data, doc.get("filename", str(doc["_id"])), doc.get("metadata") or {}, file_id=doc["_id"])
                cluster.delete(doc["_id"])
                self._usage[target.name][0] += len(data)
                self._usage[target.name][1] += len(data)
                moved, size = moved + 1, size + len(data)
                if moved % 50 == 0:
                    log.info("Moved %d files (%.1f MB) to Supabase Storage", moved, size / MB)
        return moved, size

    def report(self):
        """One line per storage place, for the scrape log."""
        lines = []
        for member in self.members:
            total, mine = self.usage(member)
            budget = f", this site's budget {self.budget / MB:.0f} MB" if self.budget is not None else ""
            lines.append(f"{member.label}: {total / MB:.1f} MB used of {member.cap / MB:.0f} MB, "
                         f"this site {mine / MB:.1f} MB{budget}")
        return lines
