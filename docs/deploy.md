# Free hosting: Vercel (or Render) + Neon + GitHub Actions

| Part | Service (free plan) | Why |
|---|---|---|
| App (API + dashboard) | Vercel Hobby: `vercel.json`, `api/index.py` | Free; deploys from GitHub. The dashboard is served as static files and the API runs as one Python function. No sleeping server. |
| Database | Neon Postgres | Free tier doesn't expire. |
| Scheduled reports | GitHub Actions (`.github/workflows/schedule.yml`) | A serverless function can't run its own scheduler, so Actions calls `/api/jobs/run`. |

Render (Docker, `render.yaml`) still works as an alternative. See [the end of this page](#alternative-render).

## Steps (Vercel)

1. **Neon:** you need a Postgres connection string (`postgresql://...?sslmode=require`). Use the **pooled** one; its host contains `-pooler`.
   - If your Neon account is managed by Vercel, create the database from Vercel: *Storage → Create → Neon*, then connect it to this project. Vercel then sets `DATABASE_URL` for you.
   - Otherwise, create a project at neon.tech (Frankfurt is nearest to East Africa) and copy the string.
2. **Vercel:** sign in at vercel.com with GitHub, choose **Add New → Project**, and import this repository. Leave the framework preset as *Other*; `vercel.json` sets the build. Under *Environment Variables* add:
   - `APP_ENV` = `production`, `DATABASE_URL` = the Neon string (unless step 1 already added it).
   - `ADMIN_TOKEN` = a long random string (for example the output of `openssl rand -base64 32`).
   - `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`, `OANDA_ENVIRONMENT` (`practice` or `live`), `ANTHROPIC_API_KEY`, and `FRED_API_KEY` (optional).
3. Deploy. The function applies database migrations on each cold start, so there is no separate migration step. Check `https://<project>.vercel.app/api/health` returns `{"ok":true}`.
4. Open `https://<project>.vercel.app`. Click the key icon and paste the admin token to enable drafting and publishing.
5. **Schedules:** in GitHub, open the repo's Settings → Secrets and variables → Actions:
   - Secrets: `APP_URL` = `https://<project>.vercel.app`, `ADMIN_TOKEN` = the same token.
   - Variable (optional): `INSTRUMENTS` = `GBP_USD EUR_USD AUD_USD NZD_USD USD_CHF XAU_USD`.
   - Run **Report schedule** once by hand (Actions → Run workflow) to check it.
6. Initial history: from the dashboard, *Configure → Ingest prices* for each instrument (about 90 days).

### Vercel limits to know

- **PDF export is unavailable.** WeasyPrint needs the Pango system library, which Vercel's Python runtime lacks, so `export.pdf` returns 501. Markdown export works. Use the Docker/Render deployment if you need PDFs.
- **Requests stop after 300 s** (`maxDuration` in `vercel.json`, the Hobby maximum). That's plenty for one report; the schedule workflow calls each instrument separately.
- **Uploaded screenshots are temporary.** They are written to `/tmp` and lost when the function instance is recycled. Levels you confirm from them are saved in the database and survive.
- Python dependencies for Vercel are listed in the root `requirements.txt`. Keep it in step with `backend/requirements.txt`.

## Notes

- `APP_ENV=production` refuses development fixtures. For a labelled demo before you have an OANDA token, set `APP_ENV=development` and `PRICE_PROVIDER=fixture`. Every report then carries the DEVELOPMENT FIXTURE banner.
- Scheduled GitHub runs can start a few minutes late. Each report records its actual data cutoff, so lateness never changes what the report claims.
- Publication mode stays **manual** unless you turn on automatic publication in *Configure*. With manual mode, scheduled jobs create drafts for you to review and publish.

## Alternative: Render

Render's free web service sleeps after about 15 minutes idle and takes up to a minute to wake (the schedule workflow wakes it first). Free hours are limited per workspace.

1. Choose **New → Blueprint** at render.com and pick this repository. Render reads `render.yaml`.
2. Fill in `DATABASE_URL` (the Neon string) and the API keys listed in step 2 above. `ADMIN_TOKEN` is generated for you; copy it from the service's Environment tab.
3. Uploaded screenshots are stored on the container's disk, which free Render instances lose on restart.
4. Continue from step 4 above, using `https://<service>.onrender.com`.
