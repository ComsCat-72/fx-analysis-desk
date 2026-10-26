# Data providers (all free)

Verified against live responses on 26 Oct 2026 with the `Live data check` workflow (`.github/workflows/live-check.yml`):
seven instruments, the real calendar and central-bank feeds, and a full replayed week, with all 98 reports published.

| Data | Source | Key / licence | Notes |
|---|---|---|---|
| GBP/USD, EUR/USD, AUD/USD, NZD/USD, USD/CHF | **Twelve Data** time series (`providers/twelvedata.py`) | Free personal key (`TWELVEDATA_API_KEY`); 800 credits/day, 8/min | Composite FX prices, UTC-aligned hourly bars. One request per instrument per refresh. |
| Same pairs without a key | **Yahoo Finance** chart endpoint (`providers/yahoo.py`) | None; unofficial, personal use | Set `PRICE_PROVIDER=yahoo`. Yahoo's FX week opens 2 hours after Sunday 17:00 New York, so Monday sessions have 22 of 24 bars. This is allowed and disclosed in reports. |
| XAU/USD | **Twelve Data** | Free key | Yahoo has only gold *futures* (GC=F), which are never substituted for spot. Without a key, gold reports are unavailable. |
| DXY | **Yahoo `DX-Y.NYB`** | None | The ICE US Dollar Index level itself, 24 hourly bars per FX session. A computed-from-spot DXY remains available (`kind: index_computed`). |
| Nasdaq-100 | **Yahoo `^NDX`** | None | Cash index, 09:30-16:00 New York session (`us_equity_cash`, 7 hourly bars at :30). Not futures or a CFD. |
| Economic calendar | Fair Economy weekly JSON (`nfs.faireconomy.media`), from Forex Factory's operator | None | Schedule, impact, forecast, previous. **No actual results.** The Forex Factory website itself is not scraped. |
| Release actuals | Manual entry from official sources (dashboard calendar → *Add*) | None | Each value records its source and URL; conflicting sources are flagged and never averaged. |
| Central banks | Fed (press, speeches), ECB, BoE, RBA, RBNZ, SNB RSS (`providers/central_banks.py`) | None | Filtered to policy-relevant items (decisions, speeches, minutes, statements). |
| Bond yields | FRED (`providers/fred.py`) | Free key (`FRED_API_KEY`) | Adapter only; not yet in reports. |
| Headlines | Manual entry (Reuters/WSJ need a licence) | None | Labelled user-entered. |
| Report writing | Template writer (built in) or Claude API | Claude needs `ANTHROPIC_API_KEY` (paid usage) | The template writer is free and offline but rule-based. Claude writes richer analysis. |

Each instrument sets `price_provider` and `symbols` in `config/app.yaml`. `PRICE_PROVIDER` in the environment
overrides every instrument. A missing key raises an error that shows in the dashboard; the app never quietly
switches to another source or to fixtures. Every report names its price source and price type.

Re-run the live check any time: GitHub → Actions → **Live data check** → Run workflow. Results are pushed to the
`live-check` branch (reports plus `summary.json` with per-session bar coverage).
