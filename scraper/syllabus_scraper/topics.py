"""Detection and per-offering topic extraction for special-topics courses
(e.g. CS 399, CS 499, SWE 699, HIST 388).

Special-topics courses reuse one course code for different subjects each term,
so every offering is kept and tagged with its specific `topic`.
"""

import io
import logging
import re

from bs4 import BeautifulSoup
from pypdf import PdfReader

log = logging.getLogger("scraper")

SPECIAL_TOPICS_TITLE_RE = re.compile(
    r"\b(?:special topics|selected topics|topics in|topics\s*:)",
    re.I,
)

# Leading course code prefix such as "CS 399:", "CS 499/695 -", "SWE 699-001 |"
_LEADING_CODE_RE = re.compile(
    r"^(?:[A-Z]{2,5}\s*\d{3,4}[A-Z]?(?:\s*[/&,]\s*(?:[A-Z]{2,5}\s*)?\d{3,4}[A-Z]?)*)"
    r"(?:\s*[-–—]\s*(?:0?\d{2,3}|DL\d|H\d{2}|ALL))?"
    r"(?:\s*\((?:0?\d{2,3}|DL\d|H\d{2}|ALL)\))?"
    r"\s*[:\-–—|]*\s*",
    re.I,
)

# Generic special-topics prefix followed by a separator (colon/dash/pipe).
_GENERIC_PREFIX_SEP_RE = re.compile(
    r"^(?:(?:special|selected)\s+topics(?:\s+in\s+[^:–—\-|]{1,60})?|"
    r"topics(?:\s+in\s+[^:–—\-|]{1,60})?|"
    r"(?:course\s+)?topic|"
    r"(?:course\s+)?title)\s*[:\-–—|]\s*",
    re.I,
)

# "Special Topics in <Actual Subject>" without a colon (only used after verifying it differs from catalog title).
_GENERIC_PREFIX_IN_RE = re.compile(
    r"^(?:special|selected)\s+topics\s+in\s+",
    re.I,
)

# Trailing term, credits, section or "Syllabus" suffix.
_TRAILING_NOISE_RE = re.compile(
    r"\s*(?:[-–—|,]\s*)?(?:"
    r"\(?(?:spring|summer|fall|winter)\s+\d{4}\)?|"
    r"\(?\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*credits?\)?|"
    r"\(?section\s+[A-Z0-9]+\)?|"
    r"(?:course\s+)?syllabus"
    r")\s*$",
    re.I,
)

# Lines that are never a course topic heading.
_BOILERPLATE_LINE_RE = re.compile(
    r"^(?:"
    r"%pdf-.*|"
    r"(?:course\s+)?syllabus\b.*|"
    r"tentative\s+syllabus\b.*|"
    r"course\s+(?:outline|information|overview|schedule|policies)\b.*|"
    r"george\s+mason\s+university\b.*|"
    r"university\s+of\b.*|"
    r".*\buniversity\s*$|"
    r"(?:department|school|college|faculty|division)\s+of\b.*|"
    r"volgenau\s+school\b.*|"
    r"fairfax\s*,\s*va\b.*|"
    r"(?:spring|summer|fall|winter)\s+\d{4}\b.*|"
    r"page\s+\d+(?:\s+of\s+\d+)?\s*$|"
    r"section\s+[A-Z0-9-]+\s*$|"
    r"\d+(?:\.\d+)?\s*(?:credits?|credit\s+hours?)\s*$|"
    r"(?:tbd|tba|n/?a|none)\s*$"
    r")",
    re.I,
)

# Metadata key-value lines to skip when scanning syllabus text.
_METADATA_LABEL_RE = re.compile(
    r"^(?:instructor|professor|prof\.?|lecturer|faculty|ta|teaching\s+assistant|"
    r"e-?mail|office|office\s+hours|location|room|building|classroom|"
    r"class\s+time|meeting|meetings|schedule|time|days|dates|"
    r"pre-?requisites?|prereqs?|co-?requisites?|textbooks?|required\s+texts?|"
    r"grading|grade|course\s+description|description|overview|objectives|"
    r"learning\s+outcomes|credits?|semester|term|crn|section|website|url|"
    r"phone|zoom|blackboard|canvas|piazza|gradescope|catalog\s+description|"
    r"delivery\s+mode|modality|format|attendance|honor\s+code)\s*:",
    re.I,
)

# Explicit topic label in text (multiline or single-line).
_EXPLICIT_TOPIC_RE = re.compile(
    r"(?:^|\b)(?:(?:course\s+)?topic|(?:special|selected)\s+topics(?:\s+in\s+[A-Za-z &]{2,50})?)\s*[:\-–—]\s*"
    r"([^\r\n;.!?]{3,110})",
    re.I,
)

# Stop markers when trimming a single-line match.
_INLINE_STOP_RE = re.compile(
    r"\s+(?:instructor|professor|prof\.|office\s+hours|george\s+mason|department\s+of|"
    r"school\s+of|college\s+of|section\s+\d|crn\b|credits?\b|syllabus\b|"
    r"(?:spring|summer|fall|winter)\s+\d{4}\b)",
    re.I,
)

_GENERIC_ONLY_RE = re.compile(
    r"^(?:(?:(?:special|selected)\s+)?topics(?:\s+in\s+(?:computer\s+science|mathematics|history|"
    r"engineering|software\s+engineering|information\s+technology|biology|chemistry|physics|"
    r"economics|psychology|sociology|english|philosophy|statistics|data\s+analytics))?|"
    r"course\s+syllabus|syllabus|tbd|tba|n/?a|none)$",
    re.I,
)

_PROSE_START_RE = re.compile(
    r"^(?:this\s+course|students\s+will|welcome\s+to|in\s+this\s+course|the\s+purpose\s+of|"
    r"upon\s+completion|by\s+the\s+end\s+of)",
    re.I,
)

MAX_TOPIC_LEN = 120
MIN_TOPIC_LEN = 3


def is_special_topics_course(title, description="", notes=""):
    """True if a catalog course is a special-topics course.

    Matches when:
      - `title` matches /special topics|selected topics|topics in|topics:/i, OR
      - `description`/`notes` mention both 'may be repeated' and 'topic' (case-insensitive).
    """
    if title and SPECIAL_TOPICS_TITLE_RE.search(title):
        return True
    combined = f"{description or ''} {notes or ''}".lower()
    return "may be repeated" in combined and "topic" in combined


def _norm(text):
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _strip_trailing_noise(text):
    prev = None
    while prev != text:
        prev = text
        text = _TRAILING_NOISE_RE.sub("", text).strip(" .;:,-–—|/")
    return text


def clean_topic(candidate, catalog_title="", codes=None):
    """Normalizes a candidate topic string and strips course codes / generic prefixes.
    Returns '' if the candidate is empty, generic, or matches the catalog title."""
    text = re.sub(r"\s+", " ", (candidate or "").replace("\ufffd", "'")).strip(" \t\"'.;:,-–—|/")
    if not text:
        return ""

    # Strip leading course codes (e.g. "CS 399 - ", "SWE 699:").
    text = _LEADING_CODE_RE.sub("", text).strip(" \"'.;:,-–—|/")
    text = _strip_trailing_noise(text)
    if not text:
        return ""

    norm_catalog = _norm(catalog_title)
    norm_text = _norm(text)

    # Identical to catalog title -> not a distinct per-offering topic.
    if norm_catalog and norm_text == norm_catalog:
        return ""

    # If the candidate starts with the catalog title followed by a separator, strip it.
    if catalog_title:
        cat_clean = re.escape(catalog_title.strip(" .:"))
        stripped = re.sub(rf"^{cat_clean}\s*[:\-–—|]\s*", "", text, flags=re.I).strip()
        if stripped != text:
            text = stripped

    # Strip generic prefixes like "Special Topics:", "Special Topics in CS:", "Topic:".
    after_sep = _GENERIC_PREFIX_SEP_RE.sub("", text).strip(" \"'.;:,-–—|/")
    if after_sep != text:
        text = after_sep
    elif _GENERIC_ONLY_RE.match(text):
        return ""
    elif _GENERIC_PREFIX_IN_RE.match(text):
        # e.g. "Special Topics in Quantum Computing" (when catalog title is "Special Topics in CS")
        after_in = _GENERIC_PREFIX_IN_RE.sub("", text).strip(" \"'.;:,-–—|/")
        if after_in and (not norm_catalog or _norm(after_in) != norm_catalog):
            text = after_in

    text = _strip_trailing_noise(text).strip(" \"'.;:,-–—|/")
    if not text:
        return ""

    if len(text) < MIN_TOPIC_LEN or len(text) > MAX_TOPIC_LEN:
        return ""
    if norm_catalog and _norm(text) == norm_catalog:
        return ""
    if _GENERIC_ONLY_RE.match(text):
        return ""
    if _BOILERPLATE_LINE_RE.match(text):
        return ""
    # Reject bare course codes (e.g. "CS 399") or all-digit strings.
    if re.fullmatch(r"[A-Z]{2,5}\s*\d{3,4}[A-Z]?", text, re.I) or re.fullmatch(r"[\d\W]+", text):
        return ""
    # Reject if it's purely one of the course's own codes.
    if codes and _norm(text) in {_norm(c) for c in codes}:
        return ""
    return text


def extract_topic_from_listing(row_title, catalog_title="", codes=None):
    """Extracts the offering topic from a listing row's title when it differs
    meaningfully from the catalog title."""
    if not row_title:
        return ""
    return clean_topic(row_title, catalog_title=catalog_title, codes=codes)


def _looks_like_heading(line):
    """True if a syllabus line is a plausible topic heading (not boilerplate, metadata, or prose)."""
    line = re.sub(r"\s+", " ", line).strip()
    if len(line) < MIN_TOPIC_LEN or len(line) > 140:
        return False
    if "@" in line or "http://" in line.lower() or "https://" in line.lower() or "www." in line.lower():
        return False
    if _METADATA_LABEL_RE.match(line):
        return False
    if _BOILERPLATE_LINE_RE.match(line):
        return False
    if _PROSE_START_RE.match(line):
        return False
    # Long sentences ending in a period are body prose, not a title heading.
    if line.endswith(".") and len(line.split()) > 10:
        return False
    # Must contain at least one letter.
    if not re.search(r"[A-Za-z]{2,}", line):
        return False
    return True


def extract_topic_from_text(text, codes=None, catalog_title=""):
    """Extracts the offering topic from the first strong heading/title line of
    extracted syllabus text, skipping boilerplate headers."""
    if not text or not text.strip():
        return ""

    if "\n" in text:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        for line in lines[:35]:
            if not _looks_like_heading(line):
                continue
            topic = clean_topic(line, catalog_title=catalog_title, codes=codes)
            if topic:
                return topic
        return ""

    # Single-line (already whitespace-collapsed) text fallback: look for explicit topic markers.
    head = text[:600]
    match = _EXPLICIT_TOPIC_RE.search(head)
    if match:
        raw = _INLINE_STOP_RE.split(match.group(1), maxsplit=1)[0]
        topic = clean_topic(raw, catalog_title=catalog_title, codes=codes)
        if topic:
            return topic
    return ""


def extract_raw_text(data, content_type, max_pages=2):
    """Extracts text from the start of a PDF or HTML file while preserving line breaks
    for heading detection. Returns '' on failure."""
    if not data or not content_type:
        return ""
    try:
        if content_type.startswith("application/pdf"):
            reader = PdfReader(io.BytesIO(data))
            return "\n".join((page.extract_text() or "") for page in reader.pages[:max_pages])
        if content_type.startswith("text/html"):
            soup = BeautifulSoup(data, "html.parser")
            for tag in soup(["script", "style", "nav", "footer"]):
                tag.decompose()
            return soup.get_text("\n")
    except Exception as err:
        log.debug("Couldn't extract raw lines for topic detection: %s", err)
    return ""


def determine_topic(row_title="", catalog_title="", text="", codes=None):
    """Determines a per-offering topic: listing title first, then syllabus text."""
    topic = extract_topic_from_listing(row_title, catalog_title=catalog_title, codes=codes)
    if topic:
        return topic
    return extract_topic_from_text(text, codes=codes, catalog_title=catalog_title)
