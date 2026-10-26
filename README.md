# FX Analysis Desk

Claude writes evidence-based FX analysis and reviews every morning, and they are published on a Vercel site.
**Analysis only, never trading advice.**

- **Reports:** weekly analysis, daily analysis, previous-session review and weekly review for
  GBP/USD, EUR/USD, AUD/USD, NZD/USD, USD/CHF, gold, DXY and the Nasdaq-100.
- **Inputs:** Yahoo Finance daily prices (used exactly as published), this week's economic calendar, the reports already
  published this week (for continuity), and Claude's own web search for news and central-bank updates, with sources cited.
- **Checks:** every report is checked for trading-advice wording and banned jargon, and rewritten once if needed.
- **Stack:** Next.js (TypeScript), the Anthropic SDK, Vercel Blob for storage and Vercel Cron for the schedule. No database or server to manage.

## Deploy on Vercel (free Hobby plan)

1. **Import:** at vercel.com, choose **Add New → Project**, import this repository and click **Deploy**. No settings needed.
2. **Storage:** in the project, open **Storage → Create → Blob**, create a store and connect it to the project.
   This adds `BLOB_READ_WRITE_TOKEN` automatically.
3. **Environment variables** (**Settings → Environment Variables**):
   - `ANTHROPIC_API_KEY`: your Claude API key
   - `ADMIN_TOKEN`: a password for the Generate page
   - `CRON_SECRET`: any long random string
4. **Redeploy:** **Deployments → ⋯ → Redeploy**, so the variables take effect.
5. **First report:** open `/admin` on your site, enter the admin token, choose an instrument and click **Generate**.

After that, the daily cron (07:00 EAT) writes the reports on its own:

| Day | Reports written |
|---|---|
| Sunday | Weekly analysis for the coming week |
| Monday | Daily analysis |
| Tuesday–Friday | Review of the previous session, then the daily analysis |
| Saturday | Review of Friday, then the weekly review |

## Change things

- **`lib/config.ts`:** instruments, `scheduled` (which instruments run daily; fewer = cheaper), model, effort and searches per report.
- **`lib/prompt.ts`:** writing rules and the four report templates.
- **`vercel.json`:** cron time (UTC). `0 4 * * *` = 07:00 EAT.

**Cost:** Claude is the only paid part, roughly $0.10–0.25 per report. All 8 instruments come to about $10–20 a month.
Vercel Hobby, Blob and Cron are free within their limits.

**Limits:**
- Hobby cron runs once a day and may start up to an hour late. Reports still record their real publication time.
- Gold uses COMEX gold futures (Yahoo has no free spot gold), and its reports say so.

## Develop

```bash
npm install
npm test          # wording checks, schedule and continuity logic
npm run dev       # http://localhost:3000; without BLOB_READ_WRITE_TOKEN reports are stored in .data/
```

The previous Python/React version (full dashboard, database, deterministic evaluation) is kept in `legacy-python/` for reference. It is not deployed.
