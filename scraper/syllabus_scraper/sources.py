"""Where syllabus listing pages and files come from.

1. The live GMU CS site (cs.gmu.edu/syllabi/ shows the current term).
2. Internet Archive captures of that page, which recover past terms.
   The live pages started returning 404 in late 2025, so this is the main source for now.
"""

import time
from urllib.parse import unquote, urlsplit

import requests

SITE = "https://cs.gmu.edu"
INDEX_PATH = "/syllabi/"
CDX = "https://web.archive.org/cdx/search/cdx"
USER_AGENT = "GMU-Syllabus-Searcher/1.0 (student project; github.com/SuperHuyGaming)"


class Fetcher:
    def __init__(self, delay=1.0, session=None):
        self.delay = delay
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT

    def get(self, url, retries=3):
        """Returns a Response for a 200, None for anything else. Backs off on 429/5xx."""
        for attempt in range(retries):
            time.sleep(self.delay)
            try:
                res = self.session.get(url, timeout=30)
            except requests.RequestException:
                res = None
            if res is not None and res.status_code == 200:
                return res
            if res is not None and res.status_code not in (429, 500, 502, 503, 504):
                return None
            time.sleep(self.delay * 5 * (attempt + 1))
        return None


def wayback_url(timestamp, url):
    # "id_" returns the original bytes without the archive's toolbar.
    return f"https://web.archive.org/web/{timestamp}id_/{url}"


def archived_index_pages(fetcher, since_year):
    """Yields (timestamp, html) for one capture per month of the syllabus index."""
    params = {
        "url": f"cs.gmu.edu{INDEX_PATH}",
        "from": str(since_year),
        "output": "json",
        "fl": "timestamp",
        "filter": "statuscode:200",
        "collapse": "timestamp:6",
    }
    res = fetcher.get(requests.Request("GET", CDX, params=params).prepare().url)
    if not res:
        return
    rows = res.json()[1:]  # first row is the header
    for (timestamp,) in rows:
        page = fetcher.get(wayback_url(timestamp, f"{SITE}{INDEX_PATH}"))
        if page:
            yield timestamp, page.text


def archived_files(fetcher, term, retries=3):
    """Lists (timestamp, path) for every archived file in /media/syllabi/<Term>/.
    Used for terms whose listing page was never captured."""
    params = {
        "url": f"cs.gmu.edu/media/syllabi/{term.season}{term.year}/*",
        "output": "json",
        "fl": "timestamp,original",
        "filter": "statuscode:200",
        "collapse": "urlkey",
    }
    url = requests.Request("GET", CDX, params=params).prepare().url
    for attempt in range(retries):
        res = fetcher.get(url)
        try:
            rows = res.json()[1:] if res else []
            break
        except ValueError:
            # The archive sometimes answers with an HTML "try again later" page.
            time.sleep(fetcher.delay * 10 * (attempt + 1))
    else:
        return []
    return [(timestamp, unquote(urlsplit(original).path)) for timestamp, original in rows]


def live_index_page(fetcher, url=f"{SITE}{INDEX_PATH}"):
    res = fetcher.get(url)
    return res.text if res else None


def fetch_file(fetcher, href, timestamp=None):
    """Downloads a syllabus file from the live site, falling back to the archive.
    Returns (bytes, source_url) or (None, source_url)."""
    url = href if href.startswith("http") else f"{SITE}{href}"
    res = fetcher.get(url, retries=1)
    if res is None:
        res = fetcher.get(wayback_url(timestamp or "2", url))
    return (res.content if res else None), url
