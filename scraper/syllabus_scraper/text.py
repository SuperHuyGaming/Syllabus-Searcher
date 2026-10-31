"""Pulls plain text out of syllabus files so they can be searched."""

import io
import logging
import re

from bs4 import BeautifulSoup
from pypdf import PdfReader

# Enough for any real syllabus; keeps each search document small.
MAX_CHARS = 60_000

log = logging.getLogger("scraper")


def extract_text(data, content_type):
    try:
        if content_type.startswith("application/pdf"):
            reader = PdfReader(io.BytesIO(data))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        else:
            soup = BeautifulSoup(data, "html.parser")
            for tag in soup(["script", "style"]):
                tag.decompose()
            text = soup.get_text(" ")
    except Exception as err:  # broken or encrypted files shouldn't stop the scrape
        log.warning("Couldn't read text: %s", err)
        return ""
    return re.sub(r"\s+", " ", text).strip()[:MAX_CHARS]
