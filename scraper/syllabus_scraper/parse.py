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
