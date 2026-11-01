"""Finds a professor's full name in their syllabus text.

The CS listings only give "Zhu, Z" or a bare "Gonzalez", so a student searching
"Ziwei" or "David" finds nothing. Syllabi usually spell the name out near the top
("Prof. David I. Gonzalez Samudio"), so we look for the listed surname there and
read the capitalized words around it.
"""

import re
import unicodedata

# Instructor details are near the top of a syllabus.
WINDOW = 6000

# Capitalized words that sit next to names in syllabi but aren't part of them.
STOP = {
    "prof", "professor", "dr", "doctor", "instructor", "instructors", "lecturer", "name", "email", "e-mail",
    "office", "hours", "phone", "contact", "teaching", "assistant", "assistants", "ta", "tas", "the", "and",
    "or", "of", "for", "with", "by", "to", "in", "on", "at", "course", "class", "section", "hall", "building",
    "room", "engineering", "research", "buchanan", "horizon", "fairfax", "arlington", "campus", "george",
    "mason", "university", "department", "computer", "science", "monday", "tuesday", "wednesday", "thursday",
    "friday", "saturday", "sunday", "mr", "ms", "mrs", "fall", "spring", "summer", "syllabus", "zoom", "online",
    "lab", "labs", "lecture", "via", "appointment", "location", "information", "web", "website", "page",
    "contents", "time", "times", "end", "start", "table", "schedule", "overview", "description", "meeting",
    "meetings", "days", "day", "date", "dates", "office-hours", "welcome", "about", "me", "is", "am",
}

NAME_CHARS = "A-Za-zÀ-ÖØ-öø-ÿ'’\\-"
LETTER = "A-Za-zÀ-ÖØ-öø-ÿ"


def plain(text):
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn").lower()


def fold(text):
    """Strips accents one character at a time, so positions in the result match `text`."""
    return "".join((plain(c) or c)[0] if c.strip() else c for c in text)


def is_name_word(word):
    """'David', 'I.', 'Sara-Lynn' yes; 'ENGR', 'Office', 'email' no."""
    bare = word.rstrip(".")
    if not bare or not bare[0].isupper() or plain(bare) in STOP:
        return False
    if len(bare) == 1:
        return True
    rest = re.sub(r"['’\-]", "", bare[1:])
    return rest.islower() or ("-" in bare and not bare.isupper())


def is_initial(word):
    return len(word.rstrip(".")) == 1


def split_listed(listed):
    """'Zhu, Z' -> ('Zhu', 'Z'); 'Gonzalez' -> ('Gonzalez', '')."""
    last, _, first = listed.partition(",")
    return last.strip(), first.strip()


def needs_full_name(listed):
    """True for names with no first name or only an initial."""
    last, first = split_listed(listed)
    return bool(last) and len(first.rstrip(".")) <= 1 and plain(last) not in {"all instructors", "all professors", "staff", "tba", "all"}


def _cut_email(token, first):
    """'Samudiodgonza10' (a name glued to its email by PDF extraction) -> 'Samudio'.
    GMU emails start with the first initial, so cut where the lowercase run restarts with it."""
    initial = plain(first[0])
    for i in range(len(token) - 1, 1, -1):
        if token[i] == initial and token[1:i].islower():
            return token[:i]
    return None


def _words_before(text, limit=3):
    """The run of name-like words directly before the end of `text`, nearest last."""
    words = []
    rest = text
    while len(words) < limit:
        match = re.search(rf"([{LETTER}][{NAME_CHARS}]*\.?)\s*$", rest)
        if not match or not is_name_word(match.group(1)):
            break
        words.insert(0, match.group(1))
        rest = rest[: match.start()]
    return words


def _second_surname(after, first):
    """A second surname right after the listed one ("Gonzalez Samudio"), or None."""
    match = re.match(rf"\s([{LETTER}][{NAME_CHARS}]*)(\S*)", after)
    if not match:
        return None
    token, tail = match.groups()
    if tail and re.search(r"[\d@]", tail):  # glued to an email address
        token = _cut_email(token + re.match(r"[a-z]*", tail).group(0), first)
    elif tail and tail not in {",", ";", ":"}:
        return None
    if token and is_name_word(token) and not is_initial(token) and len(token) > 2:
        return token
    return None


def full_name(listed, text):
    """Returns "Last, First" for a listed name like "Zhu, Z" or "Gonzalez", or None if the
    syllabus doesn't spell it out."""
    last, initial = split_listed(listed)
    if not last:
        return None
    window = text[:WINDOW]
    pattern = r"[\s\-]+".join(re.escape(fold(part)) for part in re.split(r"[\s\-]+", last))
    best = None

    # Match on an accent-free copy so "Gonzalez" finds "González", then read the original.
    for match in re.finditer(rf"(?<![{LETTER}])({pattern})(?![a-z])", fold(window), re.I):
        found = window[match.start(1): match.end(1)]
        if not found[0].isupper():
            continue
        before = _words_before(window[: match.start()])
        given = [w.rstrip(".") for w in before if not is_initial(w)]
        if not given:
            continue
        first = given[0]
        if initial and plain(first[0]) != plain(initial[0]):
            continue

        surname = found
        # Only a bare listing ("Gonzalez") can pick up a second surname; with an initial,
        # the listing already has the whole surname.
        if not initial and " " not in last:
            extra = _second_surname(window[match.end():], first)
            if extra:
                surname = f"{surname} {extra}"

        start = match.start() - sum(len(w) + 1 for w in before)
        titled = re.search(r"(prof\.?|professor|dr\.?|instructor:?|lecturer:?)\s*$", window[max(0, start - 20): start], re.I)
        candidate = (1 if titled else 0, -match.start(), f"{surname}, {first}")
        if best is None or candidate > best:
            best = candidate

    return best[2] if best else None
