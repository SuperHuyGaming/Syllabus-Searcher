"""Reads every course in GMU's official catalog (catalog.gmu.edu), so the site lists
all CS courses, not only the ones with a syllabus on file."""

import html
import re

from bs4 import BeautifulSoup

CATALOG_URL = "https://catalog.gmu.edu/courses/{dept}/"


def _text(node):
    """Plain text of a catalog snippet, with a grade marker ("CS 108<sup>C</sup>") read as "CS 108 (C)"."""
    for sup in node.find_all("sup"):
        sup.replace_with(f" ({sup.get_text(strip=True)})")
    text = html.unescape(node.get_text(" "))
    text = re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()
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


def parse_catalog(page, dept="CS"):
    """Returns one dict per course: code ("CS310"), title, credits ("3"), description, prereqs."""
    soup = BeautifulSoup(page, "html.parser")
    courses = []
    for block in soup.select("div.courseblock"):
        code_node = block.select_one(".cb_code")
        title_node = block.select_one(".cb_title")
        if not code_node or not title_node:
            continue
        match = re.match(rf"({dept})\W*(\d{{3}}[A-Z]?)", code_node.get_text().replace("\xa0", " "))
        if not match:
            continue

        heading = block.select_one(".courseblocktitle").get_text(" ").replace("\xa0", " ")
        credits = re.search(r"([\d.]+(?:\s*-\s*[\d.]+)?)\s+credits?", heading)

        desc_node = block.select_one(".courseblockdesc")
        description = _text(desc_node) if desc_node else ""
        description = re.split(r"\s+Offered by\b", description)[0].strip()

        prereq_node = block.select_one("p.prereq")
        prereqs = ""
        if prereq_node:
            prereqs = _clean_prereqs(re.sub(r"^Required Prerequisites:\s*", "", _text(prereq_node)))

        courses.append(
            {
                "code": f"{match.group(1)}{match.group(2)}",
                "title": title_node.get_text(" ", strip=True).replace("\xa0", " ").rstrip("."),
                "credits": re.sub(r"\s+", "", credits.group(1)) if credits else "",
                "description": description,
                "prereqs": prereqs,
            }
        )
    return courses


def fetch_catalog(fetcher, dept="CS"):
    """Downloads and parses the catalog page for one department; [] if it can't be reached."""
    res = fetcher.get(CATALOG_URL.format(dept=dept.lower()))
    return parse_catalog(res.text, dept) if res else []
