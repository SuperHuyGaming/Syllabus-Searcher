"""Parses the GMU CS department syllabus page.

The page has an <h2 class="title"> like "Spring 2022 Syllabi" and a
<table class="syllabus-table"> with columns Number | Section(s) | Name | Instructor,
where the Number cell links to the syllabus file under /media/syllabi/<Term>/.
"""

import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup

SEASONS = ["Spring", "Summer", "Fall"]


@dataclass(frozen=True)
class Term:
    season: str
    year: int

    @property
    def key(self):
        # Matches api/src/lib/terms.js: newest terms sort last as plain strings.
        return f"{self.year}-{SEASONS.index(self.season) + 1}"

    @property
    def label(self):
        return f"{self.season} {self.year}"


@dataclass
class Row:
    codes: list
    section: str
    title: str
    instructors: list
    href: str
    term: Term = field(default=None)
    # "gmu-cs" rows come from a listing page; "gmu-cs-filename" rows were guessed from a file name.
    source: str = "gmu-cs"


def parse_term(text):
    match = re.search(r"\b(spring|summer|fall)\s*(\d{4})\b", text or "", re.I)
    if not match:
        return None
    return Term(match.group(1).capitalize(), int(match.group(2)))


def parse_codes(text):
    """'CS 310' -> ['CS310'], 'CS 499/ 695' -> ['CS499', 'CS695'], 'CS/SWE-795' -> ['CS795', 'SWE795']."""
    upper = (text or "").upper()
    depts = re.findall(r"[A-Z]{2,4}", upper)
    numbers = re.findall(r"\d{3}", upper)
    if not depts or not numbers:
        return []
    if len(depts) == 1:
        return [f"{depts[0]}{n}" for n in numbers]
    return [f"{d}{numbers[0]}" for d in depts]


def parse_instructors(text):
    """'Zaman, A' is one person (last, first initial).
    'Kamberi, Otten,' (trailing comma) is a list of last names."""
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        return ["Staff"]
    if not text.endswith(","):
        return [text]
    names = [name.strip() for name in text.split(",") if name.strip()]
    if names == ["All"]:
        return ["All instructors"]
    return names or ["Staff"]


FILE_COURSE = re.compile(
    r"^(?:(?P<dept>[A-Z]{2,4})[ _]?)?(?P<num>\d{3})(?:/\d{3}|_[A-Z]{2,4}_\d{3})?(?P<rest>.*)$"
)
FILE_REST = re.compile(r"^(?P<names>[A-Za-z'_.-]*?)(?P<section>(?:\d{3}|DL\d|H\d{2}).*|All_Sections|All|ALL)?$")


def _file_instructors(names):
    # "ShamseddineMCS-555-004": drop the repeated "CS-" before the course number.
    names = re.sub(r"(?:CS|SWE|ISA|IT|INFS)-$", "", names).strip("_-. ")
    if not names:
        return ["Staff"]
    if names.lower() == "all":
        return ["All instructors"]
    parts = [p for p in names.split("_") if p]
    # "ZamanA" / "Gonzalez_HernandezA": one person, surname then first initial.
    single = re.match(r"^(.*[a-z])([A-Z]{1,2})$", parts[-1])
    if single:
        surname = " ".join(parts[:-1] + [single.group(1)])
        return [f"{surname}, {single.group(2)}"]
    # "Gopalkrishna_Kamberi_Zaman": several surnames.
    return parts


def _file_section(section, course_number):
    if not section:
        return "N/A"
    if section.lower().startswith("all"):
        return "All"
    tokens = [t for t in re.findall(r"\d{3}|DL\d|H\d{2}", section) if t != course_number]
    return ", ".join(dict.fromkeys(tokens)) or "N/A"


def parse_filename(path, term):
    """Guesses a Row from an archived file name when no listing page survived.
    '/media/syllabi/Spring2023/CS_321PettitR002_006.pdf' -> CS321, 'Pettit, R', '002, 006'.
    The course title isn't in the file name, so it's left empty for the caller to fill."""
    name = path.split(f"{term.season}{term.year}/", 1)[-1]
    stem = re.sub(r"\.(pdf|html?)$", "", name, flags=re.I)
    course = FILE_COURSE.match(stem)
    if not course:
        return None
    dept = course.group("dept") or "CS"
    rest = FILE_REST.match(course.group("rest").lstrip("_ "))
    names, section = (rest.group("names"), rest.group("section")) if rest else ("", course.group("rest"))
    return Row(
        codes=[f"{dept}{course.group('num')}"],
        section=_file_section(section, course.group("num")),
        title="",
        instructors=_file_instructors(names),
        href=path,
        term=term,
        source="gmu-cs-filename",
    )


def terms_between(first, last):
    """Every term from first to last, oldest first."""
    terms, season, year = [], SEASONS.index(first.season), first.year
    while (year, season) <= (last.year, SEASONS.index(last.season)):
        terms.append(Term(SEASONS[season], year))
        season = (season + 1) % 3
        year += season == 0
    return terms


def current_term(today):
    return Term("Spring" if today.month <= 5 else "Summer" if today.month <= 8 else "Fall", today.year)


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def parse_index(html):
    """Returns (Term or None, [Row]) for one syllabus listing page."""
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.select_one("h2.title") or soup.find("h2")
    term = parse_term(heading.get_text() if heading else "")

    rows = []
    table = soup.select_one("table.syllabus-table")
    if not table:
        return term, rows

    for tr in table.find_all("tr"):
        cells = tr.find_all("td")
        link = tr.find("a", href=True)
        if len(cells) < 4 or not link:
            continue
        number, section, title, instructor = cells[-4:]
        codes = parse_codes(number.get_text())
        if not codes:
            continue
        rows.append(
            Row(
                codes=codes,
                section=clean(section.get_text()) or "N/A",
                title=clean(title.get_text()),
                instructors=parse_instructors(instructor.get_text()),
                href=link["href"].strip(),
                term=term,
            )
        )
    return term, rows
