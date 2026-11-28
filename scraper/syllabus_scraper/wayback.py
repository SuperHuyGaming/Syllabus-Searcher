"""Syllabi that survive only in the Internet Archive (Wayback Machine), found by file name.

Several GMU departments once posted syllabi in plain folders that are gone now (ECE course pages,
the IT/AIT archive, IST) or that no page links to (Schar's webdocs PDFs). Instead of one scraper
per site, each one is a HARVESTS entry: a URL prefix to list with the archive's CDX API, and a
function that reads the course, term, section and instructor from a file's URL. Files whose URL
doesn't parse (slides, exams, index pages) are left out.

Archive lookups are free and need no key, but the archive is slow and goes "Temporarily Offline"
(an HTML page with status 200) after a few heavy queries. So every CDX answer is checked, retried
with growing pauses, and the list for each prefix is kept in MongoDB ("listing_pages") for
REFRESH_DAYS; when the archive is offline the kept list is used, or the source waits a run.

Most of these files are older than listings.SINCE (Spring 2018). They are only meant to give a
course with no syllabus at all one to show (owner's goal: every GMU course has at least one):
rows go to the shared path (listings.py), which keeps the newest syllabus per course, skips a
file when the course already has a newer one, and replaces it when a newer one is saved later.
Rows for courses not in the current catalog, and old rows for KEEP_ALL subjects, are dropped.
"""

import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote, urlsplit

import requests

from .cos import parse_name
from .listings import KEEP_ALL, Listed, dept_of
from .parse import Row, Term
from .sources import CDX, wayback_url

log = logging.getLogger("scraper")

OLDEST = Term("Spring", 2000)
REFRESH_DAYS = 30
CDX_TRIES = 4
OFFLINE_PAUSE = 60  # seconds; doubled after each offline answer


@dataclass(frozen=True)
class Harvest:
    key: str  # --sources name, e.g. "ece"
    prefix: str  # CDX url prefix, e.g. "ece.gmu.edu/coursewebpages/"
    parse: object  # (url) -> Row or None
    filters: tuple = field(default_factory=tuple)  # extra CDX filters, e.g. ("original:.*Syllabus.*",)
    # False: the site is gone, so files are read straight from the archive's copy. A dead site can
    # answer its old URLs with its home page (status 200), which would hide the archived file.
    live: bool = False


# ---------- file-name parsing ----------

SEASON_WORDS = {
    "f": "Fall", "fa": "Fall", "fall": "Fall",
    "s": "Spring", "sp": "Spring", "spr": "Spring", "spring": "Spring",
    "su": "Summer", "sum": "Summer", "summer": "Summer",
}


def season_of(text):
    return SEASON_WORDS.get((text or "").lower())


def year_of(text):
    year = int(text)
    return 2000 + year if year < 100 else year


def path_of(url):
    """Decoded path of an archived URL, without the host or query: '/coursewebpages/ECE/ECE220/ECE220_S09.pdf'."""
    return unquote(urlsplit(url).path)


def canonical(url):
    """https, no ':80', no query; the URL the file is stored under and fetched from."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return f"https://{host}{parts.path}"


ECE_FILE = re.compile(
    r"/coursewebpages/[A-Za-z]+/(?P<subj>[A-Za-z]{2,4})(?P<num>\d{3})/(?P=subj)(?P=num)_"
    r"(?P<season>Fa|Sp|Su|F|S)(?P<yy>\d{2})\.pdf$",
    re.I,
)


def parse_ece(url):
    """ece.gmu.edu/coursewebpages/ECE/ECE220/ECE220_S09.pdf -> ECE 220, Spring 2009 (ECE, BENG, CFRS, TCOM, ENGR)."""
    match = ECE_FILE.search(path_of(url))
    if not match:
        return None
    term = Term(season_of(match.group("season")), year_of(match.group("yy")))
    code = f"{match.group('subj').upper()}{match.group('num')}"
    return Row(codes=[code], section="All", title="", instructors=["Staff"], href=canonical(url), term=term,
               source="gmu-ece")


ITE_FOLDER = re.compile(r"/syllabi/(?P<season>fall|spring|summer)\s*(?P<year>\d{4})/", re.I)
ITE_COURSE = re.compile(r"(?<![A-Za-z])IT[\s_-]*(?P<num>\d{3})(?!\d)", re.I)
ITE_SECTION = re.compile(r"^[\s_-]*(?P<sec>\d{3}|[A-Z]\d{2}|\d{2}[A-Z])(?![A-Za-z0-9])", re.I)
NOT_NAMES = {"syllabus", "syllabi", "fall", "spring", "summer", "spr", "sum", "fa", "sp", "su", "web", "online",
             "prog", "fund", "java", "lecture", "website", "for", "ait", "it", "new", "final", "draft", "files"}
FILE_TYPES = (".htm", ".html", ".pdf", ".doc", ".docx")


def ite_instructor(stem):
    """'IT214_003_Eftekhari' -> 'Eftekhari'; 'IT342_003FA05_Sep29_Lou' -> 'Lou'; 'IT250' -> None."""
    words = [w for w in re.split(r"[\s_]+", stem) if w]
    if len(words) < 2:
        return None
    last = words[-1]
    if re.fullmatch(r"[A-Z][a-z'’-]{2,}", last) and last.lower() not in NOT_NAMES:
        return parse_name(last)
    return None


def parse_ite(url):
    """ite.gmu.edu/ait/syllabi/fall2006/IT214_003_Eftekhari.htm -> IT 214 003, Fall 2006, Eftekhari."""
    path = path_of(url)
    folder = ITE_FOLDER.search(path)
    name = path.rsplit("/", 1)[-1]
    if not folder or not name.lower().endswith(FILE_TYPES) or name.lower().startswith("syllabi_"):
        return None
    stem = name.rsplit(".", 1)[0]
    course = ITE_COURSE.search(stem)
    if not course:
        return None
    section = ITE_SECTION.match(stem[course.end():])
    instructor = ite_instructor(stem)
    term = Term(season_of(folder.group("season")), int(folder.group("year")))
    return Row(codes=[f"IT{course.group('num')}"], section=section.group("sec").upper() if section else "All",
               title="", instructors=[instructor] if instructor else ["Staff"], href=canonical(url), term=term,
               source="gmu-ite")


IST_FILE = re.compile(
    r"(?P<subj>[A-Z]{2,4})[\s_-]?(?P<num>\d{3})[\s_-]?(?:(?P<sec>\d{3}|[A-Z]\d{2})[\s_-]?)?"
    r"(?P<season>Fall|Spring|Summer)[\s_-]?(?P<year>\d{4})[\s_-]?Syllabus[^/]*\.(?:pdf|docx?)$",
    re.I,
)


def parse_ist(url):
    """ist.gmu.edu/wp-content/uploads/2019/08/IT106Fall2019Syllabus.pdf -> IT 106, Fall 2019."""
    match = IST_FILE.search(path_of(url).rsplit("/", 1)[-1])
    if not match:
        return None
    term = Term(season_of(match.group("season")), int(match.group("year")))
    return Row(codes=[f"{match.group('subj').upper()}{match.group('num')}"],
               section=(match.group("sec") or "All").upper(), title="", instructors=["Staff"], href=canonical(url),
               term=term, source="gmu-ist")


SCHAR_FILE = re.compile(
    r"/(?P<name>[A-Za-z][A-Za-z'.-]*?)-(?P<subj>[A-Z]{2,4})-(?P<num>\d{3})(?:-(?P<sec>[A-Z0-9]{3}))?"
    r"-(?P<season>FA|SP|SU)-?(?P<yy>\d{2})-Accessible(?:-\d+)?\.pdf$",
)


def parse_schar(url):
    """webdocs.gmu.edu/wp-content/uploads/Shark-PUAD-680-FA-25-Accessible.pdf -> PUAD 680, Fall 2025, Shark."""
    match = SCHAR_FILE.search(path_of(url))
    if not match:
        return None
    name = parse_name(match.group("name").replace("-", " ")) if "-" not in match.group("name") else None
    term = Term(season_of(match.group("season")), year_of(match.group("yy")))
    return Row(codes=[f"{match.group('subj')}{match.group('num')}"], section=match.group("sec") or "All",
               title="", instructors=[name or match.group("name")], href=canonical(url), term=term,
               source="gmu-schar")


HARVESTS = {
    "ece": Harvest("ece", "ece.gmu.edu/coursewebpages/", parse_ece, ("mimetype:application/pdf",)),
    "ite": Harvest("ite", "ite.gmu.edu/ait/syllabi/", parse_ite),
    "ist": Harvest("ist", "ist.gmu.edu/wp-content/uploads/", parse_ist, ("original:.*[Ss]yllabus.*",)),
    # Live files with no index page: listed through the archive, fetched live first.
    "schar": Harvest("schar", "webdocs.gmu.edu/wp-content/uploads/", parse_schar, ("original:.*Accessible.*",),
                     live=True),
}


# ---------- archive listing ----------

def cdx_rows(fetcher, harvest, tries=CDX_TRIES, sleep=time.sleep):
    """[(timestamp, original)] of every archived 200 under the prefix, or None while the archive is offline."""
    params = [("url", harvest.prefix), ("matchType", "prefix"), ("output", "json"),
              ("fl", "timestamp,original"), ("filter", "statuscode:200"), ("collapse", "urlkey")]
    params += [("filter", f) for f in harvest.filters]
    url = requests.Request("GET", CDX, params=params).prepare().url
    pause = OFFLINE_PAUSE
    for attempt in range(tries):
        res = fetcher.get(url)
        try:
            rows = res.json() if res is not None else None
        except ValueError:  # the "Temporarily Offline" HTML page, sent with status 200
            rows = None
        if isinstance(rows, list):
            return [(r[0], r[1]) for r in rows[1:] if len(r) >= 2]  # first row is the header
        if attempt + 1 < tries:
            log.info("The Internet Archive did not answer for %s; waiting %ds", harvest.prefix, pause)
            sleep(pause)
            pause *= 2
    return None


def _cache_id(harvest):
    return f"wayback:{harvest.prefix}"


def listed_urls(fetcher, harvest, cache=None, now=None, sleep=time.sleep):
    """[(timestamp, original)] for the prefix: from the kept list when fresh, else from the archive
    (and kept), else the stale kept list. None when there is nothing to go on."""
    now = now or datetime.now(timezone.utc)
    doc = cache.listing_page(_cache_id(harvest)) if cache is not None else None
    fetched = doc.get("fetchedAt") if doc else None
    if fetched is not None and fetched.tzinfo is None:
        fetched = fetched.replace(tzinfo=timezone.utc)
    if doc and fetched and now - fetched < timedelta(days=REFRESH_DAYS):
        return [tuple(r) for r in doc.get("rows", [])]
    rows = cdx_rows(fetcher, harvest, sleep=sleep)
    if rows is not None:
        if cache is not None:
            cache.save_listing_page(_cache_id(harvest), {"fetchedAt": now, "rows": [list(r) for r in rows]})
        return rows
    if doc:
        log.warning("The Internet Archive is offline; using the list of %s kept from %s", harvest.prefix, fetched)
        return [tuple(r) for r in doc.get("rows", [])]
    return None


def harvest_rows(fetcher, harvest, since=OLDEST, cache=None, sleep=time.sleep, now=None):
    """Yields Listed rows for one harvest, newest capture of each file."""
    urls = listed_urls(fetcher, harvest, cache=cache, now=now, sleep=sleep)
    if urls is None:
        log.warning("The Internet Archive's list of %s is offline; %s waits for the next run",
                    harvest.prefix, harvest.key)
        return
    known = {}

    def in_catalog(code):
        if cache is None or not hasattr(cache, "course_title"):
            return True
        if code not in known:
            known[code] = bool(cache.course_title(code))
        return known[code]

    found, unparsed, dropped = 0, 0, 0
    for timestamp, original in sorted(urls, key=lambda r: r[0], reverse=True):
        row = harvest.parse(original)
        if row is None or row.term is None:
            unparsed += 1
            continue
        if row.term.key < OLDEST.key or (row.term.key < since.key and dept_of(row.codes[0]) in KEEP_ALL):
            dropped += 1
            continue
        if not in_catalog(row.codes[0]):
            dropped += 1
            continue
        if not harvest.live:
            row.href = wayback_url(timestamp, row.href)
        found += 1
        yield Listed(row, timestamp)
    log.info("%s: %d archived files under %s, %d syllabi, %d not syllabi, %d dropped (too old or not in the catalog)",
             harvest.key, len(urls), harvest.prefix, found, unparsed, dropped)


def source(key):
    """A LISTING_SOURCES function for scrape.py: (fetcher, since, cache=None) -> Listed rows."""
    harvest = HARVESTS[key]

    def rows(fetcher, since, cache=None):
        return harvest_rows(fetcher, harvest, since=since, cache=cache)

    rows.__name__ = f"{key}_rows"
    return rows
