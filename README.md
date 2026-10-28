# FX Analysis Desk

An automated system that produces connected FX analysis and reviews: a **weekly analysis**, a **daily analysis**,
a **previous-session review** and a **weekly review**. It runs on Vercel with a full dashboard.
**Analysis only, never trading advice.**

Instruments: GBP/USD, EUR/USD, AUD/USD, NZD/USD, USD/CHF, gold, DXY and the Nasdaq-100. Times are shown in EAT (Africa/Kampala)
by default; Africa/Kigali (CAT) or any other IANA zone can be chosen in **Configure → Display timezone**.

**Free by default.** Everything runs on free sources and the free Vercel Hobby plan: no API keys or paid services are needed.
Claude is an optional, paid add-on for prose-quality writing (see below).

## How it works

| Part | What it does |
|---|---|
| **Prices** | Yahoo Finance daily, weekly and hourly bars, used exactly as published (free, no key). Code calculates ATR, moving averages, confirmed swing points, structure and the close-based break rules from them. |
| **Calendar** | Forex Factory's free weekly export (schedule, consensus, previous). Actual results are entered by you in the calendar panel, with their source; until then a release shows as "not yet verified". Every value is kept in an append-only history. |
| **Central banks** | Official RSS feeds from the Fed, ECB, BoE, RBA, RBNZ and SNB. |
| **Headlines** | Reuters and WSJ headlines from free RSS feeds (WSJ's public feeds; Reuters through Google News RSS restricted to reuters.com). Title, link and time only: articles are never read, and reports label them "headline only". Each headline is tagged with currencies by keyword (`lib/config.ts → headlines`). You can also enter headlines yourself. |
| **Fact bundle** | Everything a report may state, each item with an ID (`F#` facts, `L#` levels, `E#` events, `P#` policy/news). Data is taken strictly as of the cutoff, so nothing from after the cutoff can leak in. |
| **Writer** | Default: the free **rule-based writer** (`lib/reports/templateWriter.ts`). Every sentence is assembled in code from cited bundle items: the two economies separately, released vs scheduled data, result vs consensus, continuity through the week, conditional outlooks, "coincided with" explanations (never causal claims) and a rule-based lesson of the week. Optional: Claude writes the sections from the same bundle (Configure → Report writer, needs `ANTHROPIC_API_KEY`). Code renders the title, bias line, event and scenario tables, sources and footer either way. |
| **Checks** | Advice and jargon detection, citation and number matching, integrity checks (in-line results described as surprises, unconfirmed breaks, causal claims), continuity, direction and length checks. With the optional Claude writer, a second Claude pass also reviews the draft and Claude gets one revision pass. |
| **Publication** | Published versions are written create-only, so the store refuses any overwrite. Corrections and updates become new versions with a change note. |
| **Evaluation** | Reviews assess the *original* published outlook. The directional assessment (Supported / Not supported / Mixed / Inconclusive) and the conditional outcomes (Confirmed, Briefly reached, etc.) use configured ATR thresholds. No trades, P&L or win rates are calculated. |
| **Continuity** | Each report reads the stored outlooks published before its cutoff. An outlook change log tracks how the view moved through the week. |

## Deploy on Vercel (free Hobby plan)

1. **Import:** at vercel.com choose **Add New → Project**, import this repository and click **Deploy**.
2. **Storage:** in the project open **Storage → Create → Blob**, create a store and connect it to the project.
   This adds `BLOB_READ_WRITE_TOKEN` automatically. If you choose a *private* store, also set `BLOB_ACCESS=private`.
3. **Environment variables** (**Settings → Environment Variables**):
   - `ADMIN_TOKEN`: a password for changes made from the dashboard (publishing, editing, generating)
   - `CRON_SECRET`: any long random string (Vercel Cron sends it automatically)
   - optional `PROTECT_READS=1` to require the token for viewing too
   - optional `ANTHROPIC_API_KEY`: only if you want the paid Claude writer; then choose it in Configure → Report writer
4. **Redeploy:** go to **Deployments → ⋯ → Redeploy** so the variables take effect.
5. **Open the site** and click the key icon to enter your `ADMIN_TOKEN`. Then click **Configure → Run a job now**,
   or open a slot and click **Generate draft**.

### Schedule (Vercel Cron, `vercel.json`)

| Cron (UTC) | EAT | Reports |
|---|---|---|
| `0 3 * * 2-6` | 06:00 Tue–Sat | Review of the previous session |
| `0 5 * * *` | 08:00 daily | Daily analysis Mon–Fri · Weekly review Sat · Weekly analysis Sun (for the coming week) |

Each cron run refreshes the calendar, central-bank and headline feeds once. It then starts one function per instrument, so
each report gets its own five-minute budget. On the Hobby plan a cron job can start up to an hour late, and every
report records its real publication time.

**Publication mode** (Configure): *automatic* is the default, so drafts that pass every check are published by the
schedule. Anything with a blocking finding stays a draft for you to fix and publish. *Manual* keeps everything as a draft.

## Dashboard

- Overview strip: weekly bias, the selected day's outlook, data freshness (with a fetch button) and the next high-impact release or source conflict
- Week timeline with the status of every report slot, plus the outlook change log
- Report preview with clickable citations and pre-publication checks; editing, publishing, corrections and timestamped updates
- Context panel tabs: evidence, economic calendar (record actuals), technical levels, outlook evaluation history and chart screenshots (levels stay approximate until you confirm them)
- Markdown export, PDF export (the browser's *Save as PDF*), and Configure (publication mode, report writer, display timezone, run a job, terminology, headlines)
- Light and dark themes. Direction is shown with arrows and words, never with buy/sell colours. There are no trade buttons, signals or position tools.

## Calendar page

**Calendar** in the top bar opens a full economic calendar laid out like Forex Factory's: a month grid with quick
links (today, tomorrow, this week, next week…), day/week/month views and an **Up next** marker. You can filter by
currency and impact.

Each row shows the time in your display timezone, the currency and impact, the actual, forecast and previous figures,
and revisions. A row opens to show its value history and a form for recording the actual result. Actuals are green
when better than the forecast for that currency, and red when worse (inverted for unemployment-type releases).
Forex Factory's free feed has no actuals, so they are entered by you, with their source.

## Calculators page

**Calculators** in the top bar has: pip value, position size, margin, profit/loss, risk-reward, pivot points
(Classic, Woodie, Camarilla, Fibonacci, DeMark), Fibonacci retracements and extensions, compounding, drawdown, a
currency converter and forex market hours. Conversion rates come from Yahoo Finance (free), show their time and source,
and can be overridden by hand.

These are general utilities, kept separate from the analysis reports: nothing in `lib/reports` uses `lib/calc`
(a test enforces this), and the reports still never contain trading advice.

## Change things

- **`lib/config.ts`:** instruments, which instruments the schedule writes (`scheduled`; fewer means cheaper),
  Claude models and effort, technical and break rules, evaluation thresholds, report lengths
- **`lib/reports/prompts.ts`:** the writer's, reviewer's and researcher's instructions
- **`lib/reports/templates.ts`:** report sections and headings
- **Configure → Terminology:** approve or prohibit terms

**Cost:** nothing beyond the free Vercel Hobby plan (Blob and Cron are free within its limits; usage is on the Vercel
**Usage** tab). The optional Claude writer costs roughly $0.15–0.40 per report.

## Analytical limitations

- **Prices:** Yahoo Finance is unofficial and meant for personal use. Gold uses COMEX futures (GC=F), not spot XAU/USD, and its reports say so. Daily closes follow each source's own session (stated in every report).
- **Actual results:** Forex Factory's free export has no actuals. A release stays "not yet verified" until you record the actual (with its source) in the calendar panel; reports never guess it. Two different recorded values make the release "conflicting" and interpretation is withheld.
- **Headlines:** titles only. A report can say what a headline reported, not what the article argued. Headlines whose wording fails the advice or terminology checks are left out (the report says how many).
- **Rule-based writer:** it states what the evidence shows and applies fixed rules (bias = confirmed 1H swing structure plus the daily close against SMA(20)). It does not weigh the fundamental narrative the way a human analyst would and never attributes a move to a cause; releases and headlines are described as coinciding with it.
- **Semantic review:** without Claude, only the deterministic checks run (labelled on each draft).
- **Screenshots:** without Claude, levels from a screenshot are entered by hand; nothing is read automatically.
- **Holidays:** sessions without a source bar are flagged as missing; there is no separate holiday calendar beyond Forex Factory's "Holiday" rows.

## Incomplete features

- Actual results are not fetched automatically from official statistical agencies (manual entry, or the optional Claude research step).
- Government-bond yields and commodity/risk-sentiment series are not collected as data; they appear only through headlines and central-bank items.
- Instruments, schedules (`vercel.json`), session rules and technical parameters are changed in `lib/config.ts`, not in the dashboard. The dashboard changes publication mode, writer, display timezone, terminology, headlines, actuals and levels.
- External delivery (email or chat) of reports is not implemented.

## Develop

```bash
npm install
npm test                     # deterministic core, checks, and the full pipeline on fixture data
DATA_SOURCE=fixture npm run dev   # synthetic, clearly labelled data; reports are stored in .data/
```

`scripts/live-check.ts` (GitHub Actions workflow **live-check**) checks the real free sources (prices, calendar,
central banks, headlines) with the rule-based writer and pushes the results to the `live-check` branch.

`scripts/example-week.ts` builds one connected fixture week (weekly analysis, daily analyses, reviews, weekly review);
the output is in [`docs/examples/`](docs/examples). Pass `.data` as the third argument to load that week into the local
development store: `node --experimental-strip-types scripts/example-week.ts GBP_USD docs/examples .data`.

The first Python/React version is kept in `legacy-python/` for reference. It is not deployed.
