# Backlog

## Sprint: Safer uploads, AI review and syllabus summaries

Goal: an admin can trust what students upload, review it without risk, and every approved syllabus gets a short summary on its course page.

### Already in place

- Students upload a missing syllabus from the Upload page (PDF only, under 4 MB, 5 per hour per IP).
- The API rejects anything that doesn't start with the `%PDF-` header, so renamed `.exe`/`.docx` files never reach the queue.
- Uploads wait in a separate `pending` GridFS bucket and a Supabase `uploads` row until an admin approves or rejects them.
- `/admin` is magic-link sign-in, limited to `ADMIN_EMAILS`. "View file" fetches the file with the admin token and shows it on the page (PDFs drawn by pdf.js, HTML in a sandboxed frame).
- With Azure Document Intelligence keys set, the reviewer sees course codes and terms detected in the PDF.

### 1. Make uploaded PDFs safe to open

A file can start with `%PDF-` and still carry JavaScript, auto-run actions or embedded files.

- [x] Parse each upload with `pdf-lib` (`api/src/lib/pdfcheck.js`) and reject files that don't parse, are encrypted, have no pages or more than 50.
- [x] Strip risky features: `/JavaScript`, `/JS`, `/OpenAction`, `/AA`, `/Launch` and other non-link actions, `/EmbeddedFile`, `/RichMedia`, `/XFA`, attachment and media annotations. Web links and page jumps are kept.
- [x] Sanitize before storing: the pages are copied into a new PDF, so the stored file is a rebuilt copy, not the student's original bytes. All 133 PDFs on staging pass the check unchanged.
- [ ] Virus scan. Options: ClamAV in a container for local Docker; for AWS, a scan step that stays in the free tier. Avoid VirusTotal for this, since files sent there become visible to its other users.
- [x] Show the check result on the admin card (clean / removed items). Rejected files never reach the queue; the student sees why. Stored in `uploads.detected.fileCheck`, so no schema change.

### 2. View the PDF inside the admin page

- [x] Render the pending PDF on the review card with pdf.js (canvas rendering, scripts off) instead of opening a new tab, so nothing is handed to the OS or a desktop PDF reader. `client/src/components/PdfViewer.jsx`, loaded only when an admin opens a PDF. Links, form fields and other annotations are not drawn.
- [x] Serve the admin file response with `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and a `sandbox` CSP (for every file type, not just HTML).
- [x] Page through the PDF, zoom, and see the extracted text next to it (a "Text" switch hides it).
- [x] "Open in new tab" next to "View file" opens a PDF in the browser's own reader, for Ctrl+F and printing. PDFs only: HTML would run on the site, so it stays in the sandboxed preview.

### 3. AI check of each upload

At upload time (or when the admin opens the card), send the extracted text to an LLM and show its verdict on the review card:

- [ ] Is this actually a course syllabus? (vs. homework, a random PDF, spam, offensive content)
- [ ] Does it match what the student entered: course code, term, section, instructor? Flag mismatches.
- [ ] Is it a duplicate of a syllabus we already have for that course/term/section?
- [ ] Any personal data that shouldn't be public (student names, grades, phone numbers)?
- [ ] Verdict: likely legit / needs a closer look / likely junk, with one-line reasons. The admin still decides; nothing is auto-approved.

Use free AI tiers only (see "Free AI options" below). Only send uploads that pass the file checks, truncate text to ~20k characters, and if the free quota runs out, show "AI check unavailable" and let the admin review by hand.

### 4. Syllabus summaries on course pages

When an upload is approved (and once, as a backfill, for scraped syllabi):

- [ ] Generate a structured summary per syllabus: what the course covers (main topics), prerequisites and expected background, languages/tools used, textbook(s), grading breakdown, workload (projects, exams, homework), notable policies (late work, attendance, AI use).
- [ ] Store it on the offering in DynamoDB next to `fileId`, with the model and date it was generated.
- [ ] Show it on the course page per professor and term, so students can compare how different professors teach the same course.
- [ ] Optional: a course-level rollup ("across all professors, CS 310 usually covers...").
- [ ] Let the admin edit or regenerate a summary.

### 5. Catch wrong course codes and fix published syllabi (done)

Found in testing: a CS 584 syllabus was uploaded as CS 580, approved, and landed on the wrong course page.

- [x] Upload form: course picker that shows the course title ("CS 580 · Introduction to Artificial Intelligence") and warns about codes not on the site.
- [x] Admin review: edit course, term, section and professor before approving; the course title is shown.
- [x] Instructor names: the upload form suggests professors already listed for the course.
- [x] Admin "Published syllabi" tab: move, edit or delete any syllabus, scraped or uploaded. Fixes to scraped files are recorded (`PK=CURATED`) so the weekly scrape doesn't undo them.
- [x] Full professor names: the scraper reads "Zhu, Ziwei" out of the syllabus text when the listing only says "Zhu, Z" or "Gonzalez".
- [ ] The AI check (item 3) also compares the course code in the PDF with the one entered.
- [ ] Merge two spellings of one professor in one step from the admin page (today: edit each syllabus). Known case: "Gonzalez Hernandez, A" and "González, Ana". Until then, Actions → "Rename professor" does it per environment (`api/scripts/rename-professor.js`, dry run first).

### 6. Show when the data was last updated

The cs.gmu.edu/syllabi/ page has returned 404 since late 2025 and the newest Internet Archive capture is from September 2025, so the weekly scrape re-reads the same captures. New syllabi now come only from uploads, and students can't tell how fresh the site is.

- [ ] Record a "last updated" time per environment: the end of the last successful scrape and the time of the last approved upload, whichever is newer. Store it in DynamoDB (one small item) so no schema change is needed.
- [ ] Return it from the API (`GET /api/status` or on an existing response) and show "Last updated Nov 1, 2026" in the footer or on the home page.
- [ ] Optional: say on the home page that new terms come from uploads, with a link to the Upload page.
- [ ] Optional: a "Refresh now" button on the admin page that starts the Scrape syllabi workflow through the GitHub API (`workflow_dispatch`, fine-grained token with Actions write on this repo only, kept in the environment secrets). Low value while the source page is offline; today the same thing is Actions → Scrape syllabi → Run workflow.

Known gap: CS 405 has no syllabus. Its only listing (Spring 2025, `CS_405All_InstructorsAll.html`) was never captured by the Internet Archive, so it has to come from an upload.

### Free AI options

Everything in this sprint must stay at $0, like the rest of the project. Free tiers and their limits change often, so check each provider's current terms before building on it.

| Job | Free option | Why |
|---|---|---|
| Read text out of PDFs | Azure Document Intelligence F0 (already wired in) or `pdfjs-dist` text extraction in the API | No LLM needed. pdf.js costs nothing and has no quota. |
| AI check on each upload (runs in the API) | Google Gemini API free tier (a Flash model) | Free API key, enough daily requests for a handful of uploads, JSON output mode. |
| Fallback if Gemini is down or out of quota | Groq free tier (open Llama/Qwen models) | Fast, free key, OpenAI-compatible API. |
| Summaries for every scraped syllabus (one-time backfill, then weekly) | GitHub Models from a GitHub Actions job, using the built-in `GITHUB_TOKEN` | Free for the repo, runs next to the existing weekly scrape, needs no extra keys. Rate limits are per day, so the backfill is spread over several runs. |
| Running fully local (optional) | Ollama in Docker Compose with a small model | Free and private for development, but too heavy for Lambda, so local only. |
| Virus scan | ClamAV (open source) | Free. Not an AI tool, but it covers the "no virus" part. |

Build notes:

- Hide the provider behind one small module (`api/src/lib/ai.js`) with `checkUpload(text, details)` and `summarize(text)`, so switching from Gemini to Groq is a config change (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` in `.env` and GitHub secrets).
- Ask for JSON back and validate it, so a malformed answer never breaks the review page.
- Free tiers may use prompts to improve their models. Scraped syllabi are already public, but student uploads could contain personal info, so strip emails, phone numbers and student IDs before sending.
- Cache results: store the verdict on the Supabase `uploads` row and the summary on the DynamoDB offering, so each file is only sent once.

### Done when

- A PDF with embedded JavaScript is rejected or arrives in the queue already stripped, and the card says which.
- The admin reviews every upload without leaving `/admin` or downloading anything.
- Each pending upload shows an AI verdict with reasons.
- Approved syllabi show a summary on the course page; scraped ones are backfilled.
- Tests cover the PDF checks, the AI call (mocked) and the summary display.
