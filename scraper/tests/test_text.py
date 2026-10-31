import io

from pypdf import PdfWriter

from syllabus_scraper.text import MAX_CHARS, extract_text


def test_html_text_skips_scripts_and_collapses_whitespace():
    html = b"<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>CS 310</h1>\n\n<p>Uses  Java</p></body></html>"
    assert extract_text(html, "text/html; charset=utf-8") == "CS 310 Uses Java"


def test_pdf_without_text_returns_empty():
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buffer = io.BytesIO()
    writer.write(buffer)
    assert extract_text(buffer.getvalue(), "application/pdf") == ""


def test_broken_files_dont_raise():
    assert extract_text(b"%PDF-1.7 garbage", "application/pdf") == ""


def test_text_is_capped():
    html = ("<p>" + "word " * 20_000 + "</p>").encode()
    assert len(extract_text(html, "text/html")) == MAX_CHARS
