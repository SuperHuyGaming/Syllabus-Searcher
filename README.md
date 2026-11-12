# GMU Syllabus Searcher

Look up any GMU course, see which professors taught it each term (Fall 2022 onward), and open their syllabus. No login needed. Most syllabi so far are Computer Science, from the CS department's old syllabus page; other departments fill in through student uploads. Other schools are listed too (Georgia Tech, Old Dominion, UNC Chapel Hill): pick one in the header to browse its course catalog and upload its syllabi.

- **By course**: every course in GMU's official catalog (about 170 departments), with credits, description and prerequisites. Search a code or title across departments, or pick a department on the home page (`/?dept=MATH`), then filter syllabi by term and professor. Courses with no syllabus yet ask students to upload one.
- **By professor**: search by first or last name and see every course and term they have a syllabus for. Full names are read from the syllabi when the department listing only gives an initial.
- **Inside syllabi**: full-text search for a language, textbook or policy (`Python`, `"late policy"`), with highlighted snippets.
- **Uploads**: students can add missing syllabi as a PDF or, when the professor posted it as a web page, an HTML file; an admin approves them before they show up. Uploaded PDFs are rebuilt page by page with scripts, auto-run actions and attachments removed; encrypted or unreadable files are refused. The admin reviews each file on the page (PDFs drawn with pdf.js, with the page text alongside), so it never opens in a desktop reader. Every upload is virus-scanned with ClamAV: locally a ClamAV container scans it on arrival and refuses infected files; on the deployed sites the **Virus scan** workflow (`api/scripts/virus-scan.js`) scans pending uploads every two hours. The admin card shows the result, and a flagged upload can only be rejected.
- **PDF for every syllabus**: syllabi that exist only as web pages get a PDF copy (printed by headless Chromium with scripts and network off), shown as a "PDF" button.
- **Admin fixes**: at `/admin`, correct an upload's course, term, section or professor before approving, move, edit or delete any published syllabus, merge two spellings of one professor across every syllabus at once, and start a re-scrape with **Refresh now** (Site data tab, needs the optional `GH_DISPATCH_TOKEN` secret). Fixes to scraped syllabi survive the weekly re-scrape.

## How it fits together

| Part | Tech | Runs on (local Docker) | Runs on (AWS, $0) |
|---|---|---|---|
| Website | React, Vite, MUI, React Query | nginx container | S3 + CloudFront Free plan |
| API | Node.js Lambda handler | Node container (`scripts/local.js`) | AWS Lambda behind CloudFront |
| Syllabus offerings | DynamoDB single table | DynamoDB Local container | DynamoDB, provisioned 5/5 |
| GMU course catalog | MongoDB collections `departments`, `courses` | Mongo container | MongoDB Atlas M0 |
| Syllabus files + text search | MongoDB GridFS + text index | Mongo container | MongoDB Atlas M0 |
| Upload queue + admin login | Supabase Postgres + Auth | Supabase free tier (cloud) | Supabase free tier |
| PDF reading (optional) | Azure AI Document Intelligence | Azure F0 (cloud) | Azure F0 |
| AI check of uploads (optional) | Gemini API, Groq as fallback | free tiers (cloud) | free tiers |
| Scraper | Python | One-off container | GitHub Actions schedule |

```
browser ──> nginx / CloudFront ──> /            static React build
                                └─> /api/*      API ──> DynamoDB  (courses, terms, professors)
                                                    ├─> MongoDB   (PDF/HTML files)
                                                    ├─> Supabase  (pending uploads, admin auth)
                                                    ├─> Azure     (reads uploaded PDFs)
                                                    └─> Gemini/Groq (AI check of uploads)
```

## Run it locally with Docker

Needs Docker Desktop. On Windows the quickest way is `.\start.ps1`, which starts Docker, starts the app, loads syllabi on the first run and opens the browser. [docs/RUN_ON_YOUR_PC.md](docs/RUN_ON_YOUR_PC.md) explains each piece and covers troubleshooting.

Or by hand:

```bash
cp .env.example .env              # optional: add Supabase/Azure keys for uploads and /admin
docker compose up -d --build      # http://localhost:8080
docker compose run --rm scraper   # loads GMU CS syllabi since Fall 2022 and every course in the catalog (takes a few minutes)
```

Useful commands:

```bash
docker compose ps                         # what's running
docker compose logs -f api                # API logs
curl localhost:8080/api/health            # checks DynamoDB, MongoDB, Supabase
curl localhost:8080/api/status            # when the last full scrape and the last approved upload ran
docker compose run --rm scraper --dry-run # list what would be scraped, write nothing
docker compose run --rm scraper --catalog-only # refresh the course list from catalog.gmu.edu
docker compose down                       # stop (data is kept in volumes)
docker compose down -v                    # stop and delete all local data
```

Without Supabase keys, searching and viewing syllabi work, but uploads and `/admin` don't, and `/api/health` reports Supabase as not configured.

### Turning on uploads and the admin page (Supabase, free)

1. Create a project at supabase.com.
2. In the SQL editor, run `infra/supabase/schema.sql`.
3. Under Authentication → Users, add your own email with a password (the admin page only signs in existing users; it signs in with email and password, or an emailed link if you forget it).
4. Copy the project URL, anon key and service role key into `.env`, and set `ADMIN_EMAILS` to your email.
5. Rebuild so the website picks up the keys: `docker compose up -d --build`.
6. In Supabase, Authentication → URL Configuration, add `http://localhost:8080/admin` as a redirect URL.

### Azure Document Intelligence (optional, free F0 tier)

Create a Document Intelligence resource on the F0 tier and put its endpoint and key in `.env`. Each upload is then read and the reviewer sees which course codes and terms the PDF mentions. Uploads work without it.

### AI check of uploads (optional, free tiers)

Put a Gemini API key (aistudio.google.com/apikey) in `AI_API_KEY`, and optionally a Groq key in `AI_FALLBACK_API_KEY`. Each upload's text is then sent to the model, which says whether it looks like a syllabus and whether it matches the course, term, section and instructor the student entered. The review card shows the verdict with its reasons, flags a syllabus already on the site for that section, and has a "Run again" button that checks the details as corrected on the card. Before sending, emails, phone numbers and G-numbers are replaced and the text is cut to 20,000 characters, since free tiers may keep prompts. When no key is set or the quota runs out, the card says "AI check unavailable" and the admin reviews by hand. The admin always decides; nothing is approved automatically.

The same key also writes a short summary of each syllabus for its course page: topics, languages and tools, grading breakdown, workload, textbooks and the late work, attendance and AI policies. Students open it with the "Summary" button on a syllabus, so they can compare how professors teach the same course. An upload is summarized when it's approved; scraped CS syllabi are filled in by the weekly **Summarize syllabi** workflow (`api/scripts/summarize.js`, or `npm run summarize` in `api/` locally), a batch per run to stay inside the free quota. Summaries are stored per file (`PK=SUMMARY`), so a re-scrape keeps them. In /admin → Published syllabi, "Summary" on any syllabus edits a summary or regenerates it.

Courses with two or more summarized syllabi also get an "Across all syllabi" card at the top of their page: one overview of what the course usually covers, its common topics and grading, and how professors differ. The same workflow builds it from the per-syllabus summaries (`PK=ROLLUP`) and rebuilds it only when those change.

## Where the courses and syllabi come from

The course list comes from GMU's official catalog: the A-Z list at `catalog.gmu.edu/courses/` gives every department, and each department's page (e.g. `catalog.gmu.edu/courses/cs/`) its courses with title, credits, description and prerequisites. Every scrape reloads it into MongoDB (`departments`, `courses`), or run just that step with `docker compose run --rm scraper --catalog-only` (add `--departments CS,MATH` for a few). It lives in MongoDB rather than DynamoDB because GMU has over ten thousand courses and the DynamoDB table's 5 write units would take hours to load them. The API merges the catalog with the DynamoDB courses that have syllabi.

Only the CS department ever published its syllabi, so every other department's syllabi come from uploads. The CS listing also carries cross-listed SWE and ISA courses, which are kept.

### Other schools

The schools and their catalogs are listed in `scraper/syllabus_scraper/schools.py`. They all publish with CourseLeaf, the same system as `catalog.gmu.edu`, so one parser reads them (`syllabus_scraper/catalog.py` handles its three page layouts). The weekly scrape loads every school's catalog into MongoDB (`schools`, plus a `school` field on `departments` and `courses`); none has a syllabus archive, so their syllabi come from uploads.

Course codes carry their school everywhere they're stored or linked: GMU's stay bare (`CS310`, department `CS`), so nothing saved before other schools existed had to change, and every other school's are prefixed (`unc:COMP110`, department `unc:COMP`, page `/courses/unc:COMP110`). `api/src/lib/terms.js` and `client/src/lib/courses.js` read and write them. Pages take `?school=unc`. The home page search sets it the way Rate My Professors does: one box asks for the school (name and city), then suggests subjects, courses and professors at it (`client/src/components/HomeSearch.jsx`, `client/src/lib/suggest.js`). Other pages have a picker in the header. The browser remembers the last pick, and a first visit starts on the school box. Professors, full-text search and the admin's professor merge are per school, since the same name at two schools is two people.

To add a school with a CourseLeaf catalog, add it to `schools.py`, then check that it parses without writing anything:

```bash
cd scraper && python scrape.py --catalog-only --dry-run --schools <key> --departments <CODE>
```

Course numbers must have 3 or 4 digits, so 2-digit ones (UNC's first-year seminars, e.g. COMP 50) are skipped.

The CS department used to list syllabi at `cs.gmu.edu/syllabi/`, a table of course, section, title and instructor linking to files under `/media/syllabi/<Term>/`. Those pages and files started returning 404 in late 2025, so the scraper falls back to the Internet Archive's copies.

What the archive has, as of October 2026:

- Listing pages for Fall 2022, Spring 2024, Fall 2024, Spring 2025, Summer 2025 and Fall 2025. Spring 2023 and Fall 2023 listings weren't captured.
- Files for most terms from Fall 2022 to Spring 2025. Fall 2025 files weren't captured, so those rows get skipped.

For files no surviving listing page mentions (all of 2023, and some of Fall 2024), a second pass guesses the course, professor and section from the file name, e.g. `CS_321PettitR002_006.pdf` → CS 321, Pettit, R, sections 002 and 006. These show a "Details from file name" tag on the site.

Math syllabi (Spring 2018 to Summer 2022, about 860 files) come from three places, each listing exact file URLs: the College of Science term pages (`science.gmu.edu/.../mathematical-sciences-course-syllabi/course-N`, read from the Internet Archive; the PDFs they link are still live), the open folders `math.gmu.edu/syllabi/S18/`, `F18/` and `S19/`, and the archive's list of `science.gmu.edu/media/math*` files. Course, section, instructor and term come from the table, file name or slug, never a guessed URL. Later Math files exist on the live site but nothing lists them yet. Run just this source with `python scrape.py --sources math --no-catalog`.

Other College of Science departments keep live syllabi pages on science.gmu.edu (`cos.py`): Environmental Science and Policy, Geography and Geoinformation Science, Physics and Astronomy, Computational and Data Sciences, Atmospheric, Oceanic and Earth Sciences (climate and geology), Neuroscience and Systems Biology. About 2,600 syllabi from Spring 2018 on are listed, one page per term, a term heading above a list of links, or a grid of courses by term; the newest one per course is kept (about 440 files). Biology, Chemistry and Forensic Science post none. Run just this source with `python scrape.py --sources science --no-catalog`.

CEHD (education, kinesiology, health, sport, recreation and tourism) listed every section's syllabus on its course pages, `cehd.gmu.edu/courses/HEAL-325` ("Spring 2024, Section: DL1, ..., Instructor: ..." and a link to `/assets/docs/syllabi/2024/syllabus_N.pdf`), until mid-2024, when the links and files came down. `cehd.py` reads the last Internet Archive capture of each course page before September 2024 (about 1,700 pages) and downloads the files from the archive. Archived pages don't change, so each page's rows are kept in the MongoDB collection `listing_pages` once read, and a run reads at most 600 new pages (about 45 minutes); the rest wait for the next run. Staging skips CEHD (it keeps only a CS and Math sample).

New sources like these go through a shared path (`scraper/syllabus_scraper/listings.py`): it drops repeats, keeps every syllabus for MATH and CS but only the newest one per course in other subjects, keeps a copy of each file, and writes a summary picked out of the text by rules (`rules.py`: grading breakdown, textbook, prerequisites, tools, late work, attendance and AI policies), because free AI tiers can't keep up with thousands of files. Those summaries say "Picked out of the syllabus text automatically (no AI)"; Regenerate in /admin still asks the AI for any one file. Files go to the storage pool (`pool.py`): the site's Supabase Storage first (bucket `syllabi`, 1 GB free per project, filled to 950 MB), then the Atlas clusters (the main one, then any extra in `MONGODB_URI_2`, `MONGODB_URI_3`; docs/DEPLOY.md, step 2). The main Atlas cluster also holds the search text and student uploads, so it is kept for those; `--move-files MB` (workflow input `move_files`) moves files already on Atlas to Supabase Storage, keeping their ids. Each run downloads at most `--limit` new files per source (400 in the workflow) and stops cleanly when storage is full; the next run continues.

Student uploads fill the remaining gaps. If GMU posts syllabi somewhere new, add a source module like `scraper/syllabus_scraper/math.py` and list it in `LISTING_SOURCES` in `scrape.py`.

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

Step by step, including account setup and GitHub secrets: [docs/DEPLOY.md](docs/DEPLOY.md). Deploys use `infra/template.yaml` (AWS SAM).

Two environments, one per branch: `develop` deploys to **staging** and `main` to **production**, each after CI passes. Build features on a branch off `develop`, check them on staging, then merge `develop` into `main` with a pull request (`main` is protected).

## Keeping AWS free (when hosting there)

- No EC2, NAT gateway or public IPv4 addresses.
- DynamoDB in provisioned mode at 5/5, inside the always-free 25/25. It slows down at the limit instead of billing.
- CloudFront on the Free flat-rate plan (no overage charges), caching `/api/*` so Lambda rarely runs.
- Lambda permanent free tier: 1M requests a month. Files are capped at 4 MB to fit Lambda's 6 MB response limit.
- An AWS Budget alert at $0.01.
