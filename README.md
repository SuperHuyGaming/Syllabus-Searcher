# GMU Syllabus Searcher

Look up a GMU Computer Science course, see which professors taught it each term (Fall 2022 onward), and open their syllabus. No login needed. Students can upload missing syllabi, and an admin approves them before they show up.

## How it fits together

| Part | Tech | Runs on (local Docker) | Runs on (AWS, $0) |
|---|---|---|---|
| Website | React, Vite, MUI, React Query | nginx container | S3 + CloudFront Free plan |
| API | Node.js Lambda handler | Node container (`scripts/local.js`) | AWS Lambda behind CloudFront |
| Course catalog | DynamoDB single table | DynamoDB Local container | DynamoDB, provisioned 5/5 |
| Syllabus files | MongoDB GridFS | Mongo container | MongoDB Atlas M0 |
| Upload queue + admin login | Supabase Postgres + Auth | Supabase free tier (cloud) | Supabase free tier |
| PDF reading (optional) | Azure AI Document Intelligence | Azure F0 (cloud) | Azure F0 |
| Scraper | Python | One-off container | GitHub Actions schedule |

```
browser ──> nginx / CloudFront ──> /            static React build
                                └─> /api/*      API ──> DynamoDB  (courses, terms, professors)
                                                    ├─> MongoDB   (PDF/HTML files)
                                                    ├─> Supabase  (pending uploads, admin auth)
                                                    └─> Azure     (reads uploaded PDFs)
```

## Run it locally with Docker

Needs Docker Desktop. On Windows the quickest way is `.\start.ps1`, which starts Docker, starts the app, loads syllabi on the first run and opens the browser. [docs/RUN_ON_YOUR_PC.md](docs/RUN_ON_YOUR_PC.md) explains each piece and covers troubleshooting.

Or by hand:

```bash
cp .env.example .env              # optional: add Supabase/Azure keys for uploads and /admin
docker compose up -d --build      # http://localhost:8080
docker compose run --rm scraper   # loads GMU CS syllabi since Fall 2022 (takes a few minutes)
```

Useful commands:

```bash
docker compose ps                         # what's running
docker compose logs -f api                # API logs
curl localhost:8080/api/health            # checks DynamoDB, MongoDB, Supabase
docker compose run --rm scraper --dry-run # list what would be scraped, write nothing
docker compose down                       # stop (data is kept in volumes)
docker compose down -v                    # stop and delete all local data
```

Without Supabase keys, searching and viewing syllabi work, but uploads and `/admin` don't, and `/api/health` reports Supabase as not configured.

### Turning on uploads and the admin page (Supabase, free)

1. Create a project at supabase.com.
2. In the SQL editor, run `infra/supabase/schema.sql`.
3. Under Authentication → Users, add your own email (the admin page only signs in existing users).
4. Copy the project URL, anon key and service role key into `.env`, and set `ADMIN_EMAILS` to your email.
5. Rebuild so the website picks up the keys: `docker compose up -d --build`.
6. In Supabase, Authentication → URL Configuration, add `http://localhost:8080/admin` as a redirect URL.

### Azure Document Intelligence (optional, free F0 tier)

Create a Document Intelligence resource on the F0 tier and put its endpoint and key in `.env`. Each upload is then read and the reviewer sees which course codes and terms the PDF mentions. Uploads work without it.

## Where the syllabi come from

The CS department used to list syllabi at `cs.gmu.edu/syllabi/`, a table of course, section, title and instructor linking to files under `/media/syllabi/<Term>/`. Those pages and files started returning 404 in late 2025, so the scraper falls back to the Internet Archive's copies.

What the archive has, as of October 2026:

- Listing pages for Fall 2022, Spring 2024, Fall 2024, Spring 2025, Summer 2025 and Fall 2025. Spring 2023 and Fall 2023 listings weren't captured.
- Files for most terms from Fall 2022 to Spring 2025. Fall 2025 files weren't captured, so those rows get skipped.

For files no surviving listing page mentions (all of 2023, and some of Fall 2024), a second pass guesses the course, professor and section from the file name, e.g. `CS_321PettitR002_006.pdf` → CS 321, Pettit, R, sections 002 and 006. These show a "Details from file name" tag on the site.

Student uploads fill the remaining gaps. If GMU posts syllabi somewhere new, add that page to `scraper/syllabus_scraper/sources.py`.

## Development without Docker

```bash
docker compose up -d dynamodb mongodb

cd api && cp .env.example .env && npm install && npm run db:init && npm run dev   # :3001
cd client && npm install && npm run dev                                           # :5173, proxies /api
cd scraper && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt
.venv/Scripts/python scrape.py --since "Fall 2022"
```

Tests: `cd api && npm test`, `cd client && npm test`, `cd scraper && .venv/Scripts/python -m pytest`.

## Deploying to AWS

Step by step, including account setup and GitHub secrets: [docs/DEPLOY.md](docs/DEPLOY.md). Deploys run from the Actions tab and use `infra/template.yaml` (AWS SAM).

## Keeping AWS free (when hosting there)

- No EC2, NAT gateway or public IPv4 addresses.
- DynamoDB in provisioned mode at 5/5, inside the always-free 25/25. It slows down at the limit instead of billing.
- CloudFront on the Free flat-rate plan (no overage charges), caching `/api/*` so Lambda rarely runs.
- Lambda permanent free tier: 1M requests a month. Files are capped at 4 MB to fit Lambda's 6 MB response limit.
- An AWS Budget alert at $0.01.
