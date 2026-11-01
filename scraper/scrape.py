"""Scrapes GMU CS syllabi into MongoDB (files) and DynamoDB (catalog).

    python scrape.py --since "Fall 2022"            # live site + Internet Archive
    python scrape.py --dry-run                      # parse only, write nothing
    python scrape.py --html tests/fixtures/x.html   # parse saved pages instead of fetching the index
    python scrape.py --index-only                   # just make saved files searchable
    python scrape.py --catalog-only                 # just load every course from catalog.gmu.edu

Two passes:
  1. Listing pages (live or archived): course, section, title and instructor come from the table.
  2. Archived files no listing page mentions (e.g. all of 2023): details are guessed from the file name.
"""

import argparse
import logging
import re
import sys
from datetime import date
from urllib.parse import unquote, urlsplit

from dotenv import load_dotenv

from syllabus_scraper import sources
from syllabus_scraper.catalog import fetch_catalog
from syllabus_scraper.parse import current_term, parse_filename, parse_index, parse_term, terms_between
from syllabus_scraper.store import Store, detect_content_type
from syllabus_scraper.text import extract_text

MAX_FILE_BYTES = 4 * 1024 * 1024  # same cap as the API (Lambda response limit)
DEPARTMENTS = {"CS"}

log = logging.getLogger("scraper")


def dept_of(code):
    return re.match(r"[A-Z]+", code).group(0)


def path_of(href):
    """Listing pages and the archive spell the same file differently; compare decoded paths."""
    return unquote(urlsplit(href).path)


def display(code):
    return re.sub(r"^([A-Z]+)", r"\1 ", code)


def listing_rows(fetcher, args, since):
    """Yields (archive timestamp or None, Row) from every listing page."""
    if args.html:
        for path in args.html:
            with open(path, encoding="utf-8", errors="replace") as f:
                _, rows = parse_index(f.read())
            yield from ((None, row) for row in rows)
        return

    pages = []
    live = sources.live_index_page(fetcher)
    if live:
        pages.append((None, live))
    else:
        log.info("Live syllabus page unavailable, using Internet Archive captures")
    pages.extend(sources.archived_index_pages(fetcher, since.year))

    for timestamp, html in pages:
        term, rows = parse_index(html)
        log.info("Capture %s: %s, %d rows", timestamp or "live", term.label if term else "unknown term", len(rows))
        yield from ((timestamp, row) for row in rows)


def filename_rows(fetcher, since, seen, titles, store):
    """Yields (timestamp, Row) for archived files that no listing page covered."""
    for term in terms_between(since, current_term(date.today())):
        found = 0
        for timestamp, path in sources.archived_files(fetcher, term):
            if path in seen:
                continue
            row = parse_filename(path, term)
            if not row:
                continue
            code = row.codes[0]
            row.title = titles.get(code) or (store and store.course_title(code)) or display(code)
            found += 1
            yield timestamp, row
        log.info("Archive files for %s: %d not on any listing page", term.label, found)


def mentions_course(data, content_type, codes):
    """False for a web page that never names its course number. Dead syllabus links can
    redirect to a generic department page, and the archive saves that page instead.
    PDFs are trusted: scanned ones have no text to check."""
    if not content_type.startswith("text/html"):
        return True
    text = extract_text(data, content_type)
    return any(re.search(rf"(?<!\d){re.escape(code[len(dept_of(code)):])}(?!\d)", text) for code in codes)


def save_row(store, fetcher, timestamp, row, codes):
    """Downloads the file if it's new and writes the offering. Returns True if a new file was saved,
    False if it already existed, None if it was skipped."""
    source_url = f"{sources.SITE}{path_of(row.href)}"
    if store.is_curated(source_url):
        log.info("Kept admin's version of %s", source_url)
        return False
    existing = store.file_for(source_url)
    if existing:
        file_id, content_type = existing
    else:
        data, _ = sources.fetch_file(fetcher, source_url, timestamp)
        content_type = detect_content_type(data, source_url) if data else None
        if not content_type or len(data) > MAX_FILE_BYTES:
            log.warning("Skipped %s (%s)", source_url, "not found" if not data else "unsupported type or over 4 MB")
            return None
        if not mentions_course(data, content_type, codes):
            log.warning("Skipped %s (a web page that never mentions %s, likely a redirect)", source_url, ",".join(codes))
            return None
        file_id = store.save_file(data, source_url, content_type)

    for code in codes:
        store.save_offering(dept_of(code), code, row, file_id, content_type, source_url)
    log.info("Saved %s %s %s", row.term.label, ",".join(codes), row.section)
    return existing is None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--since", default="Fall 2022", help='Oldest term to keep, e.g. "Fall 2022"')
    parser.add_argument("--dry-run", action="store_true", help="Parse and list rows without downloading or writing")
    parser.add_argument("--limit", type=int, default=0, help="Stop after this many new files")
    parser.add_argument("--html", nargs="*", help="Parse saved listing pages instead of fetching the index")
    parser.add_argument("--no-filenames", action="store_true", help="Skip the pass that guesses details from file names")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between requests")
    parser.add_argument("--index-only", action="store_true", help="Skip scraping; only make saved files searchable")
    parser.add_argument("--catalog-only", action="store_true", help="Only load the course list from catalog.gmu.edu")
    parser.add_argument("--no-catalog", action="store_true", help="Skip loading the course list from catalog.gmu.edu")
    parser.add_argument("--reindex", action="store_true", help="Re-extract text for every file, not just new ones")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("pypdf").setLevel(logging.ERROR)  # it warns about every slightly malformed PDF
    load_dotenv()
    since = parse_term(args.since)
    if not since:
        parser.error('--since should look like "Fall 2022"')

    fetcher = sources.Fetcher(delay=args.delay)
    store = None if args.dry_run else Store()
    seen, titles = set(), {}
    counts = {"rows": 0, "saved": 0, "skipped": 0}

    def handle(timestamp, row):
        """Returns False once --limit is reached."""
        counts["rows"] += 1
        codes = [c for c in row.codes if dept_of(c) in DEPARTMENTS]
        if not codes:
            return True
        if args.dry_run:
            log.info("%s  %-14s %-12s %-16s %s", row.term.label, ",".join(codes), row.section, row.source, "; ".join(row.instructors))
            return True
        result = save_row(store, fetcher, timestamp, row, codes)
        if result is None:
            counts["skipped"] += 1
        elif result:
            counts["saved"] += 1
        return not (args.limit and counts["saved"] >= args.limit)

    def run():
        for timestamp, row in listing_rows(fetcher, args, since):
            for code in row.codes:
                titles.setdefault(code, row.title)
            path = path_of(row.href)
            if not row.term or row.term.key < since.key or path in seen:
                continue
            seen.add(path)
            if not handle(timestamp, row):
                return
        if args.html or args.no_filenames:
            return
        for timestamp, row in filename_rows(fetcher, since, seen, titles, store):
            seen.add(path_of(row.href))
            if not handle(timestamp, row):
                return

    def load_catalog():
        for dept in sorted(DEPARTMENTS):
            courses = fetch_catalog(fetcher, dept)
            if not courses:
                log.warning("Couldn't read the %s course catalog; keeping the current course list", dept)
                continue
            log.info("Loaded %d %s courses from the catalog", store.save_catalog(dept, courses), dept)

    if args.catalog_only:
        if store:
            load_catalog()
        return 0

    if not args.index_only:
        run()
        log.info("Done: %d rows, %d new files, %d skipped", counts["rows"], counts["saved"], counts["skipped"])
    if store and not args.no_catalog:
        load_catalog()
    if store:
        log.info("Made %d syllabi searchable", store.index_text(reindex=args.reindex))
        log.info("Filled in full professor names on %d syllabi", store.resolve_names())
        log.info("Made PDF copies of %d HTML syllabi", store.make_pdfs())
    return 0


if __name__ == "__main__":
    sys.exit(main())
