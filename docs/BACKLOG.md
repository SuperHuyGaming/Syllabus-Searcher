# Backlog

## Sprint: Safer uploads, AI review and syllabus summaries

Goal: an admin can trust what students upload, review it without risk, and every approved syllabus gets a short summary on its course page.

### Already in place

- Students upload a missing syllabus from the Upload page (PDF only, under 4 MB, 5 per hour per IP).
- The API rejects anything that doesn't start with the `%PDF-` header, so renamed `.exe`/`.docx` files never reach the queue.
- Uploads wait in a separate `pending` GridFS bucket and a Supabase `uploads` row until an admin approves or rejects them.
- `/admin` is magic-link sign-in, limited to `ADMIN_EMAILS`. "Open PDF" fetches the file with the admin token and opens it in the browser's PDF viewer (not a download).
- With Azure Document Intelligence keys set, the reviewer sees course codes and terms detected in the PDF.

### 1. Make uploaded PDFs safe to open

A file can start with `%PDF-` and still carry JavaScript, auto-run actions or embedded files.

- [ ] Parse each upload with a PDF library (e.g. `pdf-lib` or `pdfjs-dist`) and reject files that don't parse, are encrypted, or have more than ~50 pages.
- [ ] Reject or strip risky features: `/JavaScript`, `/JS`, `/OpenAction`, `/AA`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/XFA`.
- [ ] Sanitize before storing: re-save the PDF from its page content only (or flatten with qpdf/Ghostscript) so the stored file is a rebuilt copy, not the student's original bytes.
- [ ] Virus scan. Options: ClamAV in a container for local Docker; for AWS, a scan step that stays in the free tier. Avoid VirusTotal for this, since files sent there become visible to its other users.
- [ ] Show the scan result on the admin card (clean / stripped N items / rejected and why).

### 2. View the PDF inside the admin page

- [ ] Render the pending PDF on the review card with pdf.js (canvas rendering, scripts off) instead of opening a new tab, so nothing is handed to the OS or a desktop PDF reader.
- [ ] Serve the admin file response with `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and a `sandbox` CSP, matching how public syllabi are served.
- [ ] Page through the PDF, zoom, and see the extracted text next to it.

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

### 5. Catch wrong course codes and fix published syllabi

Found in testing: a CS 584 syllabus was uploaded as CS 580, approved, and landed on the wrong course page. It had to be moved by hand in the database.

- [ ] Upload form: as the student types the course code, show the course title ("CS 580 · Introduction to Artificial Intelligence") so a typo is obvious. Pick from a list of known courses instead of free text.
- [ ] Admin card: show the course title next to the code, and let the admin edit course, term, section and instructor before approving.
- [ ] Instructor names: suggest existing professors for the course ("Zhu, Z") so "Zhu, Ziwei" doesn't become a separate professor; store names in the scraped "Last, F" format.
- [ ] Admin "Published" tab: edit or unpublish an approved syllabus (move it to another course, delete it).
- [ ] The AI check (item 3) also compares the course code in the PDF with the one entered.

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
