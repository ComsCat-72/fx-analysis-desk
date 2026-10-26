// Report generation: decide what is due, assemble the inputs, ask Claude, check the wording, save.
import Anthropic from "@anthropic-ai/sdk";
import { checkReport } from "./checks.ts";
import { CONFIG, type InstrumentConfig, type Kind } from "./config.ts";
import { addDays, dayName, longDate, monday, stamp, todayLocal, weekday } from "./dates.ts";
import { calendarBlock, marketBlock, yahooDaily } from "./market.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { listReports, readReport, saveReport, slugFor, type StoredReport } from "./storage.ts";

export interface Job { kind: Kind; period: string }

/** Report slots due on a given EAT calendar day (the daily cron runs at 07:00 EAT). */
export function dueJobs(today: string): Job[] {
  const wd = weekday(today); // 0=Sun .. 6=Sat
  if (wd === 0) return [{ kind: "weekly_analysis", period: addDays(today, 1) }];
  if (wd === 6) return [{ kind: "daily_review", period: addDays(today, -1) }, { kind: "weekly_review", period: monday(today) }];
  const jobs: Job[] = wd === 1 ? [] : [{ kind: "daily_review", period: addDays(today, -1) }];
  return [...jobs, { kind: "daily_analysis", period: today }];
}

/** Normalise a requested period: weekly kinds are keyed by the Monday of the week they cover. */
export function normalisePeriod(kind: Kind, d: string): string {
  if (kind === "weekly_analysis") return weekday(d) === 0 ? addDays(d, 1) : monday(d);
  if (kind === "weekly_review") return monday(d);
  return d;
}

/** Published reports this report must stay consistent with. */
export async function earlierReports(instrument: string, kind: Kind, period: string): Promise<StoredReport[]> {
  const wk = monday(period);
  const keep = (slug: string) => {
    const d = slug.slice(0, 10);
    const k = slug.slice(11) as Kind;
    if (kind === "weekly_analysis") return d === addDays(wk, -7) && (k === "weekly_analysis" || k === "weekly_review");
    if (d < wk || d > addDays(wk, 6)) return false;
    if (kind === "weekly_review") return k !== "weekly_review";
    if (k === "weekly_analysis") return true;
    if (kind === "daily_review" && d === period) return k === "daily_analysis"; // the original being reviewed
    return d < period;
  };
  const picks = (await listReports(instrument)).filter((r) => keep(r.slug)).slice(-12);
  const loaded = await Promise.all(picks.map((r) => readReport(instrument, r.slug, r.url)));
  return loaded.filter((r): r is StoredReport => r !== null);
}

function describe(kind: Kind, period: string): string {
  const wk = monday(period);
  const range = `${longDate(wk)} – ${longDate(addDays(wk, 4))}`;
  return {
    weekly_analysis: `the WEEKLY ANALYSIS for the week ${range}`,
    daily_analysis: `the DAILY ANALYSIS for ${longDate(period)}`,
    daily_review: `the REVIEW of the session on ${longDate(period)} (${dayName(period)})`,
    weekly_review: `the WEEKLY REVIEW of the week ${range}`,
  }[kind];
}

export async function buildRequest(instrument: string, inst: InstrumentConfig, kind: Kind, period: string, now: Date): Promise<string> {
  const currencies = [inst.base, inst.quote].filter((c) => /^[A-Z]{3}$/.test(c) && c !== "XAU");
  const ccy = currencies.length ? currencies : ["USD"];
  const [data, calendar, earlier] = await Promise.all([yahooDaily(inst.yahoo), calendarBlock(ccy), earlierReports(instrument, kind, period)]);
  const continuity = earlier.length
    ? earlier.map((r) => `----- ${r.slug} (published ${stamp(r.meta.published)}) -----\n${r.markdown}`).join("\n\n")
      + (kind !== "weekly_analysis" && !earlier.some((r) => r.meta.kind === "weekly_analysis") ? "\nNote: no weekly analysis was published for this week." : "")
    : "None published yet." + (kind === "weekly_analysis" ? "" : " No weekly analysis exists for this week.");
  return `Write ${describe(kind, period)} for ${inst.name} (base: ${inst.base}, quote: ${inst.quote}).
Report type: ${kind}. Publication time: ${stamp(now)}. Follow the ${kind} template.

## Market data
${marketBlock(inst, data, kind, period)}

## Economic calendar (this week, times in ${CONFIG.timezoneLabel})
${calendar}

## Earlier reports (continuity — quote earlier biases exactly)
${continuity}

Search the web for the latest news, central-bank communication and data results for ${ccy.join(" and ")} relevant to this period, cite sources, then write the report.`;
}

type Msg = Anthropic.Beta.BetaMessageParam;

async function callClaude(client: Anthropic, messages: Msg[]): Promise<{ text: string; messages: Msg[] }> {
  let msgs = messages;
  for (let i = 0; i < 6; i++) {
    const res = await client.beta.messages.create({
      model: CONFIG.model,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: CONFIG.webSearchesPerReport }],
      messages: msgs,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: CONFIG.effort },
    });
    if (res.stop_reason === "refusal") throw new Error("Claude declined to write this report");
    msgs = [...msgs, { role: "assistant", content: res.content }];
    if (res.stop_reason === "pause_turn") continue; // server-side search loop paused: resume
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
    const start = text.indexOf("# ");
    return { text: start >= 0 ? text.slice(start) : text, messages: msgs };
  }
  throw new Error("Claude did not finish the report after several continuations");
}

export interface Result { instrument: string; kind: Kind; period: string; status: "written" | "skipped" | "failed"; detail?: string }

export async function generateReport(instrument: string, kind: Kind, period: string, force = false, now = new Date()): Promise<Result> {
  const inst = CONFIG.instruments[instrument];
  if (!inst) return { instrument, kind, period, status: "failed", detail: "unknown instrument" };
  const slug = slugFor(kind, period);
  if (!force && (await listReports(instrument)).some((r) => r.slug === slug)) {
    return { instrument, kind, period, status: "skipped", detail: "already published" };
  }
  try {
    const client = new Anthropic(); // reads ANTHROPIC_API_KEY
    const request = await buildRequest(instrument, inst, kind, period, now);
    let { text, messages } = await callClaude(client, [{ role: "user", content: request }]);
    let findings = checkReport(text);
    if (findings.length) {
      // One revision pass with the exact problems.
      const fix = "Rewrite the complete report, fixing these problems (no trading advice, no unapproved terms):\n"
        + findings.map((f) => `- ${f.what}: "${f.excerpt}"`).join("\n");
      const revised = await callClaude(client, [...messages, { role: "user", content: fix }]);
      if (revised.text.includes("# ")) text = revised.text;
      findings = checkReport(text);
    }
    await saveReport({
      slug, markdown: text,
      meta: { instrument, kind, period, published: now.toISOString(), model: CONFIG.model, check: findings.length ? "flagged" : "ok" },
    });
    return { instrument, kind, period, status: "written", detail: findings.length ? `${findings.length} wording flag(s) remain` : undefined };
  } catch (e) {
    return { instrument, kind, period, status: "failed", detail: e instanceof Error ? e.message : String(e) };
  }
}

/** All of today's due reports for one instrument, in order (the review is written before the analysis). */
export async function runDueForInstrument(instrument: string, today = todayLocal()): Promise<Result[]> {
  const out: Result[] = [];
  for (const job of dueJobs(today)) out.push(await generateReport(instrument, job.kind, job.period));
  return out;
}
