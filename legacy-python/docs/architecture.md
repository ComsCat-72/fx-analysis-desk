# Architecture

```
Providers ──► ingestion (provider identity, append-only event history)
                │
                ▼
         SQL database ──► fact bundle (as-of the data cutoff) ──► writer (Claude or template)
                                     │                                   │
                                     │                      checks: deterministic + semantic
                                     ▼                                   │
                           evaluation (reviews) ◄─────────── publish (immutable) ──► outlook record
                                                                         │                │
                                                                  exports MD/PDF     change log
```

## Deterministic core (`backend/app/domain`)

| Module | What it defines |
|---|---|
| `sessions.py` | A trading day closes at 17:00 New York (zoneinfo handles DST). The week runs Sunday 17:00 to Friday 17:00 NY. D1 and W1 candles are aggregated from H1, and a candle is *complete* only if every sub-candle exists, is complete, and its period has ended. Sources are never mixed. |
| `technical.py` | Wilder ATR and RSI, SMA, and EMA seeded with an SMA. Fractal swings with L/R bars: a swing exists only after the right-side bars close (`confirmed_at`), so no future data leaks in. Structure: upward = HH and HL, downward = LH and LL, otherwise mixed. |
| `breaks.py` | Reached = wick beyond the boundary. Break = a close beyond it (or a wick, if configured). Sustained = N consecutive closes beyond. Reversal = M closes back. Level statuses: active, tested, broken, reclaimed, invalidated, archived. The same functions are used for writing and reviewing. |
| `evaluation.py` | The directional assessment uses thresholds scaled by the daily ATR known at publication (see the module docstring). Conditional assessments come from `breaks.py`. No P&L, returns or win rates. |
| `events.py` | Value parsing, surprise classification at published precision (equal = in line, never a surprise), revisions, source reconciliation (conflicting sources are never averaged), and scenario tables with "Not estimated" by default and validated weights. |
| `validation.py` | Stale quotes (informational when the market is closed), incomplete candles, missing sessions, mixed sources, and value conflicts. |

## Continuity and memory

- A **Report** is a slot (instrument, kind, period). **ReportVersion** rows hold the text, the exact fact bundle, the checks and the data cutoff.
- Publishing creates an **Outlook** with structured fields: direction, qualification, conditions as level boundary plus side, published zones, reference price, ATR, horizon, and the rules in force. Reviews evaluate that record and never the text.
- A daily analysis bundle includes the week's original weekly outlook, the earlier daily outlooks with their evaluations, review conclusions, and the outlook change log.
- Corrections keep the original data cutoff. Timestamped updates use a new cutoff. Both need a change note and are logged.

## Fact bundle rules

- Only candles that closed, and event values recorded, at or before the cutoff. Event values are rebuilt from the append-only `event_value_history`.
- Each fact has the text it may be quoted as, plus its allowed values. Times are shown in EAT, and the source timestamp is kept.
- Missing essentials go into `missing`, which blocks publication or labels the report partial if `partial_publication: label` is set and you opt in. Problems go into `warnings`.

## Writers

- `ClaudeWriter` uses `claude-opus-5-5` with structured JSON output (sections plus outlook) and refusal fallback (`fallbacks: "default"`). The policy prompt is cached. One automatic revision pass feeds blocking findings back to the model.
- `TemplateWriter` is offline and assembles deterministic sentences only. Its bias comes from a stated rule based on the 1H structure. It is used for fixtures, tests, and running without a key.

## Scheduling

APScheduler cron jobs run in the display timezone. A unique `job_runs(job, slot, instrument)` row prevents duplicate runs. Failed runs retry with backoff, weekends and holidays are skipped, and manual regeneration is supported (`force`). Manual publication is the default. Automatic publication must be enabled explicitly, and even then only drafts with zero blocking findings are published.
