// Rule-based writer (the free default). Every sentence is assembled in code from cited bundle items, so every
// figure is traceable and nothing is invented. It explains with fixed rules and never claims causes:
// releases and headlines that fall in a session are described as coinciding with the move.
//
// Bias rule (analyses):
//   1H swing structure upward and the last daily close not below SMA(20)  -> upward lean
//   1H swing structure downward and the last daily close not above SMA(20) -> downward lean
//   mixed structure with support below and resistance above the reference -> range-bound between them
//   anything else (insufficient or conflicting signals)                     -> neutral
import { ANALYSIS_KINDS, type Kind } from "../config.ts";
import { detectAdvice } from "../content/advice.ts";
import { splitSentences } from "../content/checks.ts";
import { detectTerms, dictionary } from "../content/terminology.ts";
import { DIRECTION_LABEL, type Direction } from "../core/evaluation.ts";
import { INVERSE } from "../core/events.ts";
import { dayName } from "../dates.ts";
import type { Writer } from "./claude.ts";
import type { Bundle, EventItem, Item, LevelItem, OutlookIn } from "./types.ts";

const cite = (...ids: (string | undefined | null)[]) => { const x = ids.filter(Boolean); return x.length ? ` [${x.join(", ")}]` : ""; };
const restate = (item: Item) => splitSentences(item.text).map((x) => `${x.trimEnd().replace(/\.$/, "")} [${item.id}].`).join(" ");
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const label = (d: string) => DIRECTION_LABEL[d as Direction] ?? d;
/** "an upward lean", "a downward lean", "neutral", "range-bound": reads after "is" / "was". */
const phrase = (lab: string) => (/lean$/i.test(lab) ? `${/^[aeiou]/i.test(lab) ? "an" : "a"} ${lc(lab)}` : lc(lab));

/** One sentence on what the published areas did, instead of repeating the code-rendered reaction table. */
function zoneSummary(zones: { role: string; area: string; reaction: string; status: string; fact_id: string }[]): string {
  const zs = zones.filter((z) => z.fact_id);
  if (!zs.length) return "";
  const what = (z: (typeof zs)[number]) => `${z.role} ${z.area} ${({ "Not reached": "was not tested", "Sustained break": "gave way under the close rule",
    "Broken, then reclaimed": "broke and was then reclaimed", "Traded through, closed back": "was traded through but held on a closing basis",
    "Tested, held": "was tested and held" } as Record<string, string>)[z.reaction] ?? lc(z.reaction)}`;
  const first = what(zs[0]);
  const lines = [`${first[0].toUpperCase()}${first.slice(1)}${zs.length > 1 ? `, and ${zs.slice(1).map(what).join(", and ")}` : ""}${cite(...zs.map((z) => z.fact_id))}.`];
  lines.push(zs.some((z) => z.status === "broken") ? "An area that gave way is no longer an active boundary unless price reclaims it."
    : zs.every((z) => z.reaction === "Not reached") ? "Price stayed between the published areas, so they remain the relevant references."
    : "The published areas that were tested held, so they remain the relevant references.");
  return lines.join(" ");
}
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => WORDS[n] ?? String(n); // counts as words: a bare "0" would read as an uncited figure
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

const released = (e: EventItem) => e.state === "released" || e.state === "revised";

/** "supportive" / "negative" in principle for the event's currency, from the result versus consensus. */
function leaning(e: EventItem): "supportive" | "negative" | null {
  if (!released(e)) return null;
  if (e.surprise === "above consensus") return INVERSE.test(e.title) ? "negative" : "supportive";
  if (e.surprise === "below consensus") return INVERSE.test(e.title) ? "supportive" : "negative";
  return null;
}

const resultWord = (e: EventItem) => e.surprise === "no verified consensus" ? "released without a verified consensus"
  : e.surprise === "not comparable" ? "not directly comparable with its consensus" : String(e.surprise);

function eventLine(e: EventItem, cutoff: number): string {
  const id = cite(e.id);
  if (released(e)) {
    const vs = e.surprise === "no verified consensus" ? "; no verified consensus was available"
      : e.surprise === "not comparable" ? `; consensus ${e.consensus} is not directly comparable` : ` against consensus ${e.consensus}, ${e.surprise}`;
    const rev = e.revised_previous ? `; the previous figure was revised to ${e.revised_previous}` : "";
    const lean = leaning(e);
    const why = lean === "supportive" ? " This is supportive in principle if it raises expectations of tighter policy; the price reaction shows whether markets agreed."
      : lean === "negative" ? " This weighs in principle if it lowers expectations of tighter policy; the price reaction shows whether markets agreed."
      : e.surprise === "in line with consensus" ? " An in-line result leaves the details and the price reaction as the main information." : "";
    return `- ${e.title}: actual ${e.actual}${vs}${rev}${id}.${why}`;
  }
  if (e.state === "conflicting") return `- ${e.title}: available sources disagree; interpretation is withheld pending verification${id}.`;
  if (e.state === "delayed") return `- ${e.title}: delayed from its scheduled time ${e.scheduled_display}${id}.`;
  if (Date.parse(e.scheduled_at) <= cutoff)
    return `- ${e.title}: the release was scheduled for ${e.scheduled_display}, but the actual result is not yet verified${id}.`;
  return `- ${e.title}: scheduled for ${e.scheduled_display}; consensus ${e.consensus ?? "not available"}, previous ${e.previous ?? "not available"}${id}.`;
}

export const templateWriter: Writer = {
  name: "template",
  async write(kind: Kind, b: Bundle) {
    const m = b.meta, facts = Object.values(b.facts), levels = Object.values(b.levels), events = Object.values(b.events);
    const cont = b.continuity ?? {}, ev = b.evaluation ?? {};
    const econ = Object.fromEntries(m.economies) as Record<string, string>;
    const role = (r: string) => facts.find((x) => x.role === r);
    const ref = role("reference_price"), prev = role("previous_session"), prevw = role("previous_week");
    const struct = facts.find((x) => x.kind === "structure");
    const ma20 = facts.find((x) => x.kind === "indicator" && x.ma === "SMA(20)");
    const atr = facts.find((x) => x.kind === "indicator" && x.text.startsWith("ATR("));
    const weekRange = facts.find((x) => x.kind === "price" && x.text.startsWith("Range this week"));
    const fx = m.instrument_kind === "fx_spot";
    const cutoff = Date.parse(m.data_cutoff);

    // Headlines are quoted only if their own wording passes the advice and terminology checks.
    const dict = dictionary();
    const clean = (p: Item) => {
      const t = String(p.title ?? "");
      // A title that splits into several sentences would separate its figures from the citation.
      return !detectAdvice(t).length && !detectTerms(t, dict).length && (splitSentences(t).length === 1 || !/\d/.test(t));
    };
    const policy = Object.values(b.policy).filter(clean);
    const omitted = Object.values(b.policy).length - policy.length;

    const sideCurrency = (side: "base" | "quote") => (side === "base" ? m.base : m.quote);
    const eventsFor = (side: "base" | "quote") => {
      const cur = sideCurrency(side);
      return events.filter((e) => e.currency === cur || (side === "quote" && !fx && e.currency === "USD"));
    };
    const newsFor = (side: "base" | "quote") => {
      const cur = sideCurrency(side);
      const curs = side === "quote" && !fx ? [cur, "USD"] : [cur];
      return policy.filter((p) => p.kind === "policy" ? curs.includes(String(p.currency)) : ((p.currencies as string[] | undefined) ?? []).some((c) => curs.includes(c)));
    };

    const fundamentals = (side: "base" | "quote", window?: [number, number]) => {
      const evs = eventsFor(side).filter((e) => !window || (Date.parse(e.scheduled_at) >= window[0] && Date.parse(e.scheduled_at) < window[1]));
      const rel = evs.filter(released), other = evs.filter((e) => !released(e));
      // Blocks are separated by blank lines so Markdown keeps each list and paragraph apart.
      const blocks: string[] = [];
      if (rel.length) blocks.push(["**Released**", ...rel.slice(0, 5).map((e) => eventLine(e, cutoff))].join("\n"));
      if (other.length) blocks.push([rel.length ? "**Not yet released or not verified**" : "**Scheduled**", ...other.slice(0, 5).map((e) => eventLine(e, cutoff))].join("\n"));
      const lines: string[] = [];
      const items = newsFor(side).filter((p) => !window || (Date.parse(String(p.published_at)) >= window[0] && Date.parse(String(p.published_at)) < window[1]));
      for (const p of items.filter((p) => p.kind === "policy").slice(0, 3)) lines.push(`- ${String(p.bank).toUpperCase()} ${p.type}: "${p.title}"${cite(p.id)}.`);
      for (const p of items.filter((p) => p.kind === "news").slice(0, 3))
        lines.push(`- Reporting (${p.source_name}${p.entered_by === "feed" ? ", headline only" : ""}): "${p.title}"${cite(p.id)}.`);
      if (lines.length) blocks.push(["**Central banks and reporting**", ...lines].join("\n"));
      if (!blocks.length) return `No verified ${econ[side]} releases, central-bank items or headlines are recorded for this period. The ${econ[side]} side is therefore not assessed from new evidence.`;
      const sup = rel.filter((e) => leaning(e) === "supportive").length, neg = rel.filter((e) => leaning(e) === "negative").length;
      if (rel.length) blocks.push(sup && neg ? `Released results were mixed for ${econ[side]}: some supportive and some negative in principle.`
        : sup ? `Released results were supportive in principle for ${econ[side]}.` : neg ? `Released results were negative in principle for ${econ[side]}.`
        : `Released results gave no clear signal relative to expectations for ${econ[side]}.`);
      return blocks.join("\n\n");
    };

    // ---- technical context shared by analyses
    const refp = m.reference_price;
    const sup = levels.filter((l) => l.role === "support" && refp != null && l.upper < refp).sort((a, c) => c.upper - a.upper);
    const res = levels.filter((l) => l.role === "resistance" && refp != null && l.lower > refp).sort((a, c) => a.lower - c.lower);
    const technical = () => {
      const t: string[] = [];
      if (ref) t.push(restate(ref));
      if (sup[0] && res[0]) t.push(`The nearest reference areas are support at ${sup[0].values[0]}${sup[0].values[1] !== sup[0].values[0] ? `–${sup[0].values[1]}` : ""} and resistance at ${res[0].values[0]}${res[0].values[1] !== res[0].values[0] ? `–${res[0].values[1]}` : ""}${cite(sup[0].id, res[0].id)}.`);
      for (const l of levels.slice(0, 6)) if (l !== sup[0] && l !== res[0]) t.push(`- ${restate(l)}`);
      if (struct) t.push(restate(struct));
      if (weekRange) t.push(restate(weekRange));
      if (ma20) t.push(restate(ma20));
      if (atr) t.push(restate(atr));
      return t.join("\n") || "No verified technical data is available for this period.";
    };

    let sections: Record<string, string> = {};
    let outlook: OutlookIn | null = null;

    if (ANALYSIS_KINDS.includes(kind)) {
      const s = String(struct?.structure ?? "insufficient"), pos = ma20?.position;
      const direction: OutlookIn["direction"] = s === "upward" && pos !== "below" ? "upward_lean"
        : s === "downward" && pos !== "above" ? "downward_lean"
        : s === "mixed" && sup[0] && res[0] ? "range_bound" : "neutral";
      const why = direction === "upward_lean" ? `the confirmed 1H swing structure is upward${pos ? " and the last daily close is above SMA(20)" : ""}`
        : direction === "downward_lean" ? `the confirmed 1H swing structure is downward${pos ? " and the last daily close is below SMA(20)" : ""}`
        : direction === "range_bound" ? "the confirmed 1H swing structure is mixed and price sits between the nearest support and resistance"
        : s === "insufficient" ? "there are too few confirmed 1H swing points to define a direction" : "the 1H swing structure and the daily moving average point in different directions";
      const qualification = direction === "upward_lean" ? "while the nearest support holds" : direction === "downward_lean" ? "while the nearest resistance caps price"
        : direction === "range_bound" ? "between the nearest support and resistance" : "signals are mixed";
      const conds: OutlookIn["conditions"] = [], zones: string[] = [];
      const area = (l: LevelItem, edge: "lower" | "upper") => l.values[edge === "lower" ? 0 : 1];
      if (res[0]) {
        const strengthens = direction === "upward_lean";
        conds.push({ level_id: res[0].id, boundary: "upper", side: "above", effect: strengthens ? "strengthens" : "weakens",
          text: direction === "downward_lean" ? `A sustained move above ${area(res[0], "upper")} would weaken the downward interpretation.`
            : direction === "upward_lean" ? `A sustained move above ${area(res[0], "upper")} would strengthen the upward interpretation.`
            : `A sustained move above ${area(res[0], "upper")} would shift the picture toward an upward interpretation.` });
        zones.push(res[0].id);
      }
      if (sup[0]) {
        const strengthens = direction === "downward_lean";
        conds.push({ level_id: sup[0].id, boundary: "lower", side: "below", effect: strengthens ? "strengthens" : "weakens",
          text: direction === "upward_lean" ? `A sustained move below ${area(sup[0], "lower")} would weaken the upward interpretation.`
            : direction === "downward_lean" ? `A sustained move below ${area(sup[0], "lower")} would strengthen the downward interpretation.`
            : `A sustained move below ${area(sup[0], "lower")} would shift the picture toward a downward interpretation.` });
        zones.push(sup[0].id);
      }
      outlook = { direction, qualification, conditions: conds, range_level_ids: direction === "range_bound" ? [sup[0].id, res[0].id] : [], zone_ids: zones };

      const br = m.break_rules;
      const rule = `A sustained move means ${br.sustained_closes} consecutive ${br.timeframe} closes beyond the boundary; a move that only trades through is not counted.`;
      const change = [...conds.map((c) => `${c.text.replace(/\.$/, "")} [${c.level_id}].`),
        conds.length ? rule : "No verified reference areas bracket the current price, so no conditions can be stated.",
        conds.length ? `Until either happens, the interpretation stays ${lc(label(direction))}.` : ""].filter(Boolean).join("\n");
      const high = events.filter((e) => e.impact === "High" && !released(e)).sort((a, c) => a.scheduled_at.localeCompare(c.scheduled_at));
      const next = high[0];
      const tests = high.length
        ? `The main scheduled ${high.length === 1 ? "test" : "tests"} of this interpretation ${high.length === 1 ? "is" : "are"} ${list(high.slice(0, 4).map((e) => `${e.currency} ${e.title}${cite(e.id)}`))}. How price behaves at the reference areas after each release matters more than the headline figure.`
        : events.length ? "No high-impact releases remain in this period; medium-impact releases are listed in the table." : "No high- or medium-impact releases are recorded for this period.";
      const question = next
        ? `Does ${next.currency} ${next.title}${cite(next.id)} change the ${lc(label(direction))} interpretation, or does price stay between the nearest reference areas?`
        : `Does price confirm a sustained move beyond the nearest reference areas, or stay between them?`;
      const lean = direction === "upward_lean" || direction === "downward_lean";
      const biasSentence = `The bias is ${phrase(label(direction))} because ${why}${cite(struct?.id, lean ? ma20?.id : null)}.`;

      if (kind === "weekly_analysis") {
        const pw = cont.previous_weekly;
        const prevDir = prevw ? (Number(prevw.values[3]) > Number(prevw.values[0]) ? "higher" : Number(prevw.values[3]) < Number(prevw.values[0]) ? "lower" : "unchanged") : null;
        const ctx = [
          prevw ? restate(prevw) : "No complete previous-week data is available.",
          prevw && prevDir !== "unchanged" ? `${m.display} closed the previous week ${prevDir} than it opened${fx ? `, meaning ${prevDir === "higher" ? m.base : m.quote} strengthened against ${prevDir === "higher" ? m.quote : m.base}` : ""}${cite(prevw.id)}.` : "",
          pw ? `Last week's outlook, as published, was ${phrase(pw.direction_label)}.` : "No outlook was published for the previous week.",
          cont.previous_weekly_review ? "A review of the previous week was published and is the starting point for this week." : "No review of the previous week was published.",
        ];
        sections = {
          weekly_bias: `${biasSentence} It is a working interpretation for the week, not a commitment, and it is reassessed in each daily report.`,
          market_context: ctx.filter(Boolean).join(" "),
          fundamental_base: fundamentals("base"), fundamental_quote: fundamentals("quote"),
          key_events: `${tests} The scenario tables set out how results relative to consensus could bear on each currency; scenario weights are not estimated.`,
          technical_picture: technical(), what_would_change: change, key_question: question,
        };
      } else {
        const w = cont.weekly;
        const daily = (cont.daily ?? []) as { period_key: string; direction: string; direction_label: string; evaluation?: { directional: string } | null }[];
        const ctx: string[] = [];
        const wq = w?.qualification && !/\d/.test(w.qualification) ? `, ${w.qualification}` : ""; // figures would need citations from another bundle
        ctx.push(w ? `The weekly outlook is ${phrase(w.direction_label)}${wq}, as published ${w.published_display}.` : String(cont.note ?? "No weekly analysis was published for this week."));
        if (daily.length) {
          const first = daily[0];
          ctx.push(`${dayName(first.period_key)}'s daily outlook was ${phrase(first.direction_label)}${first.evaluation ? `, which its review assessed as ${lc(first.evaluation.directional)}` : ""}.`);
          const later = daily.slice(1).map((d) => `${dayName(d.period_key)} ${lc(d.direction_label)}${d.evaluation ? ` (${lc(d.evaluation.directional)})` : ""}`);
          if (later.length) ctx.push(`Later days: ${list(later)}.`);
          const last = [...daily].reverse().find((d) => d.evaluation);
          // Only a daily outlook that shared the weekly direction tests the weekly thesis directly.
          if (last?.evaluation && w) {
            const effect = last.direction !== w.direction ? null
              : last.evaluation.directional === "Supported" ? "strengthens" : last.evaluation.directional === "Not supported" ? "weakens" : null;
            ctx.push(effect ? `The latest assessed session (${dayName(last.period_key)}) ${effect} the weekly interpretation.`
              : last.direction !== w.direction ? `The latest assessed daily outlook (${dayName(last.period_key)}) differed from the weekly one, so its assessment does not test the weekly interpretation directly.`
              : `The latest assessed session (${dayName(last.period_key)}) neither strengthens nor weakens the weekly interpretation.`);
          }
        } else ctx.push("This is the first daily outlook of the week.");
        if ((cont.change_log ?? []).length) ctx.push(`The outlook has changed ${cont.change_log.length === 1 ? "once" : `${count(cont.change_log.length)} times`} this week (see the outlook change log).`);
        if (prev) ctx.push(restate(prev));
        sections = {
          market_context: ctx.join(" "),
          fundamental_base: fundamentals("base"), fundamental_quote: fundamentals("quote"), technical_picture: technical(),
          analytical_outlook: `${biasSentence}\n${change}\n${tests}`,
          key_question: question,
        };
      }
    } else if (kind === "daily_review") {
      const sess = b.facts[ev.session_fact ?? ""], evf = b.facts[ev.evaluation_fact ?? ""];
      const dir = String(ev.session_direction ?? "");
      const window: [number, number] = [Date.parse(m.horizon_start), Date.parse(m.horizon_end)];
      const exp: string[] = [];
      if (sess) exp.push(restate(sess));
      if (!ev.original) exp.push("No daily analysis was published for this session, so there is no original outlook to compare against.");
      else if (evf) {
        const d = ev.directional?.outcome;
        exp.push(d === "Supported" ? `The session supported the published outlook (${lc(ev.original.direction_label)})${cite(evf.id)}.`
          : d === "Not supported" ? `The session did not support the published outlook (${lc(ev.original.direction_label)})${cite(evf.id)}.`
          : d === "Mixed" ? "The evidence was mixed: price moved both ways by a meaningful amount." : "The net move was too small to judge the outlook either way.");
        for (const c of ev.conditional ?? []) {
          const what = ({ "Condition not reached": "was not reached", "Briefly reached, not sustained": "was briefly reached but not sustained under the close rule",
            Confirmed: "was confirmed under the close rule", "Confirmed, then reversed": "was confirmed and then reversed",
            "Unresolved by session end": "was unresolved at the session end" } as Record<string, string>)[c.outcome] ?? `was ${lc(String(c.outcome))}`;
          exp.push(`The condition for a move ${c.side} ${c.boundary} ${what}${cite(evf.id)}.`);
        }
      } else if (ev.session_incomplete) exp.push("The session's price data is incomplete, so the outlook is not assessed.");
      const inSession = events.filter((e) => released(e) && Date.parse(e.scheduled_at) >= window[0] && Date.parse(e.scheduled_at) < window[1]);
      const heads = policy.filter((p) => Date.parse(String(p.published_at)) >= window[0] && Date.parse(String(p.published_at)) < window[1]);
      const why: string[] = [];
      if (dir) {
        why.push(`${m.display} ${dir === "consolidated" ? "consolidated" : dir}${cite(sess?.id)}.`);
        if (fx && dir !== "consolidated") why.push(`That means ${dir === "rose" ? m.base : m.quote} strengthened against ${dir === "rose" ? m.quote : m.base} over the session.`);
        for (const e of inSession.slice(0, 4)) {
          const lean = leaning(e);
          if (!lean) { why.push(`${e.currency} ${e.title} was ${resultWord(e)}${cite(e.id)}, so it gave little directional information.`); continue; }
          const priceUp = dir === "rose", favoursBase = e.currency === m.base ? lean === "supportive" : lean === "negative";
          const consistent = dir === "consolidated" ? null : fx || e.currency === "USD" ? (priceUp === favoursBase) : null;
          why.push(`${e.currency} ${e.title} was ${e.surprise}${cite(e.id)}, ${lean} in principle for ${e.currency}` + (consistent == null ? "." : consistent ? "; the session move was consistent with that." : "; price did not move in that direction."));
        }
        if (heads.length) why.push(`Reporting during the session included ${list(heads.slice(0, 3).map((p) => `"${p.title}"${cite(p.id)}`))}.`);
        why.push(inSession.length || heads.length ? "These items coincided with the move; timing alone does not establish what caused it."
          : "No verified release or headline is recorded inside the session window, so the move is not attributed.");
      } else why.push("The session could not be classified because its price data is incomplete.");
      const w = cont.weekly;
      const wdir = w?.direction as string | undefined;
      const conclusion = !w ? "No weekly analysis was published, so the session is assessed against the daily outlook only."
        : !dir || dir === "consolidated" ? `The session gave no directional evidence; the weekly interpretation (${lc(w.direction_label)}) is unchanged.`
        : (wdir === "upward_lean" && dir === "rose") || (wdir === "downward_lean" && dir === "fell") ? `The session was consistent with the weekly ${lc(w.direction_label)}; the weekly interpretation is unchanged.`
        : wdir === "upward_lean" || wdir === "downward_lean" ? `The session ran against the weekly ${lc(w.direction_label)}. One session does not overturn the weekly interpretation, but a further move the same way would weaken it.`
        : `The session moved directionally while the weekly interpretation is ${lc(w.direction_label)}; a further move the same way would challenge that interpretation.`;
      sections = {
        expected_vs_actual: exp.join(" ") || "No complete session data is available.",
        fundamental_base: fundamentals("base", window), fundamental_quote: fundamentals("quote", window),
        why_moved: why.join(" "),
        technical_takeaway: zoneSummary(ev.zones ?? []) || "No published reference areas were available to assess.",
        daily_conclusion: conclusion,
      };
    } else {
      const wkf = b.facts[ev.week_fact ?? ""], wv = ev.weekly;
      const days = (ev.days ?? []) as { day: string; published_bias: string; directional: string; conditional: string }[];
      const assessed = days.filter((d) => d.directional !== "Not assessable");
      const n = (o: string) => { const k = assessed.filter((d) => d.directional === o).length; return k ? count(k) : "none"; };
      const intro: string[] = [];
      if (wkf) intro.push(restate(wkf));
      intro.push(wv ? `The original weekly outlook was ${phrase(wv.original.direction_label)}; its directional assessment is ${lc(wv.directional)} (${wv.explanation}).`
        : "No weekly analysis was published for this week; this review uses the working theme from the daily reports.");
      if (assessed.length) intro.push(`Of the ${count(assessed.length)} daily outlooks assessed, ${n("Supported")} ${assessed.filter((d) => d.directional === "Supported").length === 1 ? "was" : "were"} supported, ${n("Not supported")} not supported, ${n("Mixed")} mixed and ${n("Inconclusive")} inconclusive.`);
      const missingDays = days.filter((d) => d.published_bias === "No report published").map((d) => d.day);
      if (missingDays.length) intro.push(`No daily analysis was published for ${list(missingDays)}.`);
      const dir = String(ev.session_direction ?? "");
      const seq = String(ev.sequence ?? "");
      const rel = events.filter(released);
      const byCur = [...new Set(rel.map((e) => e.currency))].map((cur) => {
        const xs = rel.filter((e) => e.currency === cur);
        const s = xs.filter((e) => leaning(e) === "supportive").length, n = xs.filter((e) => leaning(e) === "negative").length;
        return `${cur} releases were ${s && n ? "mixed" : s ? "mostly supportive in principle" : n ? "mostly negative in principle" : "largely in line or without a clear signal"}${cite(...xs.slice(0, 4).map((e) => e.id))}`;
      });
      const why: string[] = [];
      if (dir) why.push(`Across the week ${m.display} ${dir}${cite(wkf?.id)}${seq === "continued" ? ", continuing the previous week's direction" : seq === "reversed" ? ", reversing the previous week's direction" : ""}.`);
      if (byCur.length) why.push(`${list(byCur)}.`);
      why.push(rel.length ? "These results coincided with the week's moves; the day-by-day assessments show where price agreed with them." : "No verified actual results are recorded for the week, so the sequence is not attributed to releases.");
      // Lesson: fixed rules over the day table, first match wins.
      const notSupported = days.map((d) => d.directional === "Not supported");
      let run = 0, best = 0;
      for (const x of notSupported) { run = x ? run + 1 : 0; best = Math.max(best, run); }
      const brief = days.filter((d) => /Briefly reached|then reversed/.test(d.conditional)).map((d) => d.day);
      const lesson = !wv && !assessed.length ? "Without a weekly analysis or assessable daily outlooks, the week had no fixed reference; the main limitation was missing published expectations, not the market."
        : best >= 2 ? `The daily outlooks were not supported on ${count(best)} consecutive sessions. Repeated disagreement between price and the published view is evidence that the interpretation needed updating sooner.`
        : brief.length ? `Published conditions were briefly reached but not sustained on ${list(brief)}. A move beyond a level was not, on its own, confirmation; the close rule separated the two.`
        : assessed.length && assessed.filter((d) => d.directional === "Supported").length > assessed.length / 2 ? `The published outlooks were supported on most assessed sessions. The conditions stated in advance remained the most useful test of whether the view still held.`
        : days.some((d) => d.directional === "Not assessable" && d.published_bias !== "No report published") ? "Some sessions could not be assessed because data was incomplete; the week's conclusions are limited by those gaps."
        : "The evidence was mixed through the week. A neutral or conditional reading was more defensible than a firm directional view.";
      sections = {
        bias_vs_actual: intro.join(" "),
        fundamental_base: fundamentals("base"), fundamental_quote: fundamentals("quote"),
        why_sequence: why.join(" "),
        technical_review: zoneSummary(wv?.zones ?? []) || "No published weekly reference areas were available to assess.",
        lesson,
      };
    }
    if (omitted > 0) {
      const k = kind === "daily_review" ? "why_moved" : kind === "weekly_review" ? "why_sequence" : "market_context";
      sections[k] = `${sections[k]}\n${omitted === 1 ? "One headline was" : `${count(omitted)[0].toUpperCase()}${count(omitted).slice(1)} headlines were`} left out because their wording failed the content checks.`;
    }
    return { sections, outlook, model: null };
  },
};
