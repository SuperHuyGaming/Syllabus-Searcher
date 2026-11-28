# Agent instructions

These rules apply to every AI agent working in this repository (Claude, Gemini/Antigravity, Codex and others) in every session. A local, git-ignored `CLAUDE.md` and `PLAN.md` may hold more detail on the owner's machine; when they exist, read them too.

## Branches and releases

- Work on `feature/*` or `fix/*` branches off `develop` and open PRs into `develop` (staging deploys from `develop`).
- `main` is production and is protected. **Never merge into `main`, or open-and-merge a release PR, unless the owner explicitly says so in that session.**
- Automatic deploys run `deploy.yml` from `main`, and GitHub only runs scheduled workflows from `main`, so workflow changes take effect after they reach `main`.

## Shared data

- **Staging and production share the same data** (DynamoDB, MongoDB Atlas, Supabase, Cloudflare R2). A real scrape or upload from `develop` shows up on the live site.
- New record formats must reach `main`'s API before real scrapes write them. On `develop`, test with unit tests and `--dry-run`; run real scrapes for new sources only after the owner approves the `main` release, starting with a small `--limit`.

## Storage limits (free tiers only)

- **Cloudflare R2 hard cap: 9.95 GB** (9,950,000,000 bytes). The free tier is 10 GB-month of storage, 1 million Class A (write/list) and 10 million Class B (read) operations per month; anything above is billed.
  - Code that writes to R2 must measure the bucket's current size first and refuse the write (treat R2 as full: fall through to the next storage option or stop) when it would go past 9.95 GB.
  - Keep monthly operations under **950,000 Class A** and **9,500,000 Class B**.
  - Never raise these limits, remove the check, or enable paid R2 features without the owner's explicit approval.
- MongoDB Atlas M0: 512 MB (scraper budget 470 MB). Supabase Storage: 950 MB per project. Check usage before bulk scrapes.
- Prefer **link-only storage** (a record pointing at a stable public URL such as GMU's file host, no copy) over copying files.
- Don't add paid services.

## Always

- Never print or commit secrets. Local secrets live in the git-ignored `.env`; deployed ones in GitHub secrets.
- No AI attribution lines (`Co-Authored-By: Claude`, "Generated with ...") in commits or PRs.
- Tests: `cd api && npx jest`; `cd client && npx vitest run && npx playwright test`; `cd scraper && .venv/Scripts/python -m pytest -q`. Lint: `npx eslint .` in `api/` and `client/`.
