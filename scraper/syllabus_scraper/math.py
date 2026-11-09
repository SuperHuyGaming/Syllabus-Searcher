"""GMU Mathematical Sciences syllabi. Three places list them, each with exact file URLs:

1. College of Science term pages, ".../mathematical-sciences-course-syllabi/course-N", one per term
   (Spring 2018 to Summer 2022). They are gone from the live site, so their Internet Archive
   copies are read. Each has a table "105-001 (Precalculus) | Yusko" linking a PDF at
   science.gmu.edu/media/<slug>, which is still live. The menu on any of them names every page.
2. math.gmu.edu/syllabi/S18/ (F18, S19): live folder listings, files like "113-001 - Hmidouch.pdf".
3. Files the College of Science added after Fall 2022, whose term pages were archived empty:
   the Internet Archive's list of science.gmu.edu/media/math* URLs. Slugs like
   "math-213-bryan-summer-2023" name the course, instructor and term; files whose slug
   doesn't name a term are skipped, never guessed. The archive's list is sometimes offline;
   then this part finds nothing and the next run tries again.

Course, section, instructor and term come from the table, file name or slug; the course
title from the table or, later, the catalog. Rows go to the shared download path
(syllabus_scraper/listings.py).
"""

import logging
import re
from urllib.parse import unquote, urljoin, urlsplit

import requests
from bs4 import BeautifulSoup

from .listings import Listed
from .parse import Row, Term, parse_term
from .sources import CDX, wayback_url

log = logging.getLogger("scraper")

PAGES = "https://science.gmu.edu/academics/departments-units/mathematical-sciences/mathematical-sciences-course-syllabi"
# Any term page lists every term page in its menu; this one was archived with it.
MENU_PAGE = f"{PAGES}/course-10"
FOLDERS = "https://math.gmu.edu/syllabi/"
KNOWN_FOLDERS = ["S18", "F18", "S19"]
MEDIA = "science.gmu.edu/media/math"
# Archive captures to try for a term page, nearest first. A few were captured empty.
CAPTURES = ["2022", "2020", "2025"]

SEASON_CODES = {"s": "Spring", "sp": "Spring", "spring": "Spring", "su": "Summer", "sum": "Summer",
                "summer": "Summer", "f": "Fall", "fa": "Fall", "fall": "Fall", "u": "Summer"}

SECTION = r"(?:\d{3}|DL\d|[A-Z]\d{2}|[A-Z]{2}\d)"


def _year(text):
    year = int(text)
    return year + 2000 if year < 100 else year


def clean(text):
    return re.sub(r"\s+", " ", (text or "").replace("\xa0", " ")).strip()


def split_names(text):
    """'Calderon' -> ['Calderon']; 'Smith/Jones', 'Smith & Jones', 'Smith and Jones' -> both."""
    names = [clean(n) for n in re.split(r"\s*(?:/|&|;|\band\b)\s*", clean(text)) if clean(n)]
    return names or ["Staff"]


def parse_course_cell(text):
    """'105-001 (Precalculus)' -> ('MATH105', '001', 'Precalculus').
    Also 'MATH 113-002', '106-001/002 (...)', '214 (Elementary Differential Equations)'."""
    text = clean(text)
    match = re.match(rf"^(?:(?P<dept>[A-Z]{{2,4}})\s*)?(?P<num>\d{{3}})(?:\s*[-–]\s*(?P<sections>{SECTION}(?:\s*[/,&]\s*{SECTION})*))?\s*(?:\((?P<title>.*)\))?",
                     text, re.I)
    if not match:
        return None
    sections = re.findall(SECTION, (match.group("sections") or "").upper())
    return (f"{(match.group('dept') or 'MATH').upper()}{match.group('num')}",
            ", ".join(sections) or "N/A", clean(match.group("title") or "").rstrip(")"))


def menu_pages(html):
    """[(term, url)] for every term page the menu links, from one archived term page."""
    soup = BeautifulSoup(html, "html.parser")
    pages = {}
    for link in soup.find_all("a", href=True):
        path = urlsplit(link["href"]).path
        if "/mathematical-sciences-course-syllabi/course" not in path:
            continue
        term = parse_term(link.get_text())
        if term:
            pages[term] = urljoin(PAGES + "/", path.rsplit("/", 1)[-1])
    return sorted(pages.items(), key=lambda pair: pair[0].key)


def parse_term_page(html, term=None):
    """Returns (term, [Row]) for one archived term page."""
    soup = BeautifulSoup(html, "html.parser")
    if term is None:
        title = soup.find("title")
        term = parse_term(title.get_text() if title else "")
    rows = []
    for tr in soup.find_all("tr"):
        cells = tr.find_all("td")
        link = tr.find("a", href=True)
        if len(cells) < 2 or not link or "/media/" not in link["href"]:
            continue
        course = parse_course_cell(cells[0].get_text())
        if not course:
            continue
        code, section, title = course
        href = urljoin("https://science.gmu.edu/", link["href"].strip())
        href = re.sub(r"^https?://web\.archive\.org/web/\d+(?:id_)?/", "", href)
        rows.append(Row(codes=[code], section=section, title=title, instructors=split_names(cells[1].get_text()),
                        href=href, term=term, source="gmu-math"))
    return term, rows


def folder_term(name):
    """'S18' -> Spring 2018, 'F18' -> Fall 2018, 'U19' -> Summer 2019."""
    match = re.fullmatch(r"([SFU])(\d{2})", name.strip("/").upper())
    if not match:
        return None
    return Term({"S": "Spring", "F": "Fall", "U": "Summer"}[match.group(1)], 2000 + int(match.group(2)))


FOLDER_FILE = re.compile(
    rf"^(?:(?P<dept>[A-Z]{{2,4}})[ _-]?)?(?P<num>\d{{3}})(?:[ _-]+(?P<sections>{SECTION}(?:\s*[,&_/]\s*{SECTION})*))?"
    rf"\s*(?:[-–_]\s*)?(?P<names>.*?)\.pdf$",
    re.I,
)


def parse_folder_file(name, term):
    """'113-001 - Hmidouch.pdf' -> Row(MATH113, '001', ['Hmidouch']); '113 - Sausville.pdf' -> section N/A."""
    match = FOLDER_FILE.match(clean(unquote(name)))
    if not match:
        return None
    sections = re.findall(SECTION, (match.group("sections") or "").upper())
    return Row(codes=[f"{(match.group('dept') or 'MATH').upper()}{match.group('num')}"],
               section=", ".join(sections) or "N/A", title="", instructors=split_names(match.group("names")),
               href="", term=term, source="gmu-math")


def parse_folder(html, base, term):
    """Rows for every PDF in one math.gmu.edu folder listing."""
    rows = []
    for link in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        href = link["href"]
        if "?" in href or "/" in href.strip("/") or not href.lower().endswith(".pdf"):
            continue
        row = parse_folder_file(unquote(href), term)
        if row:
            row.href = urljoin(base, href)
            rows.append(row)
    return rows


MEDIA_SLUG = re.compile(
    rf"^math[-_]?(?P<num>\d{{3}})(?:[-_](?P<section>{SECTION}))?[-_](?P<names>[a-z][a-z_-]*?)[-_]"
    r"(?P<season>spring|summer|fall|sp|su|fa|sum|f|s)[-_]?(?P<year>\d{4}|\d{2})(?:[-_]\d+)?$",
    re.I,
)


def parse_media_slug(url):
    """'.../media/math-213-bryan-summer-2023' -> Row(MATH213, N/A, ['Bryan'], Summer 2023), else None."""
    slug = unquote(urlsplit(url).path).rsplit("/", 1)[-1]
    match = MEDIA_SLUG.match(slug)
    if not match:
        return None
    term = Term(SEASON_CODES[match.group("season").lower()], _year(match.group("year")))
    names = [n.capitalize() for n in re.split(r"[-_]", match.group("names")) if n and n.lower() != "and"]
    return Row(codes=[f"MATH{match.group('num')}"], section=(match.group("section") or "N/A").upper(), title="",
               instructors=names or ["Staff"], href=f"https://science.gmu.edu/media/{slug}", term=term,
               source="gmu-math-filename")


def _archived(fetcher, url):
    """The first non-empty archive capture of a term page: (timestamp, html) or (None, None)."""
    for when in CAPTURES:
        res = fetcher.get(wayback_url(when, url))
        if res is None:
            continue
        html = res.content.decode("utf-8", errors="replace")
        if "/media/" in html:
            stamp = re.search(r"/web/(\d{14})", res.url or "")
            return (stamp.group(1) if stamp else when), html
    return None, None


def term_page_rows(fetcher, since):
    res = fetcher.get(wayback_url(CAPTURES[0], MENU_PAGE))
    pages = menu_pages(res.content.decode("utf-8", errors="replace")) if res else []
    if not pages:
        log.warning("Couldn't read the Math term pages' menu from the Internet Archive")
    for term, url in pages:
        if term.key < since.key:
            continue
        timestamp, html = _archived(fetcher, url)
        if not html:
            log.info("Math %s: no archived copy lists files", term.label)
            continue
        _, rows = parse_term_page(html, term)
        log.info("Math %s: %d syllabi on the term page", term.label, len(rows))
        yield from (Listed(row, timestamp) for row in rows)


def folder_rows(fetcher, since):
    res = fetcher.get(FOLDERS)
    names = re.findall(r'href="([SFU]\d{2})/"', res.text, re.I) if res else []
    for name in dict.fromkeys(names or KNOWN_FOLDERS):
        term = folder_term(name)
        if not term or term.key < since.key:
            continue
        base = f"{FOLDERS}{name}/"
        listing = fetcher.get(base)
        if not listing:
            log.info("Math folder %s: not open", name)
            continue
        rows = parse_folder(listing.text, base, term)
        log.info("Math folder %s (%s): %d syllabi", name, term.label, len(rows))
        yield from (Listed(row, None) for row in rows)


def media_rows(fetcher, since, retries=3):
    params = {"url": MEDIA, "matchType": "prefix", "output": "json", "fl": "timestamp,original",
              "filter": "statuscode:200", "collapse": "urlkey"}
    url = requests.Request("GET", CDX, params=params).prepare().url
    rows = None
    for _ in range(retries):
        res = fetcher.get(url)
        try:
            rows = res.json()[1:] if res else None
        except ValueError:  # "temporarily offline" page
            rows = None
        if rows is not None:
            break
    if rows is None:
        log.warning("The Internet Archive's file list is offline; Math files after Summer 2022 wait for the next run")
        return
    found = 0
    for timestamp, original in rows:
        row = parse_media_slug(original)
        if row and row.term.key >= since.key:
            found += 1
            yield Listed(row, timestamp)
    log.info("Math files in the archive's list of science.gmu.edu/media: %d with a term in the name", found)


def rows(fetcher, since):
    """Every Math syllabus listed in any of the three places; listings.choose drops repeats."""
    yield from term_page_rows(fetcher, since)
    yield from folder_rows(fetcher, since)
    yield from media_rows(fetcher, since)

