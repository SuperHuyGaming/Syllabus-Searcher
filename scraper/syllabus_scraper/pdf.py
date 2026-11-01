"""Prints HTML syllabi to PDF, so every syllabus on the site can be downloaded as a PDF.

Uses headless Chromium (Playwright). The HTML is untrusted, so JavaScript is off and
every network request is blocked: the page renders from its own markup only.
"""

import logging

log = logging.getLogger("scraper")

MAX_PDF_BYTES = 4 * 1024 * 1024  # same cap as other files (Lambda response limit)


class PdfMaker:
    """Use as a context manager so one browser serves every conversion in a run."""

    def __enter__(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            log.warning("Playwright isn't installed, so HTML syllabi won't get PDF copies")
            self._playwright = self._browser = None
            return self
        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch()
        return self

    def __exit__(self, *exc):
        if self._browser:
            self._browser.close()
        if self._playwright:
            self._playwright.stop()

    @property
    def available(self):
        return self._browser is not None

    def html_to_pdf(self, html):
        """Returns PDF bytes, or None if the page can't be printed or comes out too big."""
        if not self.available:
            return None
        context = self._browser.new_context(java_script_enabled=False, offline=True)
        try:
            page = context.new_page()
            page.route("**/*", lambda route: route.abort())
            page.set_content(html.decode("utf-8", errors="replace"), wait_until="domcontentloaded", timeout=30_000)
            pdf = page.pdf(
                format="Letter",
                print_background=True,
                margin={"top": "0.6in", "bottom": "0.6in", "left": "0.6in", "right": "0.6in"},
            )
        except Exception as err:  # one bad page shouldn't stop the scrape
            log.warning("Couldn't print HTML syllabus to PDF: %s", err)
            return None
        finally:
            context.close()
        if len(pdf) > MAX_PDF_BYTES:
            log.warning("PDF copy is over 4 MB, skipping")
            return None
        return pdf
