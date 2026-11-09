"""A summary of a syllabus picked out of its text by simple rules, no AI.

Gives the same fields as the AI summary (api/src/lib/ai.js, shown by the course page):
grading breakdown, textbooks, tools, prerequisites, and the late work, attendance and
AI-use policies. Used for the thousands of syllabi from new sources, which free AI tiers
would take weeks to get through; it is free and instant. An admin can still press
"Regenerate" on /admin for an AI summary of any one file.
"""

import re

PROVIDER = "rules"

# What a grading line can be about. Keeps "Homework 20%" and drops "a 5% late penalty".
GRADED = re.compile(
    r"homework|hw\b|quiz|exam|midterm|mid-term|final|test|project|participation|attendance|lab|"
    r"assignment|paper|presentation|webwork|webassign|mymathlab|aleks|recitation|worksheet|discussion|"
    r"report|essay|portfolio|in-class|class work|classwork|problem set|journal|reading|writing|activities|"
    r"activity|engagement|notebook|poster|proposal|response|reflection|module|exercise",
    re.I,
)
SKIP_ITEM = re.compile(r"late|penalt|deduct|extra credit|bonus|curve|drop|lowest|scale|letter|grade of|"
                       r"at least|minimum|above|below|more than|less than|up to|each day|per day", re.I)

ITEM = r"[A-Za-z][A-Za-z0-9/&,()'\- ]{1,48}?"
# "Homework: 20%", "Final Exam ..... 30 %", "Quizzes (best 8 of 10) 15%"
ITEM_FIRST = re.compile(rf"(?P<item>{ITEM})\s*[:=\-–—.…]*\s*\(?(?P<weight>\d{{1,3}}(?:\.\d+)?)\s*%")
# "20% Homework", "30 % - Final exam"
WEIGHT_FIRST = re.compile(rf"(?P<weight>\d{{1,3}}(?:\.\d+)?)\s*%\s*[:=\-–—]?\s*(?P<item>{ITEM})(?=\s*(?:\d|$|[;,.]))")

TOOLS = [
    ("MATLAB", r"matlab"), ("Python", r"python"), ("R", r"\bR (?:programming|language|software)|rstudio"),
    ("Mathematica", r"\bmathematica\b"), ("Maple", r"\bmaple\b"), ("SAS", r"\bSAS\b"), ("SPSS", r"\bspss\b"),
    ("Excel", r"\bexcel\b"), ("Desmos", r"desmos"), ("GeoGebra", r"geogebra"), ("LaTeX", r"\blatex\b"),
    ("Java", r"\bjava\b"), ("C++", r"c\+\+"), ("Julia", r"\bjulia\b"),
    ("WeBWorK", r"webwork"), ("WebAssign", r"webassign"), ("MyMathLab", r"mymathlab|my math lab"),
    ("MyLab Math", r"mylab math"), ("ALEKS", r"\baleks\b"), ("Gradescope", r"gradescope"),
    ("Canvas", r"\bcanvas\b"), ("Blackboard", r"blackboard"), ("Piazza", r"piazza"), ("Zoom", r"\bzoom\b"),
    ("Git", r"\bgit\b|github"), ("Overleaf", r"overleaf"), ("TI-84 calculator", r"ti-?8[34]"),
]

POLICY_WORDS = {
    "lateWork": re.compile(r"\blate (?:work|homework|assignments?|submissions?|penalt)|\bno late\b|"
                           r"\blate\b.{0,40}\b(?:accepted|penalt|deduct)", re.I),
    "attendance": re.compile(r"\battendance\b", re.I),
    "aiUse": re.compile(r"chatgpt|generative ai|artificial intelligence|\bai tools?\b|\bai-generated\b|\bgenai\b", re.I),
}

TEXTBOOK_LABEL = re.compile(
    r"(?:required |recommended |course )?(?:textbooks?|text ?books?|required texts?|course texts?|text)\s*"
    r"(?:\(s\))?\s*(?:\(required\)|\(optional\))?\s*:\s*",
    re.I,
)
PREREQ_LABEL = re.compile(r"(?:pre-?requisites?|prereqs?)(?:\s*\(s\))?\s*:\s*", re.I)
DESCRIPTION_LABEL = re.compile(r"course description\s*:?\s*", re.I)


def _clean(text, limit):
    # Curly quotes that a PDF font didn't map come out as U+FFFD.
    text = re.sub(r"\s+", " ", (text or "").replace("\ufffd", "'")).strip(" .;:,-–—")
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(" .;:,") + "…"


def _sentences(text):
    return re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)


# The next heading in flattened text: "Prerequisites:", "Exam 1:", "Grading Policy:", "Main Course Goal:",
# "Material Covered:", or a bullet (PDF bullets often come out as U+FFFD between spaces; a curly quote
# comes out as one too, but next to a word). The heading must end in a heading word, so a book title
# like "Thomas' Calculus: Early Transcendentals" isn't cut.
HEADING_END = (r"(?:Pre-?requisites?|Prereqs?|Co-?requisites?|Grading|Grades?|Topics?|Contents?|Goals?|Objectives?|"
               r"Outcomes?|Description|Covered|Policy|Policies|Materials?|Exams?|Homework|Instructors?|E-?mail|"
               r"Office|Hours|Schedule|Calendar|Website|Notes?|Software|Calculators?|Attendance|Requirements?|"
               r"Required|Textbooks?|Texts?|Readings?|Format|Assessments?|Evaluation|Location|Time|Recitations?|Labs?)")
HEADING_START = r"(?:Course|Grading|Main|Material|Office|Required|Recommended|Class|Final|Learning|Student|Important|Additional)"
NEXT_LABEL = re.compile(rf"\s(?:{HEADING_START}\s){{0,2}}{HEADING_END}\s*(?:\d+\s*)?(?:\(s\)\s*)?:\s|"
                        r"[\u2022\uf0b7]|\s\ufffd\s")


def _after(label, text, limit):
    """The text right after a label like "Prerequisites:", up to the end of that sentence or the next heading."""
    match = label.search(text)
    if not match:
        return ""
    rest = text[match.end():match.end() + limit * 2]
    sentence = re.split(r"(?<=[a-z0-9)])\.\s+(?=[A-Z])", rest, maxsplit=1)[0]
    heading = NEXT_LABEL.search(sentence, 3)
    return _clean(sentence[:heading.start()] if heading else sentence, limit)


def _item(text):
    """'SYLLABUS SUMMER2021 Homework' -> 'Homework'; 'Exams) Final Exam' -> 'Final Exam'; 'Each Final Exam' -> 'Final Exam'."""
    text = re.sub(r"\s+", " ", text).strip()
    if ")" in text and "(" not in text.split(")")[0]:
        text = text.rsplit(")", 1)[-1]
    text = re.sub(r"^(?:[A-Z0-9&/-]{2,}\s+)+(?=[A-Z]?[a-z])", "", text.strip())
    text = re.sub(r"^(?:(?:and|or|the|of|for|is|are|worth|counts?|each|your|plus)\s+)+", "", text, flags=re.I)
    words = text.split()
    return _clean(" ".join(words[-6:]), 80)


def _rows(text, pattern):
    found, seen = [], set()
    for match in pattern.finditer(text):
        weight = float(match.group("weight"))
        if not 0 < weight <= 100:
            continue
        item = _item(match.group("item"))
        if not item or not GRADED.search(item) or SKIP_ITEM.search(item) or item.lower() in seen:
            continue
        seen.add(item.lower())
        found.append({"item": item[0].upper() + item[1:], "weight": f"{match.group('weight')}%"})
    return found[:15]


def _grading(text):
    """The grading breakdown, read as "Homework 20%" or "20% Homework", whichever reads better:
    weights adding up to 100% first, then more rows. Fewer than two rows isn't a breakdown."""
    def score(rows):
        total = sum(float(row["weight"].rstrip("%")) for row in rows)
        return (abs(total - 100) <= 1, len(rows))

    best = max((_rows(text, pattern) for pattern in (ITEM_FIRST, WEIGHT_FIRST)), key=score)
    return best if len(best) >= 2 else []


def _policy(text, pattern):
    for sentence in _sentences(text):
        if pattern.search(sentence) and 20 <= len(sentence) <= 600:
            return _clean(sentence, 400)
    return ""


def summarize(text):
    """Returns a summary dict like the AI's, or None when the rules found nothing to show."""
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) < 200:
        return None
    lower = text.lower()
    summary = {
        "overview": _after(DESCRIPTION_LABEL, text, 600),
        "topics": [],
        "prerequisites": _after(PREREQ_LABEL, text, 400),
        "tools": [name for name, pattern in TOOLS if re.search(pattern, text if name in ("R", "SAS") else lower, 0 if name in ("R", "SAS") else re.I)][:12],
        "textbooks": [book] if (book := _after(TEXTBOOK_LABEL, text, 250)) else [],
        "grading": _grading(text),
        "workload": [],
        "policies": {field: _policy(text, pattern) for field, pattern in POLICY_WORDS.items()},
    }
    has_any = (summary["overview"] or summary["prerequisites"] or summary["tools"] or summary["textbooks"]
               or summary["grading"] or any(summary["policies"].values()))
    return summary if has_any else None
