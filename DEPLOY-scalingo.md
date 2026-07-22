# Deploying CrawlSEO on Scalingo

Scalingo is a fully-managed French PaaS (Strasbourg, EU data). You connect this
repo, it builds and runs the app, and the database, HTTPS, and scheduled jobs
are handled for you — no server to maintain.

This repo is already prepared for Scalingo:
- Builds from the existing **Dockerfile** (migrations run automatically on boot).
- **`scalingo.json`** describes the env vars and app formation.
- **`cron.json`** schedules the GSC/vitals syncs and alert checks for you.
- The database URL is auto-detected (`SCALINGO_POSTGRESQL_URL` → `DATABASE_URL`).

## One-time: Google OAuth

1. In [Google Cloud Console](https://console.cloud.google.com/): create an OAuth
   **Web application** client.
2. Enable the **Search Console API**, **URL Inspection API**, and **PageSpeed
   Insights API**.
3. Keep the Client ID and Client Secret handy. You'll add the redirect URI in
   step 5 below once you know your app's URL.

## Deploy

1. **Create the app.** Sign in to [Scalingo](https://scalingo.com), create a new
   app in region **osc-fr1** (Paris) — or **osc-secnum-fr1** if you want
   SecNumCloud. Name it e.g. `crawlseo`.

2. **Add the database.** In the app's **Resources / Addons**, add
   **PostgreSQL** (the *Starter 1GB* plan is plenty to begin with). Nothing else
   to configure — the app finds it automatically.

3. **Set environment variables** (app **Settings → Environment**):

   | Variable | Value |
   |---|---|
   | `NEXTAUTH_SECRET` | `openssl rand -hex 32` |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `GOOGLE_CLIENT_ID` | from Google |
   | `GOOGLE_CLIENT_SECRET` | from Google |
   | `NEXTAUTH_URL` | your app URL, e.g. `https://crawlseo.osc-fr1.scalingo.io` |
   | `GOOGLE_PAGESPEED_KEY` | *(optional)* higher CWV quota |

   (You don't set `DATABASE_URL` — the Postgres addon provides it.)

4. **Connect this repo.** In **Deploy**, link GitHub, pick this repository and
   the **`patches/security-and-scheduling`** branch, and enable **auto-deploy**.
   Trigger the first deploy. Scalingo builds the Dockerfile and, on startup,
   runs `prisma migrate deploy` to create the schema — no manual migration step.

   *(CLI alternative: `scalingo --app crawlseo git-push` after adding the remote.)*

5. **Finish Google OAuth.** Copy your live URL and add
   `https://<your-app>.osc-fr1.scalingo.io/api/auth/callback/google` as an
   authorized redirect URI in the Google OAuth client. Set `NEXTAUTH_URL` to
   that same base URL if you haven't already.

6. **Scheduler.** `cron.json` is detected automatically — Scalingo will POST to
   `/api/cron` hourly (GSC + alerts) and daily (vitals). Check **Cron tasks** in
   the dashboard to confirm the two jobs are listed. Nothing else to wire up.

## Verify

- Open the app URL, sign in with Google, **Add Site**, pick a GSC property.
- After a few minutes the dashboard shows GSC data; run a crawl from the Crawl
  page.
- In the Scalingo dashboard, check **Logs** for `prisma migrate deploy` success
  on the first boot and for cron runs on the hour.

## Adding more apps (yours or clients')

Repeat "Create the app" for each project — one Scalingo app + its own
PostgreSQL addon per client. Each is fully isolated (separate app, separate
database, separate domain), which is the right boundary for client data. Deploy
the same repo to each; they don't share anything.

## Sizing & cost

- **Container**: start at size **M** (~1 GB) — enough for the app plus a crawl.
  Bump to **L** if you run large (2,000-page) crawls often.
- **Database**: Starter 1GB to begin; scale the plan up as keyword/page history
  grows (the tables accumulate daily rows).
- Rough all-in per app: **~€25–45/month**. Check the live figures on
  [Scalingo pricing](https://scalingo.com/pricing) — a 30-day free trial covers
  your first deploy.
