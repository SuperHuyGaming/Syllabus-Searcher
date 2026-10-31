# Deploying to AWS for $0

Everything deploys from GitHub Actions, so nothing needs installing on your computer.
Do the steps in order. Expect about an hour the first time, mostly spent creating accounts.

## 1. AWS account and a safety net

1. Create an AWS account at aws.amazon.com.
2. **Set a budget alert first.** Billing and Cost Management → Budgets → Create budget → "Zero spend budget". AWS then emails you as soon as anything costs even $0.01.
3. Create a deploy user: IAM → Users → Create user `github-deploy` → Attach policies directly → `AdministratorAccess`.
   It needs broad rights because the template creates IAM roles, Lambda, DynamoDB, S3 and CloudFront.
4. Open the user → Security credentials → Create access key → "Application running outside AWS".
   Copy the **Access key ID** and **Secret access key**. Don't share them anywhere public.

The Free Plan for new accounts lasts 6 months. After that, AWS asks you to switch to a paid plan to keep the account. Everything in this project stays inside the *always-free* limits, so it should still cost $0, and the budget alert tells you if that ever changes.

## 2. MongoDB Atlas (syllabus files)

1. Create a free account at mongodb.com/atlas, then create an **M0 (Free)** cluster in AWS `us-east-1`.
2. Database Access → add a user with a long random password and the "Read and write to any database" role.
3. Network Access → Add IP Address → `0.0.0.0/0`. Lambda has no fixed IP without a paid NAT gateway, so the strong password is what protects the database.
4. Connect → Drivers → copy the connection string and put your password in it. This is `MONGODB_URI`.

## 3. Supabase (upload queue and admin login)

1. Create a free project at supabase.com.
2. SQL editor → paste and run `infra/supabase/schema.sql`.
3. Authentication → Users → Add user with your own email.
4. Project Settings → API: copy the **Project URL**, the **anon** key and the **service_role** key.

## 4. Azure Document Intelligence (optional)

Create a Document Intelligence resource on the **Free F0** pricing tier, then copy its endpoint and key. Skip this step and uploads still work; they just aren't read automatically.

## 5. GitHub secrets

Repo → Settings → Secrets and variables → Actions → **New repository secret** for each:

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | from step 1 |
| `AWS_SECRET_ACCESS_KEY` | from step 1 |
| `MONGODB_URI` | from step 2 |
| `SUPABASE_URL` | from step 3 |
| `SUPABASE_ANON_KEY` | from step 3 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 3 |
| `ADMIN_EMAILS` | your email |
| `ORIGIN_SECRET` | any random 32+ characters |
| `IP_HASH_SALT` | any random 16+ characters |
| `AZURE_DI_ENDPOINT`, `AZURE_DI_KEY` | from step 4, or leave out |

To make random strings in PowerShell: `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})`

## 6. Deploy

1. Actions tab → **Deploy** → Run workflow. The first run takes about 5–10 minutes, mostly waiting for CloudFront.
2. The run summary shows your site URL, which looks like `https://d1234abcd.cloudfront.net`.
3. **Switch CloudFront to the Free plan:** CloudFront console → Pricing plans (or your distribution → Pricing plan) → choose **Free**.
   This is what guarantees no overage charges. It can't be done from the template.
4. Actions → **Scrape syllabi** → Run workflow, which loads the syllabi into DynamoDB and Atlas.
5. Settings → Secrets and variables → Actions → **Variables** → add `SITE_URL` with your site URL.
   This turns on the keep-alive workflow so Supabase and Atlas don't pause.
6. In Supabase, Authentication → URL Configuration, set the Site URL to your site URL and add `<site URL>/admin` as a redirect URL.

## What runs automatically after that

- **CI**: tests, lint and a Docker build on every push.
- **Scrape syllabi**: Mondays at 09:00 UTC.
- **Keep alive**: every 3 days.

GitHub turns off scheduled workflows in a repo with no commits for 60 days. If that happens, re-enable them from the Actions tab.

## Why it stays free

| Service | Always-free limit | How this project stays under it |
|---|---|---|
| Lambda | 1M requests, 400k GB-seconds a month | CloudFront caches course pages for an hour and files forever |
| DynamoDB | 25 read and 25 write units, 25 GB | Provisioned at 5/5, so it slows down instead of billing |
| CloudFront Free plan | $0 a month, no overage | Flat rate |
| CloudWatch Logs | 5 GB | Logs are kept for 7 days |
| Atlas M0 / Supabase / Azure F0 | Free tiers | Files capped at 4 MB; Azure reads the first pages only |

The only S3 storage is the website itself (a few MB) and SAM's deploy artifacts, which come to a fraction of a cent. Watch the budget alert for the first month to confirm the bill stays at $0.

To take everything down: CloudFormation → `syllabus-searcher` → Delete. Empty the site bucket first.
