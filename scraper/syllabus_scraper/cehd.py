"""GMU College of Education and Human Development (CEHD) syllabi.

Each course has a page, cehd.gmu.edu/courses/HEAL-325, titled "HEAL 325: Human Sexuality", that lists
its sections: "Spring 2024, Section: DL1, CRN 10086, Format: Online, Instructor: Diana Karczmarczyk,"
followed by a link to /assets/docs/syllabi/2024/syllabus_48196.pdf. CEHD took those links (and the
files) down between July and November 2024, so both are read from the Internet Archive: the last
capture of each course page before September 2024, then the files that capture links.

The course list comes from the archive's list of cehd.gmu.edu/courses/ pages. Archived pages never
change, so each one's rows are kept in MongoDB (collection "listing_pages") once read, and a run
reads at most PAGES_PER_RUN new pages; later runs continue. Rows go to the shared download path
(syllabus_scraper/listings.py), which keeps the newest syllabus per course.
"""

import logging
import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from . import cos
from .listings import Listed
from .parse import Row, Term
from .sources import CDX, wayback_url

log = logging.getLogger("scraper")

SITE = "https://cehd.gmu.edu"
PAGES = "cehd.gmu.edu/courses/"
# Course pages linked syllabi until mid-2024; captures after this have none.
LAST_CAPTURE = "20240831"
NEAR = "20240723"
PAGES_PER_RUN = 600

SECTION_LINE = re.compile(
    r"(?P<season>Spring|Summer|Fall)\s+(?P<year>\d{4}),\s*Section:\s*(?P<section>[^,]+),"
    r"(?:\s*CRN\s*\d+,)?(?:\s*Format:\s*[^,]*,)?\s*Instructor:\s*(?P<names>.*?)\s*,?\s*(?:Syllabus)?\s*$",
    re.I,
)
SYLLABUS = re.compile(r"/syllabi/\d{4}/syllabus_\d+\.pdf$", re.I)
COURSE_PATH = re.compile(r"/courses/([A-Z]{2,4})-(\d{3})/?$")


def clean(text):
    return re.sub(r"\s+", " ", (text or "").replace("\xa0", " ")).strip()


def instructors(text):
    """'Diana Karczmarczyk' -> ['Karczmarczyk, Diana']; 'A Smith, B Jones' -> both; 'TBA' -> ['Staff']."""
    names = [cos.parse_name(n) for n in re.split(r"\s*(?:,|;|/|&|\band\b)\s*", clean(text)) if clean(n)]
    names = [n for n in names if n and n.upper() not in {"TBA", "STAFF"}]
    return names or ["Staff"]


def parse_course_page(html, code=None):
    """Returns [Row] for every section with a syllabus link on one course page."""
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.find("h1")
    match = re.match(r"^([A-Z]{2,4})\s*(\d{3})\s*:?\s*(.*)$", clean(heading.get_text(" ")) if heading else "")
    if match:
        code, title = f"{match.group(1)}{match.group(2)}", match.group(3)
    else:
        title = ""
    if not code:
        return []
    rows = []
    for item in soup.find_all("li"):
        link = next((a for a in item.find_all("a", href=True) if SYLLABUS.search(a["href"].split("?")[0])), None)
        if not link:
            continue
        for extra in item.find_all(class_="screenreader"):
            extra.decompose()
        line = SECTION_LINE.search(clean(item.get_text(" ")))
        if not line:
            continue
        href = re.sub(r"^https?://web\.archive\.org/web/\d+(?:id_)?/", "", urljoin(SITE, link["href"].strip()))
        rows.append(Row(codes=[code], section=line.group("section").strip(" *"), title=title,
                        instructors=instructors(line.group("names")), href=href.replace("http://", "https://", 1),
                        term=Term(line.group("season").capitalize(), int(line.group("year"))), source="gmu-cehd"))
    return rows


def _json(fetcher, params, retries=3):
    url = requests.Request("GET", CDX, params=params).prepare().url
    for _ in range(retries):
        res = fetcher.get(url)
        try:
            return res.json() if res else None
        except ValueError:  # "temporarily offline" page
            continue
    return None


def course_pages(fetcher):
    """{code: page URL} for every archived course page captured before LAST_CAPTURE, or None if
    the archive's list is offline."""
    rows = _json(fetcher, {"url": PAGES, "matchType": "prefix", "output": "json", "fl": "timestamp,original",
                           "filter": "statuscode:200", "collapse": "urlkey"})
    if rows is None:
        return None
    pages = {}
    for timestamp, original in rows[1:]:
        match = COURSE_PATH.search(original.split("?")[0])
        if match and timestamp <= LAST_CAPTURE:
            pages.setdefault(f"{match.group(1)}{match.group(2)}", f"{SITE}/courses/{match.group(1)}-{match.group(2)}")
    return pages


def _capture_stamp(res, fallback):
    stamp = re.search(r"/web/(\d{14})", getattr(res, "url", "") or "")
    return stamp.group(1) if stamp else fallback


def last_capture(fetcher, url):
    """(timestamp, html) of the last capture of a course page before LAST_CAPTURE, or (None, None)."""
    res = fetcher.get(wayback_url(NEAR, url))
    if res is not None:
        stamp = _capture_stamp(res, NEAR)
        if stamp <= LAST_CAPTURE:
            return stamp, res.content.decode("utf-8", errors="replace")
    # The nearest capture is too new (no links left); ask for the last one before the cutoff.
    rows = _json(fetcher, {"url": url, "output": "json", "fl": "timestamp", "filter": "statuscode:200",
                           "to": LAST_CAPTURE, "limit": "-1"})
    if not rows or len(rows) < 2:
        return None, None
    stamp = rows[-1][0]
    res = fetcher.get(wayback_url(stamp, url))
    return (stamp, res.content.decode("utf-8", errors="replace")) if res is not None else (None, None)


def _to_doc(timestamp, rows):
    return {"timestamp": timestamp, "rows": [
        {"codes": r.codes, "section": r.section, "title": r.title, "instructors": r.instructors, "href": r.href,
         "season": r.term.season, "year": r.term.year} for r in rows]}


def _from_doc(doc):
    return doc.get("timestamp"), [
        Row(codes=r["codes"], section=r["section"], title=r["title"], instructors=r["instructors"], href=r["href"],
            term=Term(r["season"], r["year"]), source="gmu-cehd") for r in doc.get("rows", [])]


def rows(fetcher, since, cache=None, pages_per_run=PAGES_PER_RUN):
    """Every CEHD syllabus listed on an archived course page; listings.choose drops repeats.
    `cache` (the scraper's Store, or None for a dry run) keeps the rows of pages already read."""
    pages = course_pages(fetcher)
    if pages is None:
        log.warning("The Internet Archive's list of CEHD course pages is offline; CEHD waits for the next run")
        return
    found, read, waiting = 0, 0, 0
    for code, url in sorted(pages.items()):
        doc = cache.listing_page(url) if cache is not None else None
        if doc is None:
            if read >= pages_per_run:
                waiting += 1
                continue
            read += 1
            timestamp, html = last_capture(fetcher, url)
            if html is None:
                continue  # archive hiccup: try again next run
            page_rows = parse_course_page(html, code)
            if cache is not None:
                cache.save_listing_page(url, _to_doc(timestamp, page_rows))
        else:
            timestamp, page_rows = _from_doc(doc)
        for row in page_rows:
            if row.term.key >= since.key:
                found += 1
                yield Listed(row, timestamp)
    log.info("CEHD: %d course pages, %d read from the archive this run, %d wait for the next run; %d syllabi",
             len(pages), read, waiting, found)
