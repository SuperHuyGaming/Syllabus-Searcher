from datetime import date
from pathlib import Path

from syllabus_scraper import chss, listings
from syllabus_scraper.parse import Term

FIXTURES = Path(__file__).parent / "fixtures"
HIST_FALL2025 = (FIXTURES / "chss_hist_fall2025.html").read_text(encoding="utf-8")
MK_FALL2025 = (FIXTURES / "masonkorea_fall2025.html").read_text(encoding="utf-8")


def test_term_codes():
    assert chss.term_code(Term("Spring", 2026)) == "202610"
    assert chss.term_code(Term("Summer", 2026)) == "202640"
    assert chss.term_code(Term("Fall", 2026)) == "202670"
    assert chss.parse_term_code("201070") == Term("Fall", 2010)
    assert chss.parse_term_code("202510") == Term("Spring", 2025)
    assert chss.parse_term_code("202599") is None
    assert chss.parse_term_arg("202570") == Term("Fall", 2025)
    assert chss.parse_term_arg("Fall 2025") == Term("Fall", 2025)
    assert chss.term_from_url(
        "https://historyarthistory.gmu.edu/course_sections?code=HIST&term=202570"
    ) == Term("Fall", 2025)


def test_instructors():
    assert chss.parse_instructors("— David G. Armstrong — 10:30 AM to 11:45 AM MW - Krug Hall 242 -") == [
        "Armstrong, David G."
    ]
    assert chss.parse_instructors("— Meredith H. Lair - Online -") == ["Lair, Meredith H."]
    assert chss.parse_instructors("— Sun-Young Park — 03:00 PM to 04:15 PM TR - Krug Hall 7 -") == [
        "Park, Sun-Young"
    ]
    assert chss.parse_instructors("— Michael O'Malley — 01:30 PM to 04:10 PM R - Innovation Hall 338 -") == [
        "O'Malley, Michael"
    ]
    assert chss.parse_instructors(
        "— Jason Ham — William James Davis — 01:30 PM to 04:00 PM MTWR - 9900 Main Street -"
    ) == ["Ham, Jason", "Davis, William James"]
    assert chss.parse_instructors(
        "— 09:00 AM to 11:40 AM T - Mason Korea (119 Songdomunhwa-ro, Yeonsu-gu, Incheon, Korea) G403 -"
    ) == ["Staff"]
    assert chss.parse_instructors("- 9900 Main Street -") == ["Staff"]
    assert chss.parse_instructors("") == ["Staff"]


def test_parse_chss_hist_fixture():
    entries = chss.parse_page(HIST_FALL2025, Term("Fall", 2025), "historyarthistory.gmu.edu")
    # Fixture has 12 rows: 8 with syllabi, 4 without.
    assert len(entries) == 8
    section_id, first = entries[0]
    assert section_id == "115992"
    assert (first.codes, first.section, first.title, first.instructors, first.term, first.source) == (
        ["HIST121"],
        "001",
        "Formation of the American Republic",
        ["Armstrong, David G."],
        Term("Fall", 2025),
        "gmu-chss",
    )
    assert first.href.startswith("https://d101vc9winf8ln.cloudfront.net/syllabuses/115992/original/")

    online = next(r for _, r in entries if r.codes == ["HIST122"])
    assert online.section == "DL1"
    assert online.instructors == ["Lair, Meredith H."]

    # Rows without a syllabus link (e.g. HIST 252, HIST 388, HIST 999) are skipped.
    codes = {r.codes[0] for _, r in entries}
    assert "HIST252" not in codes and "HIST388" not in codes and "HIST999" not in codes


def test_parse_masonkorea_fixture():
    entries = chss.parse_page(
        MK_FALL2025, Term("Fall", 2025), chss.MASON_KOREA_HOST, source="gmu-masonkorea"
    )
    assert len(entries) == 10
    section_id, first = entries[0]
    assert section_id == "118302"
    assert first.codes == ["AE040"]
    assert first.section == "K01"
    assert first.instructors == ["Ham, Jason", "Davis, William James"]
    assert first.source == "gmu-masonkorea"

    # CDS 101 has a schedule segment but no instructor name; CONF 370 has only a location.
    cds101 = next(r for _, r in entries if r.codes == ["CDS101"])
    conf370 = next(r for _, r in entries if r.codes == ["CONF370"])
    assert cds101.instructors == ["Staff"]
    assert conf370.instructors == ["Staff"]


def test_term_and_details_never_read_from_filename():
    html = """
    <ul class="courselist">
      <li>
        <a href="/courses/econ103/course_sections/99901">ECON 103 - 002: Contemporary Microeconomic Principles</a>
        — Jane Doe — 09:00 AM to 10:15 AM MW - Horizon Hall 100 -
        <a href="//d101vc9winf8ln.cloudfront.net/syllabuses/99901/original/OLD_WRONG_CS999_Spring_2012_Smith.pdf">Section Syllabus</a>
      </li>
    </ul>
    """
    entries = chss.parse_page(html, Term("Fall", 2024), "economics.gmu.edu")
    assert len(entries) == 1
    sid, row = entries[0]
    assert sid == "99901"
    assert row.codes == ["ECON103"]
    assert row.section == "002"
    assert row.instructors == ["Doe, Jane"]
    assert row.term == Term("Fall", 2024)


class FakeFetcher:
    def __init__(self, pages):
        self.pages = pages
        self.asked = []

    def get(self, url):
        self.asked.append(url)
        html = self.pages.get(url)
        if html is None:
            return None
        return type("Res", (), {"content": html.encode("utf-8")})()


class Cache(dict):
    def listing_page(self, url):
        return self.get(url)

    def save_listing_page(self, url, doc):
        self[url] = doc


def test_dedupes_section_id_across_hosts():
    url_dept = "https://historyarthistory.gmu.edu/course_sections?code=HIST&term=202570"
    url_hub = "https://chssweb.gmu.edu/course_sections?code=HIST&term=202570"
    fetcher = FakeFetcher({url_dept: HIST_FALL2025, url_hub: HIST_FALL2025})
    hosts = {
        "historyarthistory.gmu.edu": ["HIST"],
        "chssweb.gmu.edu": ["HIST"],
    }
    items = list(chss.chss_rows(fetcher, listings.SINCE, hosts=hosts, term="202570", today=date(2026, 2, 1)))
    assert len(items) == 8
    assert len(fetcher.asked) == 2


def test_caches_historical_terms_and_recrawls_current_term():
    url_hist = "https://historyarthistory.gmu.edu/course_sections?code=HIST&term=202570"
    url_curr = "https://historyarthistory.gmu.edu/course_sections?code=HIST&term=202610"
    curr_html = """
    <ul class="courselist">
      <li>
        <a href="/courses/hist121/course_sections/200001">HIST 121 - 001: Formation of the American Republic</a>
        — David G. Armstrong — 10:30 AM to 11:45 AM MW - Krug Hall 242 -
        <a href="//d101vc9winf8ln.cloudfront.net/syllabuses/200001/original/HIST121_SP26.pdf">Section Syllabus</a>
      </li>
    </ul>
    """
    fetcher = FakeFetcher({url_hist: HIST_FALL2025, url_curr: curr_html})
    cache = Cache()
    hosts = {"historyarthistory.gmu.edu": ["HIST"]}

    # Today is in Spring 2026 (202610): Fall 2025 is historical (cached), Spring 2026 is current (re-crawled).
    first = list(chss.chss_rows(fetcher, Term("Fall", 2025), cache=cache, hosts=hosts, today=date(2026, 2, 1)))
    assert url_hist in cache
    assert url_curr not in cache
    assert len(fetcher.asked) == 2
    assert {i.row.term for i in first} == {Term("Fall", 2025), Term("Spring", 2026)}
    assert len(first) == 9

    # Second run: Fall 2025 comes from cache, Spring 2026 is fetched again.
    fetcher.asked.clear()
    second = list(chss.chss_rows(fetcher, Term("Fall", 2025), cache=cache, hosts=hosts, today=date(2026, 2, 1)))
    assert fetcher.asked == [url_curr]
    assert len(second) == len(first)


def test_masonkorea_rows_and_caching():
    url_hist = "https://masonkorea.gmu.edu/course_sections?term=202570"
    url_curr = "https://masonkorea.gmu.edu/course_sections?term=202610"
    fetcher = FakeFetcher({url_hist: MK_FALL2025, url_curr: MK_FALL2025})
    cache = Cache()

    items = list(chss.masonkorea_rows(fetcher, Term("Fall", 2025), cache=cache, today=date(2026, 2, 1)))
    assert len(items) == 10  # section_ids match across both fixture pages, so deduped across terms
    assert all(i.row.source == "gmu-masonkorea" for i in items)
    assert url_hist in cache and url_curr not in cache

    fetcher.asked.clear()
    list(chss.masonkorea_rows(fetcher, Term("Fall", 2025), cache=cache, today=date(2026, 2, 1)))
    assert fetcher.asked == [url_curr]
