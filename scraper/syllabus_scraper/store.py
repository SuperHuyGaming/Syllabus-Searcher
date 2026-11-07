"""Writes scraped syllabi to the same stores the API reads:
files -> MongoDB GridFS bucket "syllabi", courses with syllabi and their offerings -> DynamoDB
(layout in api/src/repos/catalog.js), searchable text -> MongoDB collection "syllabus_text"
(read by api/src/repos/search.js), course catalogs -> MongoDB collections "schools", "departments"
and "courses" (read by api/src/repos/departments.js).
"""

import logging
import os
import re
from collections import defaultdict
from datetime import datetime, timezone

import boto3
import gridfs
from boto3.dynamodb.conditions import Attr, Key
from bson import ObjectId
from pymongo import MongoClient, UpdateOne

from .names import full_name, needs_full_name
from .pdf import PdfMaker
from .schools import DEFAULT_SCHOOL, school_code
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
        self._curated = None

    def is_curated(self, source_url):
        """True if an admin edited or deleted this file on the site; the scraper must not undo that."""
        if self._curated is None:
            self._curated = set()
            kwargs = {"KeyConditionExpression": Key("PK").eq("CURATED"), "ProjectionExpression": "SK"}
            while True:
                page = self.table.query(**kwargs)
                self._curated.update(item["SK"] for item in page["Items"])
                if "LastEvaluatedKey" not in page:
                    break
                kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
        return source_url in self._curated

    def file_for(self, source_url):
        """Returns (file_id, content_type) if this file was already saved, else None."""
        doc = self.db["syllabi.files"].find_one({"metadata.sourceUrl": source_url}, {"metadata": 1})
        return (str(doc["_id"]), doc["metadata"]["contentType"]) if doc else None

    def course_title(self, code):
        item = self.table.get_item(Key={"PK": f"COURSE#{code}", "SK": "META"}).get("Item")
        if item:
            return item["title"]
        course = self.db["courses"].find_one({"_id": code}, {"title": 1})
        return course["title"] if course else None

    def save_file(self, data, source_url, content_type):
        filename = source_url.rsplit("/", 1)[-1]
        file_id = self.bucket.upload_from_stream(
            filename, data, metadata={"contentType": content_type, "sourceUrl": source_url}
        )
        return str(file_id)

    def _touch_course(self, dept, code, title, now):
        """Course list entry + course record. Updates rather than replaces, so catalog details
        (description, credits) survive, and an existing title (the catalog's) is kept."""
        self.table.update_item(
            Key={"PK": f"DEPT#{dept}", "SK": f"COURSE#{code}"},
            UpdateExpression="SET code = :code, title = if_not_exists(title, :title), hasSyllabi = :yes, updatedAt = :now",
            ExpressionAttributeValues={":code": code, ":title": title, ":yes": True, ":now": now},
        )
        self.table.update_item(
            Key={"PK": f"COURSE#{code}", "SK": "META"},
            UpdateExpression="SET code = :code, title = if_not_exists(title, :title), updatedAt = :now",
            ExpressionAttributeValues={":code": code, ":title": title, ":now": now},
        )

    def save_offering(self, dept, code, row, file_id, content_type, source_url):
        now = datetime.now(timezone.utc).isoformat()
        self._touch_course(dept, code, row.title, now)
        self.table.put_item(
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

    def mark_scraped(self):
        """Records when a full scrape finished, for "Last updated" on the site.
        Only scrapedAt is set; the API sets uploadedAt on the same item when an upload is approved."""
        self.table.update_item(
            Key={"PK": "STATUS", "SK": "UPDATED"},
            UpdateExpression="SET scrapedAt = :now",
            ExpressionAttributeValues={":now": datetime.now(timezone.utc).isoformat()},
        )

    def save_school(self, school, departments, courses):
        """Lists a school on the site with how many departments and courses its catalog has."""
        self.db["schools"].update_one(
            {"_id": school["key"]},
            {"$set": {"name": school["name"], "short": school["short"], "departments": departments,
                      "courses": courses, "updatedAt": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )

    def save_department(self, school, department, courses):
        """Writes one department and every course the catalog lists for it, with or without
        a syllabus. Courses the catalog dropped are removed. The site shows the catalog's
        title, credits, description and prerequisites over the listings' (the API merges them).
        Keys carry the school ("unc:COMP", "unc:COMP110"; GMU's stay bare: schools.school_code).
        Kept in MongoDB, not DynamoDB: a school has thousands of courses, and the DynamoDB
        table's small provisioned capacity is meant for the syllabi."""
        dept, now = school_code(school, department["code"]), datetime.now(timezone.utc).isoformat()
        catalog = self.db["courses"]
        catalog.create_index("dept")
        catalog.create_index("school")
        codes = [school_code(school, c["code"]) for c in courses]
        writes = [
            UpdateOne(
                {"_id": code},
                {"$set": {"school": school, "dept": dept, "title": c["title"], "credits": c["credits"],
                          "description": c["description"], "prereqs": c["prereqs"], "updatedAt": now}},
                upsert=True,
            )
            for code, c in zip(codes, courses)
        ]
        if writes:
            catalog.bulk_write(writes, ordered=False)
        catalog.delete_many({"dept": dept, "_id": {"$nin": codes}})
        self.db["departments"].update_one(
            {"_id": dept},
            {"$set": {"school": school, "name": department["name"], "courses": len(courses), "updatedAt": now}},
            upsert=True,
        )
        return len(courses)

    def count_syllabi(self):
        """Sets withSyllabi on every department: how many of its courses have a syllabus.
        The API adds one when an approved upload gives a course its first syllabus;
        this weekly count corrects any drift (e.g. after an admin deletes one)."""
        codes = {o["code"] for offerings in self.offerings_by_file().values() for o in offerings}
        counts = defaultdict(int)
        for code in codes:
            counts[re.match(r"(?:[a-z]+:)?[A-Z]+", code).group(0)] += 1
        departments = self.db["departments"]
        departments.update_many({"_id": {"$nin": sorted(counts)}}, {"$set": {"withSyllabi": 0}})
        for dept, count in counts.items():
            # A department missing from the catalog still shows up, named by its code.
            school, _, bare = dept.rpartition(":")
            departments.update_one(
                {"_id": dept},
                {"$set": {"withSyllabi": count},
                 "$setOnInsert": {"school": school or DEFAULT_SCHOOL, "name": bare, "courses": 0}},
                upsert=True,
            )
        return len(counts)

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

    def resolve_names(self):
        """Replaces listed names like "Zhu, Z" or "Gonzalez" with the full name from the syllabus
        ("Zhu, Ziwei"), so students can search by first name. Keeps the listed form in
        listedInstructors. Skips student uploads and anything an admin fixed by hand.
        Returns how many offerings changed."""
        texts = self.db["syllabus_text"]
        count = 0
        for file_id, offerings in self.offerings_by_file().items():
            doc = texts.find_one({"_id": file_id}, {"text": 1})
            text = (doc or {}).get("text") or ""
            if not text:
                continue
            for offering in offerings:
                if offering.get("source") == "upload" or self.is_curated(offering.get("sourceUrl", "")):
                    continue
                listed = offering.get("listedInstructors") or offering["instructors"]
                resolved = [(full_name(n, text) if needs_full_name(n) else None) or n for n in listed]
                if resolved == offering["instructors"]:
                    continue
                self.table.update_item(
                    Key={"PK": offering["PK"], "SK": offering["SK"]},
                    UpdateExpression="SET instructors = :names, listedInstructors = :listed",
                    ExpressionAttributeValues={":names": resolved, ":listed": listed},
                )
                offering["instructors"] = resolved
                count += 1
            texts.update_one(
                {"_id": file_id},
                {"$set": {"instructors": list(dict.fromkeys(n for o in offerings for n in o["instructors"]))}},
            )
        return count

    def make_pdfs(self):
        """Gives every HTML syllabus a PDF copy (pdfFileId on its offerings), so students can
        always download a PDF. Copies are made once; later runs only re-link them, since a
        re-scrape rewrites offerings without pdfFileId. Returns how many copies were made."""
        files = self.db["syllabi.files"]
        html_files = list(files.find({"metadata.contentType": {"$regex": "^text/html"}}, {"filename": 1}))
        if not html_files:
            return 0
        by_file = self.offerings_by_file()
        made = 0
        with PdfMaker() as maker:
            for html_file in html_files:
                html_id = str(html_file["_id"])
                copy = files.find_one({"metadata.pdfOf": html_id}, {"_id": 1})
                if copy:
                    pdf_id = str(copy["_id"])
                else:
                    pdf = maker.html_to_pdf(self.bucket.open_download_stream(html_file["_id"]).read())
                    if not pdf:
                        continue
                    name = html_file["filename"].rsplit(".", 1)[0] + ".pdf"
                    pdf_id = str(
                        self.bucket.upload_from_stream(
                            name, pdf, metadata={"contentType": "application/pdf", "pdfOf": html_id}
                        )
                    )
                    made += 1
                for offering in by_file.get(html_id, []):
                    if offering.get("pdfFileId") != pdf_id:
                        self.table.update_item(
                            Key={"PK": offering["PK"], "SK": offering["SK"]},
                            UpdateExpression="SET pdfFileId = :pdf",
                            ExpressionAttributeValues={":pdf": pdf_id},
                        )
        return made
