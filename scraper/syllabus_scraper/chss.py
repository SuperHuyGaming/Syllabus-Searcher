"""GMU College of Humanities and Social Sciences (CHSS) and Mason Korea syllabi.

Most CHSS department sites run the same Courses and Syllabi app:
  https://<host>/course_sections?code=<SUBJ>&term=<YYYYTT>
where TT is 10 (Spring), 40 (Summer), or 70 (Fall), e.g. 202670 = Fall 2026.
Mason Korea runs the same app for its whole campus on one page per term:
  https://masonkorea.gmu.edu/course_sections?term=<YYYYTT>

Each row is `ul.courselist > li` with course, section, title, instructor(s),
schedule/room and, when uploaded, a link to a public file at
`https://d101vc9winf8ln.cloudfront.net/syllabuses/<section_id>/original/<file>`.
Course, section, title and instructor come from the row, and the term comes from
the URL parameter, never from the syllabus file name.

Completed historical terms are cached in MongoDB (collection "listing_pages")
once read; the current term is re-crawled on each run because uploads arrive
late. Rows go to the shared download path (syllabus_scraper/listings.py).
"""

import logging
import re
from datetime import date
from urllib.parse import parse_qs, urljoin, urlsplit

from bs4 import BeautifulSoup

from . import cos
from .listings import Listed
from .parse import Row, Term, current_term, parse_term, terms_between

log = logging.getLogger("scraper")

# CHSS department hosts and the subject codes each one lists.
CHSS_HOSTS = {
    "economics.gmu.edu": ["ECON"],
    "historyarthistory.gmu.edu": ["HIST", "ARTH"],
    "psychology.gmu.edu": ["PSYC"],
    "philosophy.gmu.edu": ["PHIL"],
    "cls.gmu.edu": ["CRIM"],
    "religiousstudies.gmu.edu": ["RELI"],
    "wmst.gmu.edu": ["WMST"],
    "english.gmu.edu": ["ENGH", "FOLK", "LING", "NAIS"],
    "communication.gmu.edu": ["COMM"],
    "soan.gmu.edu": ["SOCI", "ANTH"],
    "globalaffairs.gmu.edu": ["GLOA", "MEIS"],
    "integrative.gmu.edu": ["INTS", "BIS", "HDFS"],
    "chss.gmu.edu": ["HNRS"],
}
CHSS_FALLBACK_HOST = "chssweb.gmu.edu"
MASON_KOREA_HOST = "masonkorea.gmu.edu"

TERM_CODES = {"Spring": "10", "Summer": "40", "Fall": "70"}
CODE_SEASONS = {code: season for season, code in TERM_CODES.items()}

COURSE_HEAD = re.compile(
    r"^(?P<dept>[A-Z]{2,5})\s*(?P<num>\d{3,4})\s*[-–]\s*(?P<section>[^:]+?)(?::\s*(?P<title>.*))?$"
)
SYLLABUS_URL = re.compile(
    r"d101vc9winf8ln\.cloudfront\.net/syllabuses/(?P<section_id>\d+)/original/",
    re.I,
)
TIME_SEGMENT = re.compile(r"\b\d{1,2}:\d{2}\s*[AP]M\b", re.I)
SKIP_INSTRUCTOR = {"TBA", "TBD", "STAFF", "ONLINE"}


def clean(text):
    return re.sub(r"\s+", " ", (text or "").replace("\xa0", " ")).strip()


def term_code(term):
    """Term('Fall', 2026) -> '202670'."""
    return f"{term.year}{TERM_CODES[term.season]}"


def parse_term_code(code):
    """'202670' -> Term('Fall', 2026); None if not a valid YYYY(10|40|70) code."""
    match = re.fullmatch(r"(\d{4})(10|40|70)", str(code or "").strip())
    if not match:
        return None
    return Term(CODE_SEASONS[match.group(2)], int(match.group(1)))


def parse_term_arg(value):
    """Accepts either '202570' or 'Fall 2025'."""
    return parse_term_code(value) or parse_term(value)


def term_from_url(url):
    """Reads the term from a course_sections URL's ?term=<YYYYTT> query parameter."""
    params = parse_qs(urlsplit(url).query)
    values = params.get("term")
    return parse_term_code(values[0]) if values else None


def section_id_from_url(url):
    """Extracts the numeric section_id from a CloudFront syllabus URL, or None."""
    match = SYLLABUS_URL.search(url or "")
    return match.group("section_id") if match else None


def normalize_href(href, host):
    href = (href or "").strip()
    if href.startswith("//"):
        return f"https:{href}"
    return urljoin(f"https://{host}", href)


def page_url(host, term, subject=None):
    code = term_code(term)
    if subject:
        return f"https://{host}/course_sections?code={subject}&term={code}"
    return f"https://{host}/course_sections?term={code}"


def parse_instructors(text):
    """Extracts instructor names from the text between the course link and syllabus link.

    Segments are separated by em-dashes (—):
      '— David G. Armstrong — 10:30 AM to 11:45 AM MW - Krug Hall 242 -' -> ['Armstrong, David G.']
      '— Meredith H. Lair - Online -' -> ['Lair, Meredith H.']
      '— Jason Ham — William James Davis — 01:30 PM to 04:00 PM MTWR - 9900 Main Street -'
        -> ['Ham, Jason', 'Davis, William James']
      '— 09:00 AM to 11:40 AM T - Mason Korea ... G403 -' -> ['Staff']
      '- 9900 Main Street -' -> ['Staff']
    """
    text = clean(text)
    if not text or "\u2014" not in text:
        return ["Staff"]
    names = []
    # Everything before the first em-dash is empty or a room/location marker.
    for segment in text.split("\u2014")[1:]:
        segment = clean(segment)
        if not segment or segment.startswith("-") or TIME_SEGMENT.search(segment):
            continue
        # Strip trailing location/room suffix like ' - Online -' or ' - Krug Hall 242 -'
        # while preserving hyphens inside names like 'Sun-Young Park'.
        candidate = re.split(r"\s+-\s+|\s+-$", segment, maxsplit=1)[0].strip(" -")
        if not candidate or candidate.upper() in SKIP_INSTRUCTOR:
            continue
        parsed = cos.parse_name(candidate)
        if parsed and parsed.upper() not in SKIP_INSTRUCTOR:
            names.append(parsed)
    return list(dict.fromkeys(names)) or ["Staff"]


def parse_page(html, term, host, source="gmu-chss"):
    """Returns [(section_id, Row)] for every row with a CloudFront syllabus link."""
    if not term:
        return []
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for item in soup.select("ul.courselist > li"):
        links = item.find_all("a", href=True)
        if not links:
            continue
        course_link = links[0]
        syllabus_link = next((a for a in links[1:] if SYLLABUS_URL.search(a["href"])), None)
        if not syllabus_link:
            continue
        match = COURSE_HEAD.match(clean(course_link.get_text(" ")))
        if not match:
            continue
        href = normalize_href(syllabus_link["href"], host)
        section_id = section_id_from_url(href)
        if not section_id:
            continue

        # Collect text between the course link and the first subsequent link.
        between = []
        for sibling in course_link.next_siblings:
            if getattr(sibling, "name", None) == "a":
                break
            between.append(str(sibling) if isinstance(sibling, str) else sibling.get_text(" "))

        code = f"{match.group('dept')}{match.group('num')}"
        section = clean(match.group("section")) or "N/A"
        title = clean(match.group("title") or "")
        instructors = parse_instructors("".join(between))
        row = Row(
            codes=[code],
            section=section,
            title=title,
            instructors=instructors,
            href=href,
            term=term,
            source=source,
        )
        results.append((section_id, row))
    return results


def _to_doc(entries):
    return {
        "rows": [
            {
                "section_id": section_id,
                "codes": r.codes,
                "section": r.section,
                "title": r.title,
                "instructors": r.instructors,
                "href": r.href,
                "season": r.term.season,
                "year": r.term.year,
                "source": r.source,
            }
            for section_id, r in entries
        ]
    }


def _from_doc(doc, default_source):
    entries = []
    for r in doc.get("rows", []):
        row = Row(
            codes=r["codes"],
            section=r["section"],
            title=r["title"],
            instructors=r["instructors"],
            href=r["href"],
            term=Term(r["season"], r["year"]),
            source=r.get("source") or default_source,
        )
        entries.append((r.get("section_id") or section_id_from_url(r["href"]), row))
    return entries


def _terms_to_crawl(since, today, only_term=None):
    if only_term is not None:
        return [only_term]
    current = current_term(today)
    if since.key > current.key:
        return []
    return list(reversed(terms_between(since, current)))


def _fetch_entries(fetcher, url, term, host, source, cache, current):
    """Reads cached rows for completed historical terms; always re-crawls the current term."""
    is_historical = term.key < current.key
    if is_historical and cache is not None:
        doc = cache.listing_page(url)
        if doc is not None:
            return _from_doc(doc, source), True

    res = fetcher.get(url)
    if res is None:
        return None, False
    html = res.content.decode("utf-8", errors="replace")
    entries = parse_page(html, term_from_url(url) or term, host, source=source)
    if is_historical and cache is not None:
        cache.save_listing_page(url, _to_doc(entries))
    return entries, False


def chss_rows(fetcher, since, cache=None, hosts=None, term=None, today=None):
    """Every syllabus listed on CHSS department sites, deduped on section_id across hosts.
    `hosts` may be a dict of {host: [subjects]} or a single host string (e.g. 'historyarthistory.gmu.edu')."""
    today = today or date.today()
    current = current_term(today)
    only_term = parse_term_arg(term) if isinstance(term, str) and term else term
    terms = _terms_to_crawl(since, today, only_term)

    if hosts is None:
        host_map = CHSS_HOSTS
    elif isinstance(hosts, str):
        host_key = hosts.strip().lower()
        if host_key in CHSS_HOSTS:
            host_map = {host_key: CHSS_HOSTS[host_key]}
        elif host_key == CHSS_FALLBACK_HOST:
            all_subjects = [subj for subjs in CHSS_HOSTS.values() for subj in subjs]
            host_map = {CHSS_FALLBACK_HOST: all_subjects}
        else:
            log.warning("CHSS: unknown host %s", host_key)
            return
    else:
        host_map = hosts

    seen_sections = set()
    found, fetched, cached = 0, 0, 0
    for host, subjects in host_map.items():
        for subject in subjects:
            for t in terms:
                url = page_url(host, t, subject)
                entries, from_cache = _fetch_entries(fetcher, url, t, host, "gmu-chss", cache, current)
                if entries is None:
                    continue
                cached += int(from_cache)
                fetched += int(not from_cache)
                for section_id, row in entries:
                    if section_id in seen_sections:
                        continue
                    seen_sections.add(section_id)
                    if row.term.key >= since.key:
                        found += 1
                        yield Listed(row, None)
    log.info("CHSS: %d syllabi (%d pages fetched, %d from cache)", found, fetched, cached)


def masonkorea_rows(fetcher, since, cache=None, term=None, today=None):
    """Every syllabus listed on masonkorea.gmu.edu (whole campus on one page per term)."""
    today = today or date.today()
    current = current_term(today)
    only_term = parse_term_arg(term) if isinstance(term, str) and term else term
    terms = _terms_to_crawl(since, today, only_term)

    seen_sections = set()
    found, fetched, cached = 0, 0, 0
    for t in terms:
        url = page_url(MASON_KOREA_HOST, t)
        entries, from_cache = _fetch_entries(
            fetcher, url, t, MASON_KOREA_HOST, "gmu-masonkorea", cache, current
        )
        if entries is None:
            continue
        cached += int(from_cache)
        fetched += int(not from_cache)
        for section_id, row in entries:
            if section_id in seen_sections:
                continue
            seen_sections.add(section_id)
            if row.term.key >= since.key:
                found += 1
                yield Listed(row, None)
    log.info("Mason Korea: %d syllabi (%d pages fetched, %d from cache)", found, fetched, cached)
