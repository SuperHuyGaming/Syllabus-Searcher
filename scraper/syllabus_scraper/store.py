"""Writes scraped syllabi to the same stores the API reads:
files -> MongoDB GridFS bucket "syllabi", catalog -> DynamoDB (layout in api/src/repos/catalog.js),
searchable text -> MongoDB collection "syllabus_text" (read by api/src/repos/search.js).
"""

import logging
import os
from collections import defaultdict
from datetime import datetime, timezone

import boto3
import gridfs
from boto3.dynamodb.conditions import Attr
from bson import ObjectId
from pymongo import MongoClient

from .text import extract_text

log = logging.getLogger("scraper")


def detect_content_type(data, url):
    head = data[:512].lstrip().lower()
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"<!doctype html") or head.startswith(b"<html") or url.lower().endswith((".html", ".htm")):
        return "text/html; charset=utf-8"
    return None  # .docx and others can't be shown in a browser, so they're skipped


class Store:
    def __init__(self):
        mongo = MongoClient(os.environ.get("MONGODB_URI", "mongodb://localhost:27017"))
        self.db = mongo[os.environ.get("MONGODB_DB", "syllabus_searcher")]
        self.bucket = gridfs.GridFSBucket(self.db, bucket_name="syllabi")
        dynamo = boto3.resource(
            "dynamodb",
            region_name=os.environ.get("AWS_REGION", "us-east-1"),
            endpoint_url=os.environ.get("DYNAMODB_ENDPOINT") or None,
        )
        self.table = dynamo.Table(os.environ.get("TABLE_NAME", "SyllabusSearcher"))

    def file_for(self, source_url):
        """Returns (file_id, content_type) if this file was already saved, else None."""
        doc = self.db["syllabi.files"].find_one({"metadata.sourceUrl": source_url}, {"metadata": 1})
        return (str(doc["_id"]), doc["metadata"]["contentType"]) if doc else None

    def course_title(self, code):
        item = self.table.get_item(Key={"PK": f"COURSE#{code}", "SK": "META"}).get("Item")
        return item["title"] if item else None

    def save_file(self, data, source_url, content_type):
        filename = source_url.rsplit("/", 1)[-1]
        file_id = self.bucket.upload_from_stream(
            filename, data, metadata={"contentType": content_type, "sourceUrl": source_url}
        )
        return str(file_id)

    def save_offering(self, dept, code, row, file_id, content_type, source_url):
        now = datetime.now(timezone.utc).isoformat()
        with self.table.batch_writer() as batch:
            batch.put_item(Item={"PK": f"DEPT#{dept}", "SK": f"COURSE#{code}", "code": code, "title": row.title, "updatedAt": now})
            batch.put_item(Item={"PK": f"COURSE#{code}", "SK": "META", "code": code, "title": row.title, "updatedAt": now})
            batch.put_item(
                Item={
                    "PK": f"COURSE#{code}",
                    "SK": f"TERM#{row.term.key}#SEC#{row.section}#{file_id}",
                    "code": code,
                    "title": row.title,
                    "termKey": row.term.key,
                    "termLabel": row.term.label,
                    "section": row.section,
                    "instructors": row.instructors,
                    "fileId": file_id,
                    "contentType": content_type,
                    "source": row.source,
                    "sourceUrl": source_url,
                    "createdAt": now,
                }
            )

    def offerings_by_file(self):
        """Every offering in DynamoDB, grouped by the file it points to."""
        by_file = defaultdict(list)
        kwargs = {"FilterExpression": Attr("SK").begins_with("TERM#")}
        while True:
            page = self.table.scan(**kwargs)
            for item in page["Items"]:
                by_file[item["fileId"]].append(item)
            if "LastEvaluatedKey" not in page:
                return by_file
            kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def index_text(self, reindex=False):
        """Extracts text from every syllabus file that isn't searchable yet.
        Also picks up uploads approved since the last run. Returns how many were indexed."""
        collection = self.db["syllabus_text"]
        collection.create_index([("codes", "text"), ("title", "text"), ("text", "text")],
                                weights={"codes": 10, "title": 5, "text": 1}, name="search")
        done = set() if reindex else {doc["_id"] for doc in collection.find({}, {"_id": 1})}

        count = 0
        for file_id, offerings in self.offerings_by_file().items():
            if file_id in done:
                continue
            try:
                stream = self.bucket.open_download_stream(ObjectId(file_id))
            except gridfs.errors.NoFile:
                continue
            text = extract_text(stream.read(), stream.metadata.get("contentType", ""))
            first = offerings[0]
            collection.replace_one(
                {"_id": file_id},
                {
                    "codes": sorted({o["code"] for o in offerings}),
                    "title": first["title"],
                    "termKey": first["termKey"],
                    "termLabel": first["termLabel"],
                    "section": first["section"],
                    "instructors": list(dict.fromkeys(n for o in offerings for n in o["instructors"])),
                    "source": first["source"],
                    "text": text,
                },
                upsert=True,
            )
            count += 1
            if not text:
                log.warning("No text in %s (likely a scanned PDF)", file_id)
        return count
