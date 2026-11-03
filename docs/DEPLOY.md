# Deploying to AWS for $0

Everything deploys from GitHub Actions, so nothing needs installing on your computer.
Do the steps in order. Expect about an hour the first time, mostly spent creating accounts.

There are two copies of the site:

| Branch | Environment | AWS stack | Mongo database | Supabase project |
|---|---|---|---|---|
| `develop` | **staging**, for trying changes | `syllabus-searcher-staging` | `syllabus_searcher_staging` | its own free project |
| `main` | **production**, what students use | `syllabus-searcher` | `syllabus_searcher` | its own free project |

Both share one AWS account and one Atlas cluster, and both stay inside the free tiers (see the table at the end).
Set up **staging first**, check it works, then repeat steps 3, 5 and 6 for production.

## How changes reach the site

1. Work on a branch off `develop` (`git switch develop && git switch -c feature/my-change`).
2. Open a pull request into `develop`. CI runs the tests on it.
3. Merge it. CI runs again on `develop`, and when it passes, **Deploy** updates staging.
4. Check the change on the staging site.
5. Open a pull request from `develop` into `main` and merge it. Once CI passes, **Deploy** updates production.

`main` is protected: it only changes through a pull request with CI passing. Data is separate too: approving an upload on staging never touches production.

## 1. AWS account and a safety net

1. Create an AWS account at aws.amazon.com.
2. **Set a budget alert first.** Billing and Cost Management → Budgets → Create budget → "Zero spend budget". AWS then emails you as soon as anything costs even $0.01.
3. Create a deploy user: IAM → Users → Create user `github-deploy` → Attach policies directly → `AdministratorAccess`.
   It needs broad rights because the template creates IAM roles, Lambda, DynamoDB, S3 and CloudFront.
4. Open the user → Security credentials → Create access key → "Application running outside AWS".
   Copy the **Access key ID** and **Secret access key**. Don't share them anywhere public.

**Region:** a Free plan account is locked to one region, shown in the top-right of the console (for example Ohio, `us-east-2`). Set the repo variable `AWS_REGION` to it (Settings → Secrets and variables → Actions → Variables) before deploying, or the deploy is denied by the account's organization policy. Atlas can be in any region.

The Free Plan for new accounts lasts 6 months. After that, AWS asks you to switch to a paid plan to keep the account. Everything in this project stays inside the *always-free* limits, so it should still cost $0, and the budget alert tells you if that ever changes.

## 2. MongoDB Atlas (syllabus files)

1. Create a free account at mongodb.com/atlas, then create an **M0 (Free)** cluster on AWS in the region closest to your `AWS_REGION` (any US East region is fine).
2. Database Access → add a user with a long random password and the "Read and write to any database" role.
3. Network Access → Add IP Address → `0.0.0.0/0`. Lambda has no fixed IP without a paid NAT gateway, so the strong password is what protects the database.
4. Connect → Drivers → copy the connection string and put your password in it. This is `MONGODB_URI`.

One cluster serves both environments: each uses its own database (`syllabus_searcher_staging` and `syllabus_searcher`), which the workflows pick automatically. Use the same `MONGODB_URI` for both.

## 3. Supabase (upload queue and admin login)

Make **one project per environment** (the free plan allows two), e.g. `syllabus-searcher-staging` and `syllabus-searcher`, so staging uploads and sign-ins stay out of production. For each:

1. Create a free project at supabase.com.
2. SQL editor → paste and run `infra/supabase/schema.sql`.
3. Authentication → Users → Add user with your own email and a password.
4. Project Settings → API: copy the **Project URL**, the **anon** key and the **service_role** key.

## 4. Azure Document Intelligence (optional)

Create a Document Intelligence resource on the **Free F0** pricing tier, then copy its endpoint and key. Skip this step and uploads still work; they just aren't read automatically.

## 5. GitHub environments and secrets

Repo → Settings → **Environments** → New environment, twice: `staging` and `production`.
In `production`, under Deployment branches and tags, choose "Selected branches" and add `main`, so nothing else can deploy there.

Then in each environment → **Add environment secret** for each row. Values marked *same* can be copied between the two; the rest must differ.

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | from step 1 (*same*) |
| `AWS_SECRET_ACCESS_KEY` | from step 1 (*same*) |
| `MONGODB_URI` | from step 2 (*same*) |
| `SUPABASE_URL` | this environment's Supabase project |
| `SUPABASE_ANON_KEY` | this environment's Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | this environment's Supabase project |
| `ADMIN_EMAILS` | your email |
| `ORIGIN_SECRET` | any random 32+ characters (different per environment) |
| `IP_HASH_SALT` | any random 16+ characters (different per environment) |
| `AZURE_DI_ENDPOINT`, `AZURE_DI_KEY` | from step 4, or leave out |
| `AI_API_KEY` | Gemini API key from aistudio.google.com/apikey (*same*), or leave out to turn the AI check and syllabus summaries off |
| `AI_FALLBACK_API_KEY` | Groq API key from console.groq.com/keys (*same*), or leave out |

Optional environment variables (not secrets): `AI_PROVIDER` (`gemini` or `groq`, default `gemini`), `AI_MODEL`, `AI_FALLBACK_PROVIDER` (set it to `groq` to use the fallback key), `AI_FALLBACK_MODEL`. Empty models use the defaults in `api/src/lib/ai.js`.

To make random strings in PowerShell: `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})`

Until an environment has its secrets, deploys and scrapes for it are skipped with a note instead of failing.

## 6. Deploy

Do this for `staging` first, then `production`.

1. Actions tab → **Deploy** → Run workflow → pick the branch (`develop` for staging, `main` for production) and the environment. After the first time, pushes deploy on their own once CI passes. The first run takes about 5–10 minutes, mostly waiting for CloudFront.
2. The run summary shows the site URL, which looks like `https://d1234abcd.cloudfront.net`.
3. **Switch CloudFront to the Free plan:** CloudFront console → Pricing plans (or the distribution → Pricing plan) → choose **Free**.
   This is what guarantees no overage charges. It can't be done from the template. If AWS won't put a second distribution on the Free plan, delete the staging stack when you're not using it (CloudFormation → `syllabus-searcher-staging` → Delete; empty its site bucket first) and redeploy it when needed.
4. Actions → **Scrape syllabi** → Run workflow → pick the environment. This loads the course catalog and syllabi into its DynamoDB table and database.
   Then Actions → **Summarize syllabi** → Run workflow writes the course page summaries, up to 40 files per run (run it again until the summary says none are left). It also runs every Monday after the scrape.
5. Settings → Environments → the environment → **Add environment variable** `SITE_URL` with the site URL.
   This turns on the keep-alive workflow for it, so its Supabase project and Atlas don't pause.
6. In that environment's Supabase project, Authentication → URL Configuration, set the Site URL to the site URL and add `<site URL>/admin` as a redirect URL.

## 7. Short address on Render (optional)

A free Render static site gives each environment an easier address than CloudFront's and redirects every visit there. Nothing changes on AWS.

1. render.com → sign in with GitHub → project "Syllabus Searcher" with environments Production and Staging.
2. In each environment, **New → Static Site** from this repo:

   | | Production | Staging |
   |---|---|---|
   | Name (becomes the subdomain) | `findmysyllabus` | `findmysyllabus-staging` |
   | Branch | `main` | `develop` |
   | Build command | (empty) | (empty) |
   | Publish directory | `render/production` | `render/staging` |

   Under Advanced → Build Filters, include only `render/**` so other pushes don't redeploy it.
3. The site → **Redirects/Rewrites** → add: source `/*`, destination `https://<CloudFront address>/*`, action **Redirect** (`*` in the destination is the rest of the path).
   Render skips rules for paths that have a file, so `/` gets `index.html`, which does the same redirect in the browser.

The address bar ends up on CloudFront, so Supabase and `SITE_URL` keep the CloudFront address.

## What runs automatically after that

- **CI**: tests, lint and a Docker build on every push to `develop` or `main` and on every pull request.
- **Deploy**: after CI passes on `develop` (staging) or `main` (production).
- **Scrape syllabi**: Mondays at 09:00 UTC, for both environments.
- **Keep alive**: every 3 days, for both environments.

GitHub turns off scheduled workflows in a repo with no commits for 60 days. If that happens, re-enable them from the Actions tab.

## Why it stays free

| Service | Always-free limit | How this project stays under it |
|---|---|---|
| Lambda | 1M requests, 400k GB-seconds a month (shared by both stacks) | CloudFront shares course pages for a minute and files forever |
| DynamoDB | 25 read and 25 write units, 25 GB | Each stack's table is provisioned at 5/5 (10/10 total), so it slows down instead of billing |
| CloudFront Free plan | $0 a month, no overage | Flat rate |
| CloudWatch Logs | 5 GB | Logs are kept for 7 days |
| Atlas M0 / Supabase / Azure F0 | Free tiers | Files capped at 4 MB; Azure reads the first pages only |

The only S3 storage is the website itself (a few MB) and SAM's deploy artifacts, which come to a fraction of a cent. Watch the budget alert for the first month to confirm the bill stays at $0.

To take everything down: CloudFormation → `syllabus-searcher` (and `syllabus-searcher-staging`) → Delete. Empty each site bucket first.
