"""Shared download path for syllabi listed by department pages and folders (Math first, more later).

A source module yields Listed(row, timestamp): a parse.Row whose href is the exact file URL
from the listing (never a guessed one) and the Internet Archive capture to fall back to when
the live file is gone. Then:

1. choose() drops repeats (the same file, or the same course, term and section listed twice)
   and, outside KEEP_ALL subjects, keeps only the newest term's syllabus per course.
2. save_all() downloads each new file, keeps a copy in the storage pool (syllabus_scraper/pool.py),
   writes its offerings, its searchable text and a rule-based summary (syllabus_scraper/rules.py),
   and stops at the per-run limit or when storage is full. Files saved earlier are skipped, so a
   later run picks up where this one stopped.
"""

import logging
import re
from dataclasses import dataclass
from urllib.parse import unquote

from . import rules, sources
from .parse import Row, Term
from .text import extract_text

log = logging.getLogger("scraper")

# Syllabi from this term on (user's choice, 2026-11-08).
SINCE = Term("Spring", 2018)
# Subjects where every syllabus is kept; the rest keep the newest one per course (user's choice, 2026-11-09).
KEEP_ALL = {"MATH", "CS"}
MAX_FILE_BYTES = 4 * 1024 * 1024  # same cap as the API (Lambda response limit)


@dataclass
class Listed:
    row: Row
    timestamp: str = None  # archive capture of the listing, or None for a live listing


def dept_of(code):
    return re.match(r"(?:[a-z]+:)?[A-Z]+", code).group(0).rsplit(":", 1)[-1]


def keeps_all(codes, keep_all=KEEP_ALL):
    return any(dept_of(code) in keep_all for code in codes)


def source_url(href):
    """Stored with the file and its offerings; decoded, so the same file listed twice matches."""
    return unquote(href)


def mentions_course(data, content_type, codes):
    """False for a web page that never names its course number. Dead syllabus links can
    redirect to a generic department page, and the archive saves that page instead.
    PDFs are trusted: scanned ones have no text to check."""
    if not content_type.startswith("text/html"):
        return True
    text = extract_text(data, content_type)
    return any(re.search(rf"(?<!\d){re.escape(code[len(dept_of(code)):])}(?!\d)", text) for code in codes)


def choose(items, keep_all=KEEP_ALL):
    """The files worth downloading, in listing order."""
    by_url, by_section = {}, set()
    for item in items:
        row = item.row
        if not row.term or not row.codes:
            continue
        url = source_url(row.href)
        if url in by_url:
            continue
        # The same section listed twice (e.g. a term page and a folder) under different file names.
        section = (row.codes[0], row.term.key, row.section, tuple(n.lower() for n in row.instructors))
        if row.section != "N/A" and section in by_section:
            continue
        by_section.add(section)
        by_url[url] = item

    chosen = list(by_url.values())
    newest = {}
    for item in chosen:
        if keeps_all(item.row.codes, keep_all):
            continue
        code = item.row.codes[0]
        if code not in newest or item.row.term.key > newest[code].row.term.key:
            newest[code] = item
    keep = {id(item) for item in newest.values()}
    return [item for item in chosen if keeps_all(item.row.codes, keep_all) or id(item) in keep]


def text_doc(row, codes, text):
    """The search document for one file (read by api/src/repos/search.js)."""
    return {
        "codes": sorted(set(codes)),
        "title": row.title,
        "termKey": row.term.key,
        "termLabel": row.term.label,
        "section": row.section,
        "instructors": row.instructors,
        "source": row.source,
        "text": text,
    }


def replace_older(store, code, term):
    """Outside KEEP_ALL: False if the course already has a syllabus this new or newer.
    Otherwise removes its older scraped ones (student uploads and admin fixes stay) and returns True."""
    offerings = store.course_offerings(code)
    if any(o["termKey"] >= term.key for o in offerings):
        return False
    for offering in offerings:
        if offering.get("source") == "upload" or store.is_curated(offering.get("sourceUrl", "")):
            continue
        store.remove_offering(offering)
        log.info("Replaced %s %s with a newer syllabus", code, offering["termLabel"])
    return True


def save_one(store, fetcher, item, keep_all=KEEP_ALL):
    """Returns "saved", "exists", "skipped" or "full"."""
    row = item.row
    url = source_url(row.href)
    if store.is_curated(url):
        return "exists"
    if store.file_for(url):
        return "exists"
    if not keeps_all(row.codes, keep_all) and not replace_older(store, row.codes[0], row.term):
        return "skipped"

    data, _ = sources.fetch_file(fetcher, row.href, item.timestamp)
    content_type = store.content_type(data, url) if data else None
    if not content_type or len(data) > MAX_FILE_BYTES:
        log.warning("Skipped %s (%s)", url, "not found" if not data else "unsupported type or over 4 MB")
        return "skipped"
    if not mentions_course(data, content_type, row.codes):
        log.warning("Skipped %s (a web page that never mentions %s, likely a redirect)", url, ",".join(row.codes))
        return "skipped"

    file_id = store.save_file(data, url, content_type)
    if not file_id:
        return "full"
    if not row.title:
        row.title = store.course_title(row.codes[0]) or re.sub(r"^([A-Z]+)", r"\1 ", row.codes[0])
    for code in row.codes:
        store.save_offering(dept_of(code), code, row, file_id, content_type, url)

    text = extract_text(data, content_type)
    store.save_text(file_id, text_doc(row, row.codes, text))
    summary = rules.summarize(text)
    if summary:
        store.save_summary(file_id, summary, rules.PROVIDER)
    log.info("Saved %s %s %s (%s)", row.term.label, ",".join(row.codes), row.section,
             "summary from rules" if summary else "no summary")
    return "saved"


def save_all(store, fetcher, items, limit=0, keep_all=KEEP_ALL):
    """Downloads every chosen file not saved yet. Returns counts by result."""
    counts = {"saved": 0, "exists": 0, "skipped": 0}
    for item in choose(items, keep_all):
        result = save_one(store, fetcher, item, keep_all)
        if result == "full":
            log.warning("Storage is full; add a cluster (MONGODB_URI_2, ...) to keep more files. Stopping here.")
            counts["full"] = True
            break
        counts[result] += 1
        if limit and counts["saved"] >= limit:
            log.info("Reached the limit of %d new files for this run; the next run continues", limit)
            break
    return counts
