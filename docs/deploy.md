# Free hosting

Recommended: **Koyeb (app) + Neon (database) + GitHub Actions (schedule)**. Render works the same way via `render.yaml` if you have free capacity there.

## Koyeb (free instance)

The free instance has 512 MB RAM and 0.1 vCPU, runs in Frankfurt or Washington, and scales to zero after an hour without traffic.

1. **Neon:** create a project in AWS Frankfurt (eu-central-1) and copy the connection string.
2. **Koyeb:** sign up with GitHub, then choose **Create Service → Web service → GitHub** and select `ComsCat-72/fx-analysis-desk`, branch `main`.
3. **Builder:** Dockerfile (path `Dockerfile`, no build arguments, no command override).
4. **Instance:** Free, region Frankfurt.
5. **Ports:** 8000, HTTP, route `/`. **Health check:** HTTP on port 8000, path `/api/health`. Allow a generous grace period (about 60s), because migrations run on start.
6. **Environment variables** (use *Secret* for keys):
   - `DATABASE_URL`: the Neon string.
   - `ADMIN_TOKEN`: a long random string.
   - `APP_ENV`: `production`.
   - `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`, `OANDA_ENVIRONMENT=practice`, `ANTHROPIC_API_KEY`, and optionally `FRED_API_KEY`.

   Demo without OANDA: `APP_ENV=development`, `PRICE_PROVIDER=fixture`, `CALENDAR_PROVIDER=fixture`.
7. **Deploy.** The public URL is `https://<service>-<org>.koyeb.app`. Then do step 4 (GitHub schedule secrets) below, using that URL as `APP_URL`.

# Render + Neon + GitHub Actions (alternative)

| Part | Service (free plan) | Why |
|---|---|---|
| App (API + dashboard) | Render web service, Docker, `render.yaml` | Free; deploys from GitHub. Sleeps after ~15 min idle and takes up to a minute to wake. |
| Database | Neon Postgres | Free tier doesn't expire. (Render's free Postgres is deleted after 30 days.) |
| Scheduled reports | GitHub Actions (`.github/workflows/schedule.yml`) | A sleeping free service can't run its own scheduler, so Actions wakes it and calls `/api/jobs/run`. |

## Steps

1. **Neon:** sign up at neon.tech, create a project (region: Frankfurt is nearest to East Africa), and copy the connection string (`postgresql://...?sslmode=require`).
2. **Render:** sign up at render.com with GitHub, choose **New → Blueprint**, and pick this repository. Render reads `render.yaml`. Then fill in:
   - `DATABASE_URL`: the Neon string.
   - `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`, `ANTHROPIC_API_KEY`, and `FRED_API_KEY` (optional).
   - `ADMIN_TOKEN` is generated for you; copy it from the service's Environment tab.
3. Open `https://<service>.onrender.com`. Click the key icon and paste the admin token to enable drafting and publishing.
4. **Schedules:** in GitHub, open the repo's Settings → Secrets and variables → Actions:
   - Secrets: `APP_URL` = `https://<service>.onrender.com`, `ADMIN_TOKEN` = the same token.
   - Variable (optional): `INSTRUMENTS` = `GBP_USD EUR_USD AUD_USD NZD_USD USD_CHF XAU_USD`.
   - Run **Report schedule** once by hand (Actions → Run workflow) to check it.
5. Initial history: from the dashboard, *Configure → Ingest prices* for each instrument (about 90 days).

## Notes

- `APP_ENV=production` refuses development fixtures. For a labelled demo before you have an OANDA token, set `APP_ENV=development` and `PRICE_PROVIDER=fixture`. Every report then carries the DEVELOPMENT FIXTURE banner.
- Uploaded screenshots are stored on the container's disk, which free Render instances lose on restart. Levels you confirm from them are saved in the database and survive.
- Scheduled GitHub runs can start a few minutes late. Each report records its actual data cutoff, so lateness never changes what the report claims.
- Publication mode stays **manual** unless you turn on automatic publication in *Configure*. With manual mode, scheduled jobs create drafts for you to review and publish.
