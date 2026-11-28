# Agent instructions

All agent rules for this repository live in [`CLAUDE.md`](CLAUDE.md). Read it before making any change. It applies to every AI agent (Claude, Gemini/Antigravity, Codex and others).

The rules most often missed:

- Work on `feature/*` or `fix/*` branches off `develop` and open PRs into `develop`. Never merge into `main` unless the owner explicitly says so.
- Staging and production share the same data: test with unit tests and `--dry-run`, not real scrapes, until the owner approves a `main` release.
- Cloudflare R2 must never exceed **9.95 GB** of storage (free tier is 10 GB), 950,000 Class A or 9,500,000 Class B operations a month. Check usage before every write.
- Never print or commit secrets; no AI attribution lines in commits or PRs.
