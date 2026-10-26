# Data providers, credentials and licensing

| Data | Adapter | Credentials / licence | Status in this build |
|---|---|---|---|
| Spot FX and XAU/USD, 1H candles and quotes | `providers/oanda.py` (v20 REST, mid prices, `dailyAlignment=17` New York) | `OANDA_API_TOKEN`; `OANDA_ACCOUNT_ID` for live quotes. The free practice account is enough. Check OANDA's terms before redistributing data. | Tested against documented response shapes only. The build environment could not reach OANDA. |
| DXY | `domain/instruments.py` computes it from spot with the published ICE formula | Needs USD/JPY, USD/CAD and USD/SEK from the same provider | Labelled "computed, not the official ICE value". High/low come from hourly open and close only. |
| NASDAQ | OANDA `NAS100_USD` CFD | As OANDA | Labelled as a CFD, not the index level or futures. |
| Economic calendar | `providers/calendar_ff.py`: Fair Economy's weekly JSON export (`nfs.faireconomy.media`) | None | Schedule, impact, forecast and previous only. **No actuals.** The Forex Factory website itself is not scraped, because its terms forbid automated collection. |
| Release actuals and revisions | Manual entry from official sources (API `POST /api/events/{id}/actual`, dashboard) | None | Official agency adapters (BLS, BEA, ONS, Eurostat, ABS, Stats NZ, SFSO) are **not yet written** (see limitations). |
| Central banks | `providers/central_banks.py` (Fed, ECB, BoE, RBA, RBNZ, SNB RSS) | None | Feed URLs need checking once network access is available. |
| Bond yields | `providers/fred.py` (DGS2, DGS10; OECD monthly long-term yields for others) | `FRED_API_KEY` | Adapter only. Yields are not yet included in fact bundles. |
| Headlines (Reuters, WSJ) | Manual entry, labelled user-entered | Automated access needs a licence (LSEG for Reuters, Dow Jones Factiva for WSJ) | No scraping. Add a licensed adapter under `providers/` implementing a feed. |
| Report writer and review | Claude API | `ANTHROPIC_API_KEY` | Tested with a mocked client. |

Every adapter returns records tagged with its provider name. A missing credential raises `ProviderNotConfigured`, and the app never quietly switches to fixtures. Fixtures run only when `PRICE_PROVIDER=fixture` / `CALENDAR_PROVIDER=fixture` is set, and are refused in production.
