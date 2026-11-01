import pytest

from syllabus_scraper.pdf import PdfMaker
from syllabus_scraper.text import extract_text

pytest.importorskip("playwright")

PAGE = b"""<html><body>
<h1>CS 405 Syllabus</h1><p>Late work loses 10% per day.</p>
<script>document.body.innerHTML = 'HACKED';</script>
<img src="https://example.com/tracker.png">
</body></html>"""


@pytest.fixture(scope="module")
def maker():
    with PdfMaker() as m:
        if not m.available:
            pytest.skip("Chromium isn't installed")
        yield m


def test_prints_html_to_a_readable_pdf(maker):
    pdf = maker.html_to_pdf(PAGE)
    assert pdf.startswith(b"%PDF-")
    text = extract_text(pdf, "application/pdf")
    assert "CS 405 Syllabus" in text
    assert "Late work loses 10% per day." in text


def test_scripts_in_the_page_never_run(maker):
    text = extract_text(maker.html_to_pdf(PAGE), "application/pdf")
    assert "HACKED" not in text
