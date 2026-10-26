// Markdown rendering. Code-owned parts (header, bias line, tables, sources, notes, footer) are built here.
import type { Kind } from "../config.ts";
import { addDays, dayMonth, dayMonthYear, longDate, shortStamp, stamp, dayName } from "../dates.ts";
import { DIRECTION_LABEL, type Direction } from "../core/evaluation.ts";
import { citesIn } from "../content/checks.ts";
import { SECTIONS, TITLES, fill } from "./templates.ts";
import type { Bundle, OutlookIn } from "./types.ts";

export const FOOTER = "_Analysis only. This report explains market behaviour and does not recommend buying, selling or positioning in any market._";
const FIXTURE_BANNER = "> **DEVELOPMENT FIXTURE — SYNTHETIC DATA, NOT MARKET DATA.** Prices, events and levels in this report were generated for development and testing.";

function dateLine(kind: Kind, b: Bundle, published: string | null): string {
  const m = b.meta;
  const line = kind === "weekly_analysis" || kind === "weekly_review" ? `${dayMonth(m.week_key)}–${dayMonthYear(addDays(m.week_key, 4))}` : longDate(m.period_key);
  return `${line} | ${published ? stamp(published) : `DRAFT (data cutoff ${m.data_cutoff_display})`}`;
}

function eventsTable(b: Bundle): string {
  const evs = Object.values(b.events);
  if (!evs.length) return "_No high- or medium-impact releases are recorded for this period._";
  const rows = [`| Time (${b.meta.display_label}) | Currency | Event | Consensus | Previous | Actual | Status |`, "|---|---|---|---|---|---|---|"];
  for (const e of evs) {
    const actual = e.state === "released" || e.state === "revised" ? e.actual : "—";
    const status = ({ released: `Released (${e.surprise})`, revised: `Released, prior revised (${e.surprise})`, conflicting: "Sources disagree",
      delayed: "Delayed", unavailable: "Not yet verified", scheduled: "Scheduled" } as Record<string, string>)[e.state];
    rows.push(`| ${shortStamp(Date.parse(e.scheduled_at))} | ${e.currency} | ${e.title} [${e.id}] | ${e.consensus ?? "n/a"} | ${e.previous ?? "n/a"} | ${actual} | ${status} |`);
  }
  return rows.join("\n");
}

export function biasLine(o: OutlookIn | null): string {
  if (!o) return "";
  return `**Bias:** ${DIRECTION_LABEL[o.direction as Direction]}` + (o.qualification ? `, ${o.qualification}.` : ".");
}

function reviewHeader(kind: Kind, b: Bundle): string {
  const ev = b.evaluation ?? {};
  if (kind === "daily_review") {
    const o = ev.original;
    if (!o) return "_No published daily analysis exists for this session; there is no original outlook to compare against._";
    if (ev.session_incomplete) return `**Original outlook:** ${o.direction_label} — version ${o.version}, published ${o.published_display}. _The session's price data is incomplete, so the outlook is not assessed._`;
    const lines = [`**Original outlook:** ${o.direction_label}${o.qualification ? `, ${o.qualification}` : ""} — version ${o.version}, published ${o.published_display}, data cutoff ${o.data_cutoff_display}.`];
    if (ev.latest) lines.push(`_A later version (v${ev.latest.version}, ${ev.latest.version_type}, ${ev.latest.published_display}) changed the outlook to ${ev.latest.direction_label}; this review is assessed against the original._`);
    const d = ev.directional ?? {};
    lines.push(`**Directional assessment:** ${d.label} — ${d.explanation}.`);
    for (const c of ev.conditional ?? []) lines.push(`**Condition** (${c.side} ${c.boundary}): ${c.outcome}.`);
    return lines.join("\n\n");
  }
  if (kind === "weekly_review") {
    const w = ev.weekly;
    const head = w ? `**Original weekly outlook:** ${w.original.direction_label} — published ${w.original.published_display}. **Directional assessment:** ${w.directional} — ${w.explanation}.`
      : "**No weekly analysis was published for this week.** This review uses the working theme from the daily reports.";
    const rows = ["| Day | Published bias | Directional assessment | Conditional assessment |", "|---|---|---|---|"];
    for (const r of ev.days ?? []) rows.push(`| ${r.day} | ${r.published_bias} | ${r.directional} | ${r.conditional} |`);
    return `${head}\n\n${rows.join("\n")}`;
  }
  return "";
}

function reactionTable(b: Bundle, weekly = false): string {
  const ev = b.evaluation ?? {};
  const zones = (weekly ? ev.weekly?.zones : ev.zones) ?? [];
  if (!zones.length) return "";
  return ["| Published area | Observed reaction | Analytical meaning |", "|---|---|---|",
    ...zones.map((z: { role: string; area: string; reaction: string; meaning: string }) => `| ${z.role[0].toUpperCase()}${z.role.slice(1)} ${z.area} | ${z.reaction} | ${z.meaning} |`)].join("\n");
}

function sources(b: Bundle, body: string): string {
  const used = [...new Set(citesIn(body))];
  const items = { ...b.facts, ...b.levels, ...b.events, ...b.policy } as Record<string, { text: string; url?: string | null; source?: string | null }>;
  return used.sort((x, y) => x[0].localeCompare(y[0]) || +x.slice(1) - +y.slice(1)).flatMap((c) => {
    const it = items[c];
    if (!it) return [];
    const src = it.url || it.source || "";
    return [`- **[${c}]** ${it.text}` + (src && !it.text.includes(src) ? ` — _${src}_` : "")];
  }).join("\n");
}

export interface RenderOpts { version?: number; versionType?: string; published?: string | null; changeNote?: string | null; partial?: boolean }

export function render(kind: Kind, b: Bundle, sections: Record<string, string>, outlook: OutlookIn | null, hd: Record<string, string>, o: RenderOpts = {}): { title: string; body: string } {
  const m = b.meta;
  const title = fill(TITLES[kind], { display: m.display, day: dayName(m.period_key).toUpperCase(), date: longDate(m.period_key).split(" ").slice(1).join(" ") });
  const out = [`# ${title}`, dateLine(kind, b, o.published ?? null)];
  if (m.data_mode === "fixture") out.push(FIXTURE_BANNER);
  if (o.partial) out.push(`> **PARTIAL REPORT.** Some essential information was unavailable: ${b.missing.join("; ")}`);
  if (o.versionType && o.versionType !== "original") out.push(`> Version ${o.version} (${o.versionType}). ${o.changeNote ?? ""}`.trimEnd());
  if (m.instrument_label) out.push(`_${m.instrument_label}_`);
  if (kind === "daily_analysis") out.push(biasLine(outlook)); // the weekly analysis carries its bias inside "Weekly Bias"
  const parts: string[] = [];
  for (const [key] of SECTIONS[kind]) {
    const txt = (sections[key] ?? "").trim(), h = hd[key];
    if (key === "fundamental_base") {
      parts.push(kind === "daily_review" ? "## Fundamental Reaction — Both Economies" : kind === "weekly_review" ? "## Fundamental Review — Both Economies" : "## Fundamental Focus — Both Economies");
      if (kind === "daily_analysis") parts.push(`**Scheduled and released events**\n\n${eventsTable(b)}`);
    }
    if (key === "weekly_bias") { parts.push(`## ${h}\n\n${biasLine(outlook)} ${txt}`.trimEnd()); continue; }
    let block = `${key.startsWith("fundamental_") ? "###" : "##"} ${h}\n\n`;
    if (key === "expected_vs_actual" || key === "bias_vs_actual") block += reviewHeader(kind, b) + "\n\n";
    if (key === "key_events") block += eventsTable(b) + "\n\n";
    if (key === "technical_takeaway") { const t = reactionTable(b); if (t) block += t + "\n\n"; }
    if (key === "technical_review") { const t = reactionTable(b, true); if (t) block += t + "\n\n"; }
    parts.push(block + txt);
  }
  const body = parts.join("\n\n");
  out.push(body);
  const notes = b.warnings.filter((w) => w.code !== "fixture_data").map((w) => w.message);
  if (b.continuity?.note) notes.push(b.continuity.note);
  if (notes.length) out.push(`## Data Notes\n\n${notes.map((n) => `- ${n}`).join("\n")}`);
  out.push(`## Sources and Evidence\n\nData cutoff: ${m.data_cutoff_display}. Price source: ${m.providers.join(", ")}. Session: ${m.session_description}\n\n${sources(b, body)}`);
  out.push(FOOTER);
  return { title, body: out.filter(Boolean).join("\n\n") };
}
