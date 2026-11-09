"""Where syllabus files are kept: GridFS bucket "syllabi" on one or more free MongoDB Atlas clusters.

A free M0 cluster holds 512 MB, and both sites (production and staging databases) share
the main one. To keep more files, add another free cluster (one M0 per Atlas project) and
put its connection string in MONGODB_URI_2 (then MONGODB_URI_3, ...). Each new file goes to
the first cluster with room; its id stays a plain ObjectId, and the API looks for it in
each cluster in turn (api/src/repos/files.js).

    MONGODB_URI, MONGODB_URI_2, ...  clusters, main first (same database name on each: MONGODB_DB)
    STORAGE_CAP_MB                   stop filling a cluster at this size (default 470 of the 512 MB)
    STORAGE_BUDGET_MB                most this site's database may use on each cluster (unset: no limit);
                                     staging sets it so it keeps only a sample and production gets the space
"""

import logging
import os
import re

import gridfs
from bson import ObjectId
from pymongo import MongoClient

log = logging.getLogger("scraper")

MB = 1024 * 1024
DEFAULT_CAP_MB = 470


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


class Member:
    """One cluster: this site's database and its "syllabi" bucket."""

    def __init__(self, name, db):
        self.name = name
        self.db = db
        self.bucket = gridfs.GridFSBucket(db, bucket_name="syllabi")

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


class Pool:
    def __init__(self, members, cap=DEFAULT_CAP_MB * MB, budget=None):
        self.members = members
        self.cap = cap
        self.budget = budget
        self._usage = {}  # member name -> [cluster bytes, db bytes], kept up to date as files are added

    @classmethod
    def from_env(cls, env=os.environ):
        db_name = env.get("MONGODB_DB", "syllabus_searcher")
        members = [Member(str(i + 1), MongoClient(uri)[db_name]) for i, uri in enumerate(pool_uris(env))]
        cap = _mb(env.get("STORAGE_CAP_MB")) or DEFAULT_CAP_MB * MB
        return cls(members, cap=cap, budget=_mb(env.get("STORAGE_BUDGET_MB")))

    @property
    def main(self):
        return self.members[0]

    def usage(self, member):
        if member.name not in self._usage:
            self._usage[member.name] = [member.cluster_bytes(), member.db_bytes()]
        return self._usage[member.name]

    def has_room(self, member, size):
        cluster, db = self.usage(member)
        if cluster + size > self.cap:
            return False
        return self.budget is None or db + size <= self.budget

    def save(self, data, filename, metadata):
        """Saves a file in the first cluster with room. Returns its id, or None when every cluster is full."""
        for member in self.members:
            if self.has_room(member, len(data)):
                file_id = member.bucket.upload_from_stream(filename, data, metadata=metadata)
                usage = self._usage[member.name]
                usage[0] += len(data)
                usage[1] += len(data)
                return str(file_id)
        return None

    def find(self, query, projection=None):
        """The first stored file document matching a query on syllabi.files, from any cluster."""
        for member in self.members:
            doc = member.db["syllabi.files"].find_one(query, projection)
            if doc:
                return doc
        return None

    def open(self, file_id):
        """A download stream for a file, from whichever cluster has it, or None."""
        for member in self.members:
            try:
                return member.bucket.open_download_stream(ObjectId(file_id))
            except gridfs.errors.NoFile:
                continue
        return None

    def delete(self, file_id):
        for member in self.members:
            try:
                member.bucket.delete(ObjectId(file_id))
                return True
            except gridfs.errors.NoFile:
                continue
        return False

    def report(self):
        """One line per cluster, for the scrape log."""
        lines = []
        for member in self.members:
            cluster, db = self.usage(member)
            budget = f", this site's budget {self.budget / MB:.0f} MB" if self.budget is not None else ""
            lines.append(
                f"Storage cluster {member.name}: {cluster / MB:.1f} MB used of {self.cap / MB:.0f} MB, "
                f"this site {db / MB:.1f} MB{budget}"
            )
        return lines
