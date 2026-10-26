# Analytical limitations and incomplete features

## Analytical limitations

- **Causation.** The system can show what coincided with a move. It attributes a cause only when a cited source does. Timing alone is never treated as evidence.
- **Thresholds are conventions.** "Inconclusive" (0.25 × ATR) and "Mixed" (0.5 × ATR opposite excursion) are configurable rules, not statistical tests. The directional assessment compares the session close with the price at the data cutoff, so a day can "rise" from open to close while the assessment is Inconclusive.
- **Swings and structure** depend on the L/R bar settings. Different parameters produce different, equally reproducible structures.
- **Computed DXY** is close to the ICE index but not identical, and its hourly high/low use only the computed open and close.
- **Single price source.** With one primary provider, conflicts can only be detected against a second source you configure. There are no averaged or synthetic closes.
- **Consensus figures** come from the calendar feed. Check them before relying on surprise labels for important releases.
- **Screenshots** give approximate readings and must be confirmed. They say nothing about price after they were taken.
- **The template writer** is deliberately mechanical. Its bias rule (1H structure) is a placeholder for development, not an analytical method.
- **Model output** is checked, but the checks can miss subtle misstatements. Manual publication is the default for that reason.

## Incomplete features

1. Official-statistics adapters for actuals (BLS, BEA, ONS, Eurostat, ABS, Stats NZ, SFSO, StatCan). Actuals are entered manually for now.
2. Licensed news adapters (LSEG or Reuters, Dow Jones or WSJ). Headlines are entered manually.
3. Bond yields and commodities: the FRED adapter exists but yields aren't yet ingested into storage or fact bundles. There is no oil or risk-sentiment series yet.
4. Market-implied policy probabilities (for example fed funds futures) are not implemented, so probability statements are blocked unless they come from a sourced item.
5. A second price provider for cross-checking closes (the conflict logic exists; no second adapter yet).
6. External delivery (email, Telegram and so on) is configured as disabled and has no channel adapters.
7. A terminology editor UI (the API exists: `GET/POST /api/terminology`).
8. Editing schedules and session boundaries in the UI; for now they are edited in `config/app.yaml`.
9. Authentication and multi-user roles; the API assumes a trusted single-user deployment.
10. Live verification: OANDA, the calendar feed, FRED and the central-bank feeds were unreachable from the build environment. Their adapters are tested against documented formats only.
