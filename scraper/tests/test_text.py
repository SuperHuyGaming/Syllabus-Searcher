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


def test_web_pages_must_mention_their_course():
    from scrape import mentions_course

    syllabus = b"<html><body><h1>CS 405: Ethics and Law in Computing</h1></body></html>"
    redirect = b"<html><body><h1>Student Resources</h1><p>CS department, room 4050</p></body></html>"
    assert mentions_course(syllabus, "text/html; charset=utf-8", ["CS405"])
    assert not mentions_course(redirect, "text/html; charset=utf-8", ["CS405"])
    assert mentions_course(b"%PDF-1.7 scanned", "application/pdf", ["CS405"])
