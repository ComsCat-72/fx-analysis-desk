# FX Analysis Desk

Automated, evidence-based FX analysis and reporting: weekly analysis, daily analysis, previous-day review and weekly review, connected to one another and to the data they were written from.

**This is an analysis and reporting system. It does not give trading advice, generate signals, or recommend positions.** Every report states its conclusion, cites its evidence, separates facts from interpretation, and says what would strengthen or weaken the view.

## How it works, briefly

- **Deterministic code computes everything factual:** session candles (17:00 New York close), weekly roll-ups, swings with confirmation times, ATR and moving averages, break and sustained-break rules, release surprises, data-quality checks, and evaluations.
- **Claude writes the text** from a *fact bundle*. Every item in the bundle has an ID (`F3`, `L2`, `E5`, `P1`), and every sentence with a figure must cite one. Numbers that don't match a cited item block publication.
- **Checks run before publication:** advice detection, prohibited terminology, number and citation tracing, integrity (in-line results described as surprises, unconfirmed "sustained" breaks, causal overreach, probabilities with no stated method), continuity, and a second-pass semantic review by Claude.
- **Published reports are immutable**, enforced by both the ORM and database triggers. Corrections and intraday updates become new versions with a change note, and changes of outlook go into an outlook change log. Reviews always compare against the *original* published version and its data cutoff.

See [`docs/architecture.md`](docs/architecture.md) for details, and [`docs/deploy.md`](docs/deploy.md) for free hosting (Render + Neon + GitHub Actions).

## Quick start (offline, development fixtures)

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cp .env.example .env
cd frontend && npm install && npm run build && cd ..

# Build a complete synthetic week (watermarked DEVELOPMENT FIXTURE) and export example reports
cd backend && ../.venv/bin/python -m app.cli demo-week --out ../var/demo

# Serve API + dashboard on that demo database
DATABASE_URL=sqlite:///$(pwd)/../var/demo/demo.db ../.venv/bin/uvicorn app.api.main:app --port 8000
# open http://localhost:8000
```

Fixture prices sit near 1.00000 on purpose, so they can't be mistaken for real quotes. Every fixture report carries a banner, and fixtures are refused when `APP_ENV=production`.

## Running with real data

1. Get a free Twelve Data key (twelvedata.com/pricing) and set `TWELVEDATA_API_KEY` in `.env`. DXY and the Nasdaq-100 come from Yahoo with no key. Without a key, set `PRICE_PROVIDER=yahoo` for FX as well. `ANTHROPIC_API_KEY` is optional: without it, reports use the free built-in template writer.
2. Initialise the database: `cd backend && ../.venv/bin/python -m app.cli init-db`
3. Ingest prices: `python -m app.cli ingest --instrument GBP_USD --from 2026-07-01 --to 2026-10-30`
   (or run the whole chain on live data: `python -m app.cli replay-week --out ../var/live --instruments "GBP_USD DXY NAS100"`)
4. Calendar and central banks: `python -m app.cli calendar` and `python -m app.cli central-banks`
5. Start the API with `uvicorn app.api.main:app` and the scheduler with `python -m app.cli scheduler`, or generate drafts from the dashboard.

Release actuals are entered from official sources in the dashboard (calendar panel → *Add*), because the calendar feed carries no actuals (see [`docs/providers.md`](docs/providers.md)). Headlines are entered under *Configure → Add a headline*.

## Configuration

- `config/app.yaml`: instruments, display timezone (default `Africa/Kampala`, EAT), session boundaries and holidays, timeframes, swing, break and evaluation parameters, schedules, publication mode (manual by default), and report lengths.
- `config/terminology.yaml`: the terminology dictionary (approved terms with definitions, prohibited phrases with plain alternatives, chart abbreviations disabled by default). Terms you approve in the dashboard override it. Nothing is added automatically from source material.

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest -q
```

Covered: EAT conversion across the US and UK daylight-saving changes, session boundaries, pair direction, stale and incomplete data, source conflicts, revisions, missing results, no future-data leakage, indicators, swing confirmation, sustained-break rules, immutability, directional vs conditional evaluation, advice and terminology detection, number tracing, scheduler duplication, exports, provider response parsing, and a full GBP/USD week end to end.

## Repository layout

```
backend/app/domain      deterministic core (sessions, technical, breaks, evaluation, events, validation)
backend/app/providers   Twelve Data, Yahoo, OANDA, calendar feed, central-bank RSS, FRED, development fixtures
backend/app/reports     fact bundles, templates, prompts, writers, rendering, publication service
backend/app/content     advice, terminology, factual/integrity checks, semantic review
backend/app/api         FastAPI endpoints used by the dashboard
backend/migrations      Alembic migrations (including immutability triggers)
frontend/               React dashboard
config/                 app.yaml, terminology.yaml
docs/                   architecture, providers, content rules, limitations, example reports
```
