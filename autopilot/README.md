# Autopilot: Claude writes the reports, GitHub publishes them

No server, no database. Everything runs in GitHub Actions on a schedule (EAT):

| When (EAT) | Reports written for every instrument |
|---|---|
| Sunday 20:00 | Weekly analysis for the coming week |
| Monday 07:30 | Daily analysis |
| Tuesday–Friday 07:30 | Review of the previous session + daily analysis |
| Saturday 10:00 | Review of Friday + weekly review |

For each report, `generate.py` gives Claude:
- **Prices:** Yahoo Finance daily bars, used exactly as published, plus the latest price.
- **Calendar:** this week's high- and medium-impact events (Forex Factory feed), with times converted to EAT.
- **Continuity:** the reports already published this week, and last week's review, so biases are quoted exactly and reviews compare against the original analysis.
- **Web search:** Claude searches for current news, central-bank communication and data results itself, and cites every source.

Each report is checked for trading-advice wording and banned jargon; if anything is found, Claude rewrites it once.
It is then saved as `reports/<INSTRUMENT>/<date>_<kind>.md` and the website is rebuilt and published to GitHub Pages.

## Setup (once)
1. **Claude API key:** create one at console.anthropic.com. In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret** and save it as `ANTHROPIC_API_KEY`.
2. **GitHub Pages:** go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **First reports:** go to **Actions → Autopilot reports → Run workflow** (pick a report type, or leave it empty for whatever is due today).

The site is at `https://<your-github-name>.github.io/fx-analysis-desk/`.

## Settings (`autopilot/config.yaml`)
- `scheduled_instruments`: which instruments run on schedule. Fewer instruments cost less.
- `effort`: `low`, `medium` or `high`.
- `web_searches_per_report`: how many searches Claude may make per report.
- `model`: the Claude model.

The writing rules and templates are in `autopilot/prompt.md`.

**Cost:** roughly $0.10–0.25 per report at medium effort with 5 searches, depending on length. All 8 instruments × about 10 reports a week comes to about $10–20 a month.

**Gold:** Yahoo has no free spot gold, so gold uses COMEX gold futures (GC=F), and its reports say so.
