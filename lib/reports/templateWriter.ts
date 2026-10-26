// Deterministic, offline writer. Uses only bundle sentences, so every statement is traceable.
// Bias rule: 1H structure upward -> upward lean; downward -> downward lean; otherwise neutral.
import { ANALYSIS_KINDS } from "../config.ts";
import { splitSentences } from "../content/checks.ts";
import type { Writer } from "./claude.ts";
import type { Item, OutlookIn } from "./types.ts";

export const templateWriter: Writer = {
  name: "template",
  async write(kind, b) {
    const m = b.meta, facts = b.facts, levels = b.levels, events = b.events, policy = b.policy;
    const cont = b.continuity ?? {}, ev = b.evaluation ?? {};
    const cite = (i: string) => `[${i}]`;
    const fx = (item: Item) => splitSentences(item.text).map((x) => `${x.trimEnd().replace(/\.$/, "")} [${item.id}].`).join(" ");
    const first = (role: string) => Object.values(facts).find((x) => x.role === role);
    const ref = first("reference_price"), prev = first("previous_session"), prevw = first("previous_week");
    const struct = Object.values(facts).find((x) => x.kind === "structure");
    const indicators = Object.values(facts).filter((x) => x.kind === "indicator");
    const econ = Object.fromEntries(m.economies);

    const sideText = (side: "base" | "quote") => {
      const cur = side === "base" ? m.base : m.quote;
      const evs = Object.values(events).filter((e) => e.currency === cur || (side === "quote" && m.instrument_kind !== "fx_spot" && e.currency === "USD"));
      const pol = Object.values(policy).filter((p) => p.currency === cur);
      const lines = evs.slice(0, 6).map((e) => e.state === "released" || e.state === "revised"
        ? `- ${e.title}: actual ${e.actual} against consensus ${e.consensus ?? "n/a"} (${e.surprise}) ${cite(e.id)}.`
        : e.state === "conflicting" ? `- ${e.title}: available sources disagree; interpretation is withheld pending verification ${cite(e.id)}.`
        : `- ${e.title} is scheduled for ${e.scheduled_display}; consensus ${e.consensus ?? "not available"} ${cite(e.id)}.`);
      for (const p of pol.slice(0, 3)) lines.push(`- Recent ${p.type ?? "item"}: "${p.title}" ${cite(p.id)}.`);
      return lines.join("\n") || `- No verified ${econ[side]} developments are recorded in the bundle for this period.`;
    };

    const tech: string[] = [];
    if (prev) tech.push(`The previous session's range sets the nearest calculated reference areas ${cite(prev.id)}.`);
    for (const l of Object.values(levels).slice(0, 6)) tech.push(`- ${fx(l)}`);
    if (struct) tech.push(`1H structure is ${struct.structure} ${cite(struct.id)}.`);
    for (const x of indicators.slice(0, 2)) tech.push(fx(x));
    const techTxt = tech.join("\n") || "No verified technical data is available.";

    let sections: Record<string, string> = {};
    let outlook: OutlookIn | null = null;
    if (ANALYSIS_KINDS.includes(kind)) {
      const s = String(struct?.structure ?? "insufficient");
      const direction = (({ upward: "upward_lean", downward: "downward_lean" } as Record<string, OutlookIn["direction"]>)[s]) ?? "neutral";
      const refp = m.reference_price;
      const sup = Object.values(levels).filter((l) => l.role === "support" && refp != null && l.upper < refp).sort((a, c) => c.upper - a.upper);
      const res = Object.values(levels).filter((l) => l.role === "resistance" && refp != null && l.lower > refp).sort((a, c) => a.lower - c.lower);
      const conds: OutlookIn["conditions"] = [], zones: string[] = [];
      if (res.length) {
        conds.push({ level_id: res[0].id, boundary: "upper", side: "above", effect: direction !== "downward_lean" ? "strengthens" : "weakens",
          text: `A sustained move above ${res[0].values[1]} would strengthen the upward interpretation.` });
        zones.push(res[0].id);
      }
      if (sup.length) {
        conds.push({ level_id: sup[0].id, boundary: "lower", side: "below", effect: direction !== "downward_lean" ? "weakens" : "strengthens",
          text: `A sustained move below ${sup[0].values[0]} would strengthen the downward interpretation.` });
        zones.push(sup[0].id);
      }
      outlook = { direction, qualification: "rule-based: derived from confirmed 1H swing structure only", conditions: conds, range_level_ids: [], zone_ids: zones };
      const change = conds.map((c) => `${c.text.replace(/\.$/, "")} [${c.level_id}].`).join("\n") || "No verified reference levels bracket the current price.";
      const eventsTxt = Object.keys(events).length ? "The scheduled releases in the table are the main tests of this interpretation." : "No high- or medium-impact releases are recorded for this period.";
      const weekly = cont.weekly;
      if (kind === "weekly_analysis") {
        sections = {
          weekly_bias: `The bias follows the confirmed 1H swing structure ${struct ? cite(struct.id) : ""}. It is a working interpretation, not a commitment.`,
          market_context: (prevw ? fx(prevw) : "No complete previous-week data is available.")
            + (cont.previous_weekly_review ? " The previous weekly review is recorded in the bundle." : " No previous weekly review was published."),
          fundamental_base: sideText("base"), fundamental_quote: sideText("quote"), key_events: eventsTxt, technical_picture: techTxt,
          what_would_change: change, key_question: "Will the scheduled releases confirm or weaken the current price structure?",
        };
      } else {
        const prog = (cont.daily ?? []).map((x: { period_key: string; direction_label: string }) => `${x.period_key}: ${x.direction_label}`).join("; ");
        const wk = weekly ? `The weekly outlook published ${weekly.published_display} was ${weekly.direction_label}.` : cont.note ?? "No weekly analysis was published.";
        sections = {
          market_context: wk + (prog ? ` Earlier daily outlooks this week: ${prog}.` : "") + (prev ? ` ${fx(prev)}` : "") + (ref ? ` ${fx(ref)}` : ""),
          fundamental_base: sideText("base"), fundamental_quote: sideText("quote"), technical_picture: techTxt,
          analytical_outlook: change + (Object.keys(events).length ? `\n${eventsTxt}` : ""),
          key_question: "Does price confirm a move beyond the nearest reference area, or remain between them?",
        };
      }
    } else if (kind === "daily_review") {
      const sess = facts[ev.session_fact ?? ""], evf = facts[ev.evaluation_fact ?? ""];
      const ctext = (ev.conditional ?? []).map((c: { side: string; boundary: string; outcome: string }) => `The published condition (${c.side} ${c.boundary}) was assessed as: ${c.outcome}${evf ? ` [${evf.id}]` : ""}.`).join(" ");
      sections = {
        expected_vs_actual: (sess ? fx(sess) : "No complete session data is available.") + (!evf && ctext ? ` ${ctext}` : ""),
        fundamental_base: sideText("base"), fundamental_quote: sideText("quote"),
        why_moved: Object.keys(policy).length ? "Reporting recorded in the bundle coincided with the session; see the cited items above."
          : "The bundle contains no attributed explanation for the move; the releases listed above coincided with the session.",
        technical_takeaway: (ev.zones ?? []).filter((z: { fact_id: string }) => z.fact_id).map((z: { fact_id: string }) => fx(facts[z.fact_id])).join(" ") || "No published reference areas were available to assess.",
        daily_conclusion: "The weekly interpretation is unchanged by this rule-based review; see the assessment above.",
      };
    } else {
      const wkf = facts[ev.week_fact ?? ""], wv = ev.weekly;
      const intro = wv ? `The original weekly outlook (${wv.original.published_display}) was ${wv.original.direction_label}; directional assessment: ${wv.directional} (${wv.explanation}).`
        : "No weekly analysis was published for this week; this review uses the working theme from the daily reports.";
      sections = {
        bias_vs_actual: wkf ? fx(wkf) : intro, fundamental_base: sideText("base"), fundamental_quote: sideText("quote"),
        why_sequence: "The rule-based writer does not attribute causes; the week's releases are listed above.",
        technical_review: (wv?.zones ?? []).filter((z: { fact_id: string }) => z.fact_id).map((z: { fact_id: string }) => fx(facts[z.fact_id])).join(" ") || "No published weekly reference areas were available to assess.",
        lesson: "Daily assessments in the table show where the price evidence agreed or disagreed with each published outlook.",
      };
    }
    return { sections, outlook, model: null };
  },
};
