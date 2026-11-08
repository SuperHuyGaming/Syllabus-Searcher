"""Reads every department and course in a school's official catalog, so the site lists
every course, not only the ones with a syllabus on file.

The schools in syllabus_scraper/schools.py all publish their catalog with CourseLeaf,
which lays pages out in one of three ways:
  - GMU:          <span class="cb_code">CS 310</span> <span class="cb_title">Data Structures</span>,
                  credits in .courseblocktitle, description in .courseblockdesc
  - UNC, ODU:     <span class="detail-code">COMP 110.</span> <span class="detail-title">...</span>,
                  credits in .detail-hours, description in .courseblockextra
  - Georgia Tech: <p class="courseblocktitle"><strong>CS 1301. Intro to Computing. 3 Credit Hours.</strong>
"""

import html
import re
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

INDEX_URL = "https://catalog.gmu.edu/courses/"

# "CS 310", "COMP 110.", "CS 1301R"
COURSE_CODE = r"([A-Z]{2,5})\W*(\d{3,4}[A-Z]?)"
CREDITS = r"([\d.]+(?:\s*-\s*[\d.]+)?)\s+(?:credits?|credit hours?)"


def _text(node):
    """Plain text of a catalog snippet, with a grade marker ("CS 108<sup>C</sup>") read as "CS 108 (C)"."""
    for sup in node.find_all("sup"):
        sup.replace_with(f" ({sup.get_text(strip=True)})")
    text = html.unescape(node.get_text(" "))
    text = re.sub(r"\s+", " ", text.replace("\xa0", " ").replace("​", "")).strip()
    return re.sub(r"\s+([,.;:)])", r"\1", text)


def _clean_prereqs(text):
    """Drops the grade legend ("(C) Requires minimum grade of C.") and parentheses around the whole thing."""
    text = re.sub(r"\s*\(\w+\) Requires minimum grade of \w+\.", "", text).strip().rstrip(".")
    while text.startswith("(") and text.endswith(")"):
        depth = 0
        for i, ch in enumerate(text):
            depth += {"(": 1, ")": -1}.get(ch, 0)
            if depth == 0 and i < len(text) - 1:
                return text  # the first "(" closes early, so it doesn't wrap everything
        text = text[1:-1].strip()
    return text


def parse_departments(page, prefix="/courses/"):
    """Returns one dict per subject on the catalog's A-Z page: code ("CS"), name, slug ("cs").
    Links read "Computer Science (CS)" (GMU, Georgia Tech, UNC) or "CS - Computer Science" (ODU).
    `prefix` is the path the department pages live under ("/courses/", "/coursesaz/")."""
    soup = BeautifulSoup(page, "html.parser")
    links = soup.select(f"#atozindex a[href^='{prefix}']") or soup.select(f"a[href^='{prefix}']")
    departments = {}
    for link in links:
        slug = link["href"][len(prefix):].strip("/")
        if not slug or "/" in slug:
            continue
        text = re.sub(r"\s+", " ", html.unescape(link.get_text()).replace("​", "").replace("\xa0", " ")).strip()
        match = re.match(r"(?P<name>.+?)\s*\((?P<code>[A-Z]{2,5})\)$", text) or re.match(
            r"(?P<code>[A-Z]{2,5})\s+[-–]\s+(?P<name>.+)$", text
        )
        if match and match.group("code") not in departments:
            code = match.group("code")
            departments[code] = {"code": code, "name": _readable_name(match.group("name").strip()), "slug": slug}
    return list(departments.values())


SMALL_WORDS = {"and", "of", "in", "the", "for", "to", "a", "an", "on", "at", "or"}


def _readable_name(name):
    """UNC writes department names in capitals ("COMPUTER SCIENCE"); the site shows
    them like everyone else's ("Computer Science"). Names in mixed case stay as they are."""
    if not name.isupper():
        return name
    words = name.lower().split(" ")
    return " ".join(w if i and w in SMALL_WORDS else _capitalize(w) for i, w in enumerate(words))


def _capitalize(word):
    """Capitalizes each part of a hyphenated word: african-american -> African-American."""
    return "-".join(part[:1].upper() + part[1:] for part in word.split("-"))


def _heading(block, dept):
    """(number, title, heading text) from a course block in any of the three layouts, or None."""
    code_node = block.select_one(".cb_code, .detail-code, .detail-xrefcode")
    title_node = block.select_one(".cb_title, .detail-title")
    heading_node = block.select_one(".courseblocktitle")
    heading = _text(heading_node) if heading_node else ""
    if code_node and title_node:
        match = re.match(COURSE_CODE, _text(code_node))
        hours = block.select_one(".detail-hours, .detail-hours_html")
        title = _text(title_node).rstrip(".")
        return (match, title, heading or (_text(hours) if hours else "")) if match else None
    if heading:  # Georgia Tech: "CS 1301. Introduction to Computing. 3 Credit Hours."
        match = re.match(COURSE_CODE + r"\.?\s+(.+?)\.?\s+" + CREDITS, heading, re.IGNORECASE)
        if match:
            return match, match.group(3).strip(), heading
    return None


def parse_catalog(page, dept="CS"):
    """Returns one dict per course: code ("CS310"), title, credits ("3"), description, prereqs.
    Codes are bare here; the store adds the school ("unc:COMP110")."""
    soup = BeautifulSoup(page, "html.parser")
    courses, seen = [], set()
    for block in soup.select("div.courseblock"):
        found = _heading(block, dept)
        if not found:
            continue
        match, title, heading = found
        code = f"{match.group(1)}{match.group(2)}"
        if match.group(1) != dept or code in seen:
            continue
        seen.add(code)
        credits = re.search(CREDITS, heading, re.IGNORECASE)

        desc_node = block.select_one(".courseblockdesc, .courseblockextra")
        description = _text(desc_node) if desc_node else ""
        description = re.split(r"\s+Offered by\b", description)[0].strip()

        prereq_node = block.select_one("p.prereq")
        prereqs = ""
        if prereq_node:
            prereqs = _clean_prereqs(re.sub(r"^Required Prerequisites:\s*", "", _text(prereq_node)))

        courses.append(
            {
                "code": code,
                "title": title,
                "credits": re.sub(r"\s+", "", credits.group(1)) if credits else "",
                "description": description,
                "prereqs": prereqs,
            }
        )
    return courses


def fetch_departments(fetcher, index_url=INDEX_URL):
    """Every subject in a catalog; [] if the A-Z page can't be reached."""
    res = fetcher.get(index_url)
    return parse_departments(res.text, urlsplit(index_url).path) if res else []


def fetch_catalog(fetcher, dept="CS", slug=None, index_url=INDEX_URL):
    """Downloads and parses the catalog page for one department; [] if it can't be reached."""
    res = fetcher.get(urljoin(index_url, f"{slug or dept.lower()}/"))
    return parse_catalog(res.text, dept) if res else []
