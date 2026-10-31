# Running Syllabus Searcher on your own PC

## The short version

Open PowerShell in the `Syllabus-Searcher` folder and run:

```powershell
.\start.ps1
```

It starts Docker if needed, builds and starts the app, loads the syllabi the first time, and opens http://localhost:8080.
If Windows blocks the script, run this once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

## What's actually happening

`docker compose up` reads `docker-compose.yml` and starts five containers. Each one is a small, isolated Linux machine running one piece of the app:

| Container | What it is | In the cloud this would be |
|---|---|---|
| `syllabus-client` | nginx serving the React website on port **8080**, forwarding `/api/*` to the API | S3 + CloudFront |
| `syllabus-api` | The Node.js API (the same code that runs on Lambda) | AWS Lambda |
| `syllabus-dynamodb` | DynamoDB Local, the course catalog | AWS DynamoDB |
| `syllabus-mongodb` | MongoDB, the syllabus files | MongoDB Atlas |
| `db-init` | Creates the DynamoDB table, then exits | (the SAM template) |

The **scraper** is a sixth container that only runs when you ask for it. It downloads syllabi and saves them into DynamoDB and MongoDB.

Your data lives in Docker **volumes** (`dynamodb_data`, `mongo_data`), so it survives restarts and reboots.

## Everyday commands

Run these from the `Syllabus-Searcher` folder.

| I want to… | Command |
|---|---|
| Start the app | `docker compose up -d` |
| Start it after changing code | `docker compose up -d --build` |
| Stop it (keeps data) | `docker compose down` |
| See what's running | `docker compose ps` |
| Watch the API's logs | `docker compose logs -f api` (Ctrl+C to stop watching) |
| Check every database is reachable | open http://localhost:8080/api/health |
| Load or refresh syllabi | `docker compose run --rm scraper` |
| Preview a scrape without saving | `docker compose run --rm scraper --dry-run` |
| Wipe all data and start fresh | `docker compose down -v`, then `.\start.ps1` |

`-d` means "detached": the containers keep running in the background after the command returns.
`--rm` deletes the scraper container when it finishes; the data it saved stays.

## Turning on uploads and the admin page

Search works with no setup. Uploads and `/admin` need a free Supabase project (see the README), then:

1. Copy `.env.example` to `.env` and fill in the Supabase keys and your email.
2. Run `docker compose up -d --build`. The rebuild bakes the Supabase URL into the website.

## Let others reach it while your PC is on (optional)

http://localhost:8080 only works on your own computer. Other devices on your Wi-Fi can use `http://<your PC's IP>:8080`; find the IP with `ipconfig`.
For a public link without opening router ports, a free Cloudflare Tunnel works:

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8080
```

It prints a `https://….trycloudflare.com` link that works while the command runs. Your PC has to stay on; for always-on hosting, use the AWS deploy in `docs/DEPLOY.md`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `error during connect` / `docker daemon is not running` | Open Docker Desktop and wait until it says "Engine running" |
| `port is already allocated` | Something else uses 8080, 8000 or 27018. Stop it, or change the left-hand port in `docker-compose.yml` |
| The site loads but shows no courses | Run `docker compose run --rm scraper` |
| `/api/health` says Supabase isn't configured | Expected until you add Supabase keys to `.env` |
| Code changes don't show up | `docker compose up -d --build` |
