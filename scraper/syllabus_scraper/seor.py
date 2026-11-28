"""GMU Systems Engineering and Operations Research (SEOR) syllabi, 2001-2018.

The old SEOR site is still live at www3.gmu.edu/schools/vse/seor/syllabi/: an index links one page
per term (fall15.php, spring16.php, ...), and each term page has a table row per course,
"OR 441 (PDF) | Deterministic Operations Research | NEYSHABOURI, S", whose link is the file
(15F/OR441.pdf). Rows that link elsewhere (a professor's home page) or nowhere are skipped.

All of it is older than listings.SINCE; like the archive sources (wayback.py) these files only
fill courses that have no syllabus yet, through the shared path in listings.py.
"""

import logging
import re
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from .listings import KEEP_ALL, Listed, dept_of
from .parse import Row, Term
from .wayback import OLDEST

log = logging.getLogger("scraper")

INDEX = "https://www3.gmu.edu/schools/vse/seor/syllabi/"
TERM_PAGE = re.compile(r"^(?P<season>fall|spring|summer)(?P<yy>\d{2})\.php$", re.I)
COURSE = re.compile(r"^\s*(?P<subj>[A-Z]{2,4})\s*(?P<num>\d{3})")
FILE_TYPES = (".pdf", ".htm", ".html", ".doc", ".docx")
SECTION_SUFFIX = re.compile(r"-(?P<sec>\d{1,3})\.[a-z]+$", re.I)


def clean(text):
    return re.sub(r"\s+", " ", (text or "").replace("\xa0", " ")).strip()


def instructors(text):
    """'NEYSHABOURI, S' -> ['Neyshabouri, S']; 'CHEN, CH / XU, JIE' -> both; '' or 'TBA' -> ['Staff']."""
    names = []
    for part in re.split(r"\s*(?:/|&|;|\band\b)\s*", clean(text)):
        match = re.match(r"^([A-Za-z'’ -]+),\s*([A-Za-z. ]+)$", part)
        if match and match.group(1).upper() not in {"TBA", "STAFF"}:
            last = " ".join(w.capitalize() for w in match.group(1).split())
            names.append(f"{last}, {match.group(2).strip().title() if len(match.group(2).strip()) > 2 else match.group(2).strip()}")
    return names or ["Staff"]


def term_pages(html, base=INDEX):
    """{Term: url} for every term page linked from the index (or from any term page)."""
    soup = BeautifulSoup(html, "html.parser")
    pages = {}
    for link in soup.find_all("a", href=True):
        name = link["href"].strip().rsplit("/", 1)[-1]
        match = TERM_PAGE.match(name)
        if match:
            term = Term(match.group("season").capitalize(), 2000 + int(match.group("yy")))
            pages[term] = urljoin(base, name)
    return pages


def parse_term_page(html, term, url):
    """[Row] for each course row on a term page that links a syllabus file in the SEOR folder."""
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    folder = urlsplit(INDEX).path
    for tr in soup.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 2:
            continue
        course = COURSE.match(clean(cells[0].get_text(" ")))
        link = tr.find("a", href=True)
        if not course or not link:
            continue
        href = urljoin(url, link["href"].strip())
        parts = urlsplit(href)
        # Some 2001 rows link "syllabi/01B/x.htm" from inside syllabi/, which 404s; the file is at syllabi/01B/x.htm.
        path = re.sub(r"/syllabi/(?:syllabi/)+", "/syllabi/", parts.path)
        if parts.hostname not in ("www3.gmu.edu", "www.gmu.edu") or not path.startswith(folder):
            continue
        if not path.lower().endswith(FILE_TYPES):
            continue
        section = SECTION_SUFFIX.search(path)
        rows.append(Row(
            codes=[f"{course.group('subj')}{course.group('num')}"],
            section=section.group("sec").zfill(3) if section else "All",
            title=clean(cells[1].get_text(" ")),
            instructors=instructors(cells[2].get_text(" ")) if len(cells) > 2 else ["Staff"],
            href=f"https://www3.gmu.edu{path}",
            term=term,
            source="gmu-seor",
        ))
    return rows


def rows(fetcher, since, cache=None):
    """Every SEOR syllabus file listed on a term page; listings.choose keeps the newest per course."""
    res = fetcher.get(INDEX)
    if res is None:
        log.warning("The SEOR syllabus index did not answer; SEOR waits for the next run")
        return
    pages = term_pages(res.text)
    found = 0
    for term, url in sorted(pages.items(), key=lambda item: item[0].key, reverse=True):
        if term.key < OLDEST.key:
            continue
        page = fetcher.get(url)
        if page is None:
            continue
        for row in parse_term_page(page.text, term, url):
            if row.term.key < since.key and dept_of(row.codes[0]) in KEEP_ALL:
                continue
            if cache is not None and hasattr(cache, "course_title") and not cache.course_title(row.codes[0]):
                continue
            found += 1
            yield Listed(row)
    log.info("SEOR: %d term pages, %d syllabi", len(pages), found)
