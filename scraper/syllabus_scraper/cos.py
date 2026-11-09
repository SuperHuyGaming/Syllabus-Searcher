"""Syllabi from the other College of Science departments (Math has its own module, math.py).

Each department below keeps live pages on science.gmu.edu that link its syllabus files
(science.gmu.edu/media/<slug>, /sites/default/files/..., binf.gmu.edu/Syllabi/...). Three layouts:

1. One page per term, its title "Course Syllabi Fall 2020", with a table of
   "EVPP 480-DL2 | Sustainability in Action | Schierbeek" rows (EVPP, GGS, Physics, CDS).
   The department's main syllabi page links every term page.
2. One page with a term heading ("Spring 2026") above a list of links like
   "NEUR 101 Intro to Neuroscience (Guerriero)" or "BINF 401-DL2, Bioinformatics" (Neuroscience,
   Systems Biology).
3. A grid of courses by term, "GEOL 101 | Physical Geology | LEC | LEC" with a column per term
   (AOES). The column headers have typos ("Spr 25" twice), so the file name's term comes first.

Course, section, title and instructor come from the row or link text; the term from the page
title, the nearest heading, the file name or the table column, in that order. Rows go to the
shared download path (syllabus_scraper/listings.py), which keeps the newest syllabus per course.
"""

import logging
import re
from urllib.parse import unquote, urljoin, urlsplit

from bs4 import BeautifulSoup

from .listings import Listed
from .parse import Row, Term, parse_term

log = logging.getLogger("scraper")

SITE = "https://science.gmu.edu/academics/departments-units/"
# Department -> its main syllabi pages. Term pages they link are followed (layout 1).
DEPARTMENTS = {
    "Environmental Science and Policy": ["environmental-science-policy/course-syllabi"],
    "Geography and Geoinformation Science": ["geography-geoinformation-science/programs-and-courses/course-syllabi"],
    "Physics and Astronomy": ["physics-and-astronomy-department/course-syllabi"],
    "Computational and Data Sciences": ["computational-data-sciences/course-syllabi"],
    "Atmospheric, Oceanic and Earth Sciences": [
        "j-shukla-department-atmospheric-oceanic-earth-sciences/course-syllabi/climate-dynamics",
        "j-shukla-department-atmospheric-oceanic-earth-sciences/course-syllabi/geology",
    ],
    "Neuroscience": ["neuroscience/course-syllabi"],
    "Systems Biology": ["systems-biology/course-syllabi"],
}
# Subject codes these pages use. Anything else is a typo ("IOL 691" for "BIOL 691") and is dropped.
SUBJECTS = {
    "ASTR", "BENG", "BIMR", "BINF", "BIOL", "BIOS", "CDS", "CHEM", "CLIM", "CSI", "CSS", "EVPP", "GEOL",
    "GGS", "GOVT", "METR", "NEUR", "OCEA", "PHYS", "PSYC",
}
SEASONS = {"spring": "Spring", "spr": "Spring", "sp": "Spring", "s": "Spring", "summer": "Summer",
           "sum": "Summer", "su": "Summer", "fall": "Fall", "fa": "Fall", "f": "Fall"}
TITLES = re.compile(r"^(?:dr|prof|professor|mr|ms|mrs)\.?\s+", re.I)

TOKEN = re.compile(
    r"\s*(?P<sep>[-–/&,]|and(?= ))?\s*(?:(?P<dept>[A-Z]{2,5})(?![a-z])\s*[-_]?\s*)?(?P<num>\d{3}|DL\d{1,2}|[A-Z]\d{2})(?![\w])"
)


def clean(text):
    return re.sub(r"\s+", " ", (text or "").replace("\xa0", " ").replace("�", " ")).strip()


def parse_course(text):
    """'EVPP 337-001/337-002 Policy' -> (['EVPP337'], '001, 002', 'Policy').
    'NEUR 461/592 AI' -> (['NEUR461', 'NEUR592'], 'N/A', 'AI'); 'ASTR 111 003 The Solar System' -> section 003.
    'BINF 701-001/BIOS 701-DL1, Systems Biology' -> (['BINF701', 'BIOS701'], '001, DL1', 'Systems Biology').
    None if the text doesn't start with a known subject and number."""
    text = clean(text)
    codes, sections, dept, pos = [], [], None, 0
    while True:
        match = TOKEN.match(text, pos)
        if not match:
            break
        sep, new_dept, num = match.group("sep"), match.group("dept"), match.group("num")
        if new_dept:
            if not num[0].isdigit():
                break
            dept = new_dept
            codes.append(f"{dept}{num}")
        elif not dept:
            break
        elif not num[0].isdigit() or num[0] == "0" or sep in ("-", "–"):
            sections.append(num)
        else:
            codes.append(f"{dept}{num}")  # "461/592", "692 991": a second course
        pos = match.end()
    codes = [c for c in dict.fromkeys(codes) if re.match(r"[A-Z]+", c).group(0) in SUBJECTS]
    if not codes:
        return None
    title = clean(text[pos:]).lstrip(",-–:; ").strip()
    return codes, ", ".join(dict.fromkeys(sections)) or "N/A", title


def parse_name(text):
    """'Dr. Ronald Resmini' -> 'Resmini, Ronald'; 'A Berea' -> 'Berea, A'; 'Perry' -> 'Perry'."""
    text = TITLES.sub("", clean(text).strip("()"))
    if not text or not re.match(r"^[A-Za-zÀ-ÿ.'’\- ]+$", text):
        return None
    words = text.split()
    if len(words) == 1:
        return words[0]
    if len(words) > 4 or "," in text:
        return None
    return f"{words[-1]}, {' '.join(words[:-1])}"


def split_names(text):
    """'Smith/Jones', 'Smith & Jones' -> both; anything that doesn't look like names -> ['Staff']."""
    names = [parse_name(n) for n in re.split(r"\s*(?:/|&|;|\band\b)\s*", clean(text)) if clean(n)]
    names = [n for n in names if n]
    return names or ["Staff"]


def url_term(url):
    """The term a file name gives: 'geol-101-syllabus-spring-26', 'CLIM429_Syllabus_F2025_x.pdf',
    'fa21-neur-101-lewis', 'biol579_syllabus_S24.pdf'. None if it names no term."""
    name = unquote(urlsplit(url).path).rsplit("/", 1)[-1].lower()
    for match in re.finditer(r"(?<![a-z])(spring|summer|fall|spr|sum|sp|su|fa|f|s)[\s_-]?(20\d\d|\d\d)(?!\d)", name):
        year = int(match.group(2))
        year = year + 2000 if year < 100 else year
        if 2010 <= year <= 2035:
            return Term(SEASONS[match.group(1)], year)
    return None


def column_term(text):
    """'Fall 26', 'Spr 25' -> Term; None otherwise."""
    match = re.fullmatch(r"(spring|spr|sp|summer|sum|su|fall|fa)\.?\s*'?(\d{2}|\d{4})", clean(text), re.I)
    if not match:
        return None
    year = int(match.group(2))
    return Term(SEASONS[match.group(1).lower()], year + 2000 if year < 100 else year)


def is_file(href):
    parts = urlsplit(href)
    return "/media/" in parts.path or parts.path.lower().endswith(".pdf")


def heading_term(tag):
    """A short heading or bold line that is just a term, like 'Spring 2026'."""
    text = clean(tag.get_text(" "))
    return parse_term(text) if len(text) <= 30 else None


def _row_for_cells(cells):
    """(codes, section, title, instructors) from a table row's cells, or None."""
    texts = [clean(c.get_text(" ")) for c in cells]
    course = next((parse_course(t) for t in texts if parse_course(t)), None)
    if not course:
        return None
    codes, section, title = course
    first = next(i for i, t in enumerate(texts) if parse_course(t))
    rest = [t for t in texts[first + 1:] if t]
    if not title and rest:
        title = rest.pop(0).lstrip("-– ").strip()
    instructors = split_names(rest[-1]) if rest else ["Staff"]
    return codes, section, title, instructors


def _row_for_link(text):
    """(codes, section, title, instructors) from link text like 'NEUR 101 Intro (Guerriero, hybrid)'."""
    course = parse_course(text)
    if not course:
        return None
    codes, section, title = course
    instructors = ["Staff"]
    match = re.search(r"\(([^()]*)\)\s*$", title)
    if match:
        names = split_names(match.group(1).split(",")[0])
        if names != ["Staff"]:
            instructors = names
            title = title[:match.start()].strip()
    return codes, section, title, instructors


def parse_page(html, base):
    """Returns (page term, [Row], [term page URLs it links]) for one syllabi page."""
    soup = BeautifulSoup(html, "html.parser")
    title = soup.find("title")
    page_term = parse_term(title.get_text()) if title else None
    main = soup.find("main") or soup
    rows, links, heading = [], [], None
    for tag in main.find_all(["h2", "h3", "h4", "strong", "b", "a"]):
        if tag.name != "a":
            heading = heading_term(tag) or heading if tag.name in ("strong", "b") else heading_term(tag)
            continue
        href = urljoin(base, (tag.get("href") or "").strip())
        path = urlsplit(href).path
        if "course-syllabi" in path and not is_file(href) and urlsplit(href).netloc == "science.gmu.edu":
            links.append(href.split("#")[0].split("?")[0].rstrip("/"))
            continue
        if not is_file(href) or not href.startswith("http"):
            continue
        tr = tag.find_parent("tr")
        cells = tr.find_all(["td", "th"]) if tr else []
        parsed = (_row_for_cells(cells) if len(cells) >= 2 else None) or _row_for_link(tag.get_text(" "))
        if not parsed:
            item = tag.find_parent("li")
            parsed = _row_for_link(item.get_text(" ")) if item else None
        if not parsed:
            continue
        codes, section, course_title, instructors = parsed
        term = page_term or heading or url_term(href) or _column_term(tag, tr)
        if not term:
            continue
        if cells and _column_term(tag, tr):  # grid: one link per term, instructor not given
            instructors = ["Staff"]
        rows.append(Row(codes=codes, section=section, title=course_title, instructors=instructors,
                        href=href, term=term, source="gmu-cos"))
    return page_term, rows, list(dict.fromkeys(links))


def _column_term(link, tr):
    """For a grid of courses by term: the term in the header of the link's column."""
    if tr is None:
        return None
    cell = link.find_parent(["td", "th"])
    table = tr.find_parent("table")
    header = table.find("tr") if table else None
    if cell is None or header is None or header is tr:
        return None
    index = tr.find_all(["td", "th"]).index(cell)
    heads = header.find_all(["td", "th"])
    return column_term(heads[index].get_text(" ")) if index < len(heads) else None


def department_rows(fetcher, name, starts, since):
    """Rows from a department's syllabi pages and the term pages they link."""
    queue, seen, found = [SITE + path for path in starts], set(), 0
    prefix = urlsplit(SITE + starts[0]).path.split("/")[3]
    while queue:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        res = fetcher.get(url)
        if not res:
            log.info("%s: couldn't read %s", name, url)
            continue
        page_term, rows, links = parse_page(res.content.decode("utf-8", errors="replace"), url)
        if page_term and page_term.key < since.key:
            continue
        for link in links:
            if urlsplit(link).path.split("/")[3:4] == [prefix]:
                queue.append(link)
        for row in rows:
            if row.term.key >= since.key:
                found += 1
                yield Listed(row, None)
    log.info("%s: %d syllabi on %d pages", name, found, len(seen))


def rows(fetcher, since):
    """Every syllabus the College of Science departments list; listings.choose drops repeats."""
    for name, starts in DEPARTMENTS.items():
        yield from department_rows(fetcher, name, starts, since)
