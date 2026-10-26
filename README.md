# FX Analysis Desk

An automated system that produces connected FX analysis and reviews: a **weekly analysis**, a **daily analysis**,
a **previous-session review** and a **weekly review**. It runs on Vercel with a full dashboard.
**Analysis only, never trading advice.**

Instruments: GBP/USD, EUR/USD, AUD/USD, NZD/USD, USD/CHF, gold, DXY and the Nasdaq-100. Times are shown in EAT (Africa/Kampala).

## How it works

| Part | What it does |
|---|---|
| **Prices** | Yahoo Finance daily, weekly and hourly bars, used exactly as published (free, no key). Code calculates ATR, moving averages, confirmed swing points, structure and the close-based break rules from them. |
| **Calendar** | Forex Factory's free weekly export (schedule, consensus, previous). Actual results come from Claude's web search, with the source URL, or from you. Every value is kept in an append-only history. |
| **Central banks** | Official RSS feeds from the Fed, ECB, BoE, RBA, RBNZ and SNB. |
| **News** | Claude's web search (each item keeps its URL; any URL that did not come back from a search is dropped), plus headlines you enter. |
| **Fact bundle** | Everything a report may state, each item with an ID (`F#` facts, `L#` levels, `E#` events, `P#` policy/news). Data is taken strictly as of the cutoff, so nothing from after the cutoff can leak in. |
| **Writer** | Claude writes the section text from the bundle as structured JSON and cites the IDs. Code renders the title, bias line, tables, sources and footer. |
| **Checks** | Advice and jargon detection, citation and number matching, integrity checks (in-line results described as surprises, unconfirmed breaks, causal claims), continuity, direction and length checks, plus a second Claude pass that reviews the draft. Claude gets one revision pass. |
| **Publication** | Published versions are written create-only, so the store refuses any overwrite. Corrections and updates become new versions with a change note. |
| **Evaluation** | Reviews assess the *original* published outlook. The directional assessment (Supported / Not supported / Mixed / Inconclusive) and the conditional outcomes (Confirmed, Briefly reached, etc.) use configured ATR thresholds. No trades, P&L or win rates are calculated. |
| **Continuity** | Each report reads the stored outlooks published before its cutoff. An outlook change log tracks how the view moved through the week. |

## Deploy on Vercel (free Hobby plan)

1. **Import:** at vercel.com choose **Add New → Project**, import this repository and click **Deploy**.
2. **Storage:** in the project open **Storage → Create → Blob**, create a store and connect it to the project.
   This adds `BLOB_READ_WRITE_TOKEN` automatically. If you choose a *private* store, also set `BLOB_ACCESS=private`.
3. **Environment variables** (**Settings → Environment Variables**):
   - `ANTHROPIC_API_KEY`: your Claude API key
   - `ADMIN_TOKEN`: a password for changes made from the dashboard (publishing, editing, generating)
   - `CRON_SECRET`: any long random string (Vercel Cron sends it automatically)
   - optional `PROTECT_READS=1` to require the token for viewing too
4. **Redeploy:** go to **Deployments → ⋯ → Redeploy** so the variables take effect.
5. **Open the site** and click the key icon to enter your `ADMIN_TOKEN`. Then click **Configure → Run a job now**,
   or open a slot and click **Generate draft**.

### Schedule (Vercel Cron, `vercel.json`)

| Cron (UTC) | EAT | Reports |
|---|---|---|
| `0 3 * * 2-6` | 06:00 Tue–Sat | Review of the previous session |
| `0 5 * * *` | 08:00 daily | Daily analysis Mon–Fri · Weekly review Sat · Weekly analysis Sun (for the coming week) |

Each cron run refreshes the calendar and central-bank feeds once. It then starts one function per instrument, so
each report gets its own five-minute budget. On the Hobby plan a cron job can start up to an hour late, and every
report records its real publication time.

**Publication mode** (Configure): *automatic* is the default, so drafts that pass every check are published by the
schedule. Anything with a blocking finding stays a draft for you to fix and publish. *Manual* keeps everything as a draft.

## Dashboard

- Week timeline with the status of every report slot, plus the outlook change log
- Report preview with clickable citations and pre-publication checks; editing, publishing, corrections and timestamped updates
- Evidence panel, economic calendar (you can add actuals), technical levels (yours or confirmed screenshot readings)
- Outlook evaluation history
- Chart screenshot reading: Claude reads the levels, which stay approximate until you confirm them
- Markdown export, PDF export (the browser's *Save as PDF*), and Configure (publication mode, run a job, terminology, headlines)

## Change things

- **`lib/config.ts`:** instruments, which instruments the schedule writes (`scheduled`; fewer means cheaper),
  Claude models and effort, technical and break rules, evaluation thresholds, report lengths
- **`lib/reports/prompts.ts`:** the writer's, reviewer's and researcher's instructions
- **`lib/reports/templates.ts`:** report sections and headings
- **Configure → Terminology:** approve or prohibit terms

**Cost:** Claude is the only paid part. Each report makes one research call (Sonnet with web search), one writing
call (Opus, sometimes plus a revision) and one review call (Sonnet). Expect roughly $0.15–0.40 per report. Vercel
Hobby, Blob and Cron are free within their limits; usage is shown on the Vercel **Usage** tab.

**Limits:**
- Yahoo Finance is unofficial and meant for personal use. Gold uses COMEX futures (GC=F), and its reports say so.
- Forex Factory's export has no actual results. Actuals come from web search (cited) or from you; until then a release shows as "not yet verified".

## Develop

```bash
npm install
npm test                     # deterministic core, checks, and the full pipeline on fixture data
DATA_SOURCE=fixture npm run dev   # synthetic, clearly labelled data; reports are stored in .data/
```

`scripts/live-check.ts` (GitHub Actions workflow **live-check**) checks the real free sources with the offline
writer and pushes the results to the `live-check` branch.

The first Python/React version is kept in `legacy-python/` for reference. It is not deployed.
