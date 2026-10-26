# Content validation rules

All findings appear in the draft's checks panel. Any **blocking** content finding stops publication.

| Check | Implementation | Severity |
|---|---|---|
| Trading advice | `content/advice.py`: context-aware regex rules for buy/sell instructions, imperatives, entries, stops, take-profits and price objectives ("target", "room toward"), sizing, risk/reward, order types, setups, reader instructions ("watch", "wait for", "avoid"), promises, and participation. Analytical phrases ("selling pressure", "short-term", "inflation target", "safe-haven buying") are neutralised first. | Blocking |
| Terminology | `content/terminology.py`: prohibited phrases from `config/terminology.yaml` plus user terms. Disabled abbreviations (BOS, CHoCH, MSS, FVG, OB) are matched case-sensitively. | Blocking |
| Citations and numbers | `content/checks.py`: every sentence with a figure must cite bundle IDs, and every number must equal a value of a cited item (or round from one at the instrument's precision). Times must be event or report times. Unknown IDs are rejected. | Blocking |
| Integrity | An in-line result described as a surprise; a result described before it is verified; "sustained/confirmed break" without a confirmed break; causal wording without a cited news, policy or release item (warning); probabilities without a sourced pricing fact. | Blocking / warning |
| Continuity | The text's description of the weekly outlook must match the stored outlook; a reference to a weekly outlook that was never published is blocked. | Blocking |
| Direction | In reviews, "<PAIR> rose/fell/consolidated" must agree with the computed session movement. | Blocking |
| Data | Missing essentials, mixed providers, stale or fixture data (production) | Blocking |
| Length | Outside the configured word range | Warning |
| Semantic review | A second Claude pass with `reports/prompts/review.md` returns structured issues. If no API key is set, it is recorded as "not run". | As reported |

Report prompts: `backend/app/reports/prompts/system.md` (writer) and `review.md` (reviewer).
