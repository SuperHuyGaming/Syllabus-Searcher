# Bookworm (Debian 12): Playwright installs Chromium's system packages there.
FROM python:3.13-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt ./
# Chromium prints HTML syllabi to PDF (syllabus_scraper/pdf.py).
RUN pip install --no-cache-dir -r requirements.txt && playwright install --with-deps chromium
COPY syllabus_scraper ./syllabus_scraper
COPY scrape.py ./
ENTRYPOINT ["python", "scrape.py"]
