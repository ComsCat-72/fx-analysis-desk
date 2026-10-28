# FX Analysis Desk

A free FX market desk on Vercel: an economic calendar with actual results as they are released, currency strength,
correlation, COT positioning, central-bank rates, headlines, trading calculators and market hours.
**Market data and tools only, never trading advice.**

**Free.** Every source is free and needs no API key, and the app runs on the free Vercel Hobby plan.
Every time is shown in your browser's timezone.

## Pages

| Page | What it shows | Source |
|---|---|---|
| **Calendar** | This week's releases laid out like Forex Factory's (day, week and month views, filters, **Up next**). Right after a release the Actual column shows "awaiting" and the figure appears as soon as a source has it: the calendar checks every 15 seconds and the server every 20 seconds for 30 minutes after a release, otherwise every minute and every two minutes. Actuals are green or red against the forecast for that currency (inverted for unemployment-type releases), and can also be entered by hand in a row's details. | Forex Factory weekly export (schedule, forecast, previous) · [FXStreet](https://www.fxstreet.com/economic-calendar) and [biquote.io](https://biquote.io) calendars (actuals) |
| **Markets → Currency strength** | USD, EUR, GBP, JPY, AUD, NZD, CAD and CHF ranked by their average % change against the other seven, today (since the 17:00 New York open) and this week, plus all 28 pairs. | Yahoo Finance quotes of the seven USD pairs |
| **Markets → Correlation** | Correlation of daily % changes between the configured FX pairs and gold over 20 and 60 trading days. | Yahoo Finance daily closes |
| **Markets → COT positioning** | Large speculators' and commercials' long, short and net futures positions and the weekly change, for the dollar index, the six currencies and gold. | [CFTC Commitments of Traders](https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm) (Legacy, futures only) |
| **Central banks** | Policy rates of the Fed, ECB, BoE, BoJ, RBA, RBNZ, BoC and SNB, the last change and next decision, the rate differential per pair, and the banks' latest statements and speeches. | biquote.io decisions, the calendar's actuals, the banks' RSS feeds |
| **News** | Reuters and WSJ headlines (title, link, time), filterable by currency. | Free RSS feeds (Reuters through Google News) |
| **Calculators** | Pip value, position size, margin, profit/loss, risk-reward, pivot points, Fibonacci, compounding, drawdown, currency converter. | BabyPips formulas · Yahoo Finance rates |
| **Market hours** | Live clocks for Sydney, Tokyo, London and New York, session open/close countdowns and a time-zone converter. | Session times |

## Deploy on Vercel (free Hobby plan)

1. **Import:** at vercel.com choose **Add New → Project**, import this repository and click **Deploy**.
2. **Storage:** in the project open **Storage → Create → Blob**, create a store and connect it to the project.
   This adds `BLOB_READ_WRITE_TOKEN` automatically. If you choose a *private* store, also set `BLOB_ACCESS=private`.
3. **Environment variables** (**Settings → Environment Variables**):
   - `ADMIN_TOKEN`: a password for changes made from the dashboard (entering an actual by hand)
   - `CRON_SECRET`: any long random string (Vercel Cron sends it automatically)
   - optional `PROTECT_READS=1` to require the token for viewing too
4. **Redeploy:** go to **Deployments → ⋯ → Redeploy** so the variables take effect.

A daily Vercel Cron job (`vercel.json`, `/api/cron/refresh`) refreshes the calendar, actuals, feeds, rate decisions and
the COT report. Pages also refresh what they show whenever it is stale, so the schedule is only a safety net.

## Change things

**`lib/config.ts`:** instruments, the default timezone, headline feeds and their currency keywords, central-bank feeds.

## Limitations

- **Actuals** appear only once FXStreet or biquote.io publishes them, usually within a minute or two of the release. A release neither source covers stays "pending" until you enter it.
- **Prices:** Yahoo Finance is unofficial and meant for personal use. Gold is COMEX gold futures (GC=F), not spot XAU/USD.
- **Central-bank rates** come from recorded decisions over the last year; nothing is estimated. A bank whose latest decision a source has not filled in yet says so.
- **COT** is weekly: positions as of Tuesday, published on Friday.
- **Headlines:** titles only; article text is never fetched.

## Develop

```bash
npm install
npm test
npm run dev
```

`scripts/live-check.ts` and `scripts/probe-sources.ts` (GitHub Actions workflow **live-check**) check every free source
for real and push the results to the `live-check` branch.
