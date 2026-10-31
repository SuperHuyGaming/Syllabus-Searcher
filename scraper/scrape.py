"""Scrapes GMU CS syllabi into MongoDB (files) and DynamoDB (catalog).

    python scrape.py --since "Fall 2022"            # live site + Internet Archive
    python scrape.py --dry-run                      # parse only, write nothing
    python scrape.py --html tests/fixtures/x.html   # parse saved pages instead of fetching the index
"""

import argparse
import logging
import re
import sys

from dotenv import load_dotenv

from syllabus_scraper import sources
from syllabus_scraper.parse import parse_index, parse_term
from syllabus_scraper.store import Store, detect_content_type

MAX_FILE_BYTES = 4 * 1024 * 1024  # same cap as the API (Lambda response limit)
DEPARTMENTS = {"CS"}

log = logging.getLogger("scraper")


def dept_of(code):
    return re.match(r"[A-Z]+", code).group(0)


def collect_rows(fetcher, args, since):
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


def save_row(store, fetcher, timestamp, row, codes):
    """Downloads the file if it's new and writes the offering. Returns True if a new file was saved,
    False if it already existed, None if it was skipped."""
    source_url = row.href if row.href.startswith("http") else f"{sources.SITE}{row.href}"
    existing = store.file_for(source_url)
    is_new = existing is None
    if existing:
        file_id, content_type = existing
    else:
        data, source_url = sources.fetch_file(fetcher, row.href, timestamp)
        content_type = detect_content_type(data, source_url) if data else None
        if not content_type or len(data) > MAX_FILE_BYTES:
            log.warning("Skipped %s (%s)", source_url, "not found" if not data else "unsupported type or over 4 MB")
            return None
        file_id = store.save_file(data, source_url, content_type)

    for code in codes:
        store.save_offering(dept_of(code), code, row, file_id, content_type, source_url)
    log.info("Saved %s %s %s", row.term.label, ",".join(codes), row.section)
    return is_new


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--since", default="Fall 2022", help='Oldest term to keep, e.g. "Fall 2022"')
    parser.add_argument("--dry-run", action="store_true", help="Parse and list rows without downloading or writing")
    parser.add_argument("--limit", type=int, default=0, help="Stop after this many new files")
    parser.add_argument("--html", nargs="*", help="Parse saved listing pages instead of fetching the index")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between requests")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    load_dotenv()
    since = parse_term(args.since)
    if not since:
        parser.error('--since should look like "Fall 2022"')

    fetcher = sources.Fetcher(delay=args.delay)
    store = None if args.dry_run else Store()

    seen, saved, skipped = set(), 0, 0
    for timestamp, row in collect_rows(fetcher, args, since):
        if not row.term or row.term.key < since.key or row.href in seen:
            continue
        seen.add(row.href)
        codes = [c for c in row.codes if dept_of(c) in DEPARTMENTS]
        if not codes:
            continue

        if args.dry_run:
            log.info("%s  %-14s %-10s %s", row.term.label, ",".join(codes), row.section, "; ".join(row.instructors))
            continue

        result = save_row(store, fetcher, timestamp, row, codes)
        if result is None:
            skipped += 1
        elif result:
            saved += 1
        if args.limit and saved >= args.limit:
            break

    log.info("Done: %d rows seen, %d new files, %d skipped", len(seen), saved, skipped)
    return 0


if __name__ == "__main__":
    sys.exit(main())
