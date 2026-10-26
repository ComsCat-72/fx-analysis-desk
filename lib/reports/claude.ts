// Every call to Claude: research (web search), the structured writer, the pre-publication reviewer and
// screenshot reading. Research and writing are separate calls: the writer only sees the fact bundle.
import Anthropic from "@anthropic-ai/sdk";
import { CONFIG, env, type Kind, ANALYSIS_KINDS } from "../config.ts";
import { finding, type Finding } from "../content/advice.ts";
import type { CalendarEvent } from "../data/calendar.ts";
import { eventAsOf } from "../data/calendar.ts";
import type { ResearchItem } from "./facts.ts";
import { RESEARCH_PROMPT, REVIEW_PROMPT, SYSTEM_PROMPT } from "./prompts.ts";
import { SECTIONS } from "./templates.ts";
import type { Bundle, OutlookIn } from "./types.ts";

type Msg = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlock;
export class WriterError extends Error {}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!env.anthropicKey) throw new WriterError("ANTHROPIC_API_KEY is not set on the server");
  return (client ??= new Anthropic({ apiKey: env.anthropicKey, maxRetries: 3 }));
}

const textOf = (content: Block[]) => content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();

async function create(params: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, "betas" | "fallbacks">) {
  try {
    return await anthropic().beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new WriterError(`Claude API error ${e.status ?? ""}: ${e.message}`);
    throw e;
  }
}

// ---------------------------------------------------------------- research

export interface ResearchResult { news: ResearchItem[]; actuals: { event_id: string; actual: string; source_name: string; url: string }[]; model: string | null; searches: number; sources: string[] }

export async function research(code: string, kind: Kind, economies: [string, string][], events: CalendarEvent[], now: number): Promise<ResearchResult> {
  const i = CONFIG.instruments[code];
  const days = kind === "weekly_analysis" || kind === "weekly_review" ? 7 : 3;
  const pending = events.filter((e) => e.scheduledAt <= now && !eventAsOf(e, now).actual && e.impact !== "Holiday");
  const request = `Instrument: ${i.display} (${i.label ?? `${i.base}/${i.quote}`})\nEconomies: ${economies.map(([, h]) => h).join("; ")}\n`
    + `Report type: ${kind}\nWindow: the ${days} days up to ${new Date(now).toISOString()}\n\n`
    + (pending.length ? `Released events without a verified actual:\n${pending.map((e) => `- ${e.currency} | ${e.title} | scheduled ${new Date(e.scheduledAt).toISOString()} | consensus ${e.consensus ?? "n/a"}`).join("\n")}\n` : "No releases are awaiting an actual.\n");
  let msgs: Msg[] = [{ role: "user", content: request }];
  const urls = new Set<string>();
  let searches = 0, model: string | null = null, text = "";
  for (let turn = 0; turn < 5; turn++) {
    const res = await create({
      model: CONFIG.models.research, max_tokens: 8000,
      system: [{ type: "text", text: RESEARCH_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: CONFIG.webSearchesPerReport }],
      messages: msgs, output_config: { effort: "low" },
    });
    model = res.model;
    for (const b of res.content) {
      if (b.type === "server_tool_use") searches++;
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) urls.add(r.url);
    }
    if (res.stop_reason === "refusal") throw new WriterError("research declined");
    msgs = [...msgs, { role: "assistant", content: res.content }];
    text = textOf(res.content);
    if (res.stop_reason !== "pause_turn") break;
  }
  const json = text.match(/```json\s*([\s\S]*?)```/)?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let parsed: { news?: ResearchItem[]; actuals?: { event: string; currency: string; actual: string; source_name: string; url: string }[] } = {};
  try { parsed = JSON.parse(json); } catch { parsed = {}; }
  // Only items whose URL actually came back from a search in this conversation are kept.
  const known = (u?: string) => !!u && [...urls].some((x) => x === u || x.replace(/\/$/, "") === u.replace(/\/$/, ""));
  const news = (parsed.news ?? []).filter((n) => n && n.title && known(n.url)).slice(0, 10)
    .map((n) => ({ title: String(n.title), source_name: String(n.source_name ?? new URL(n.url).hostname), url: n.url, published: n.published ?? null, summary: String(n.summary ?? ""), currencies: Array.isArray(n.currencies) ? n.currencies : [] }));
  const actuals = (parsed.actuals ?? []).flatMap((a) => {
    const ev = pending.find((e) => e.title === a.event && e.currency === a.currency);
    return ev && a.actual && known(a.url) ? [{ event_id: ev.id, actual: String(a.actual), source_name: String(a.source_name ?? "web"), url: a.url }] : [];
  });
  return { news, actuals, model, searches, sources: [...urls] };
}

// ---------------------------------------------------------------- writer

const DIRECTIONS = ["upward_lean", "downward_lean", "neutral", "range_bound"];

export function outputSchema(kind: Kind) {
  const secProps = Object.fromEntries(SECTIONS[kind].map(([k]) => [k, { type: "string" }]));
  const props: Record<string, unknown> = { sections: { type: "object", properties: secProps, required: Object.keys(secProps), additionalProperties: false } };
  const required = ["sections"];
  if (ANALYSIS_KINDS.includes(kind)) {
    props.outlook = {
      type: "object",
      properties: {
        direction: { type: "string", enum: DIRECTIONS },
        qualification: { type: "string", description: "Short qualifier, e.g. 'while support holds'" },
        conditions: { type: "array", items: { type: "object", properties: {
          level_id: { type: "string", description: "L# id of the level the condition refers to" },
          boundary: { type: "string", enum: ["lower", "upper"] }, side: { type: "string", enum: ["above", "below"] },
          effect: { type: "string", enum: ["strengthens", "weakens"] }, text: { type: "string" },
        }, required: ["level_id", "boundary", "side", "effect", "text"], additionalProperties: false } },
        range_level_ids: { type: "array", items: { type: "string" }, description: "For range_bound: [support L#, resistance L#]; otherwise empty" },
        zone_ids: { type: "array", items: { type: "string" }, description: "L# ids of the levels this report publishes as reference areas" },
      },
      required: ["direction", "qualification", "conditions", "range_level_ids", "zone_ids"], additionalProperties: false,
    };
    required.push("outlook");
  }
  return { type: "object", properties: props, required, additionalProperties: false };
}

function userMessage(kind: Kind, b: Bundle, hd: Record<string, string>, length: [number, number] | undefined, notes: string[] | null): string {
  const spec = SECTIONS[kind].map(([k, , g]) => `- \`${k}\` (${hd[k]}): ${g}`).join("\n");
  return `Report type: ${kind}\nInstrument: ${b.meta.display}\n\nSections to write:\n${spec}\n${length ? `Total length of all sections: ${length[0]}-${length[1]} words.` : ""}\n`
    + (ANALYSIS_KINDS.includes(kind) ? "\nAlso return the structured outlook. Conditions must reference level IDs from the bundle; `side` is where price must close relative to that level's `boundary` for the condition to be met.\n" : "")
    + (notes?.length ? `\n\nA previous draft failed these checks. Fix every one:\n${notes.map((n) => `- ${n}`).join("\n")}` : "")
    + `\n\nFact bundle (JSON):\n\`\`\`json\n${JSON.stringify(b, null, 1)}\n\`\`\``;
}

export interface WriterResult { sections: Record<string, string>; outlook: OutlookIn | null; model: string | null }
export interface Writer { name: string; write(kind: Kind, b: Bundle, hd: Record<string, string>, length?: [number, number], notes?: string[] | null): Promise<WriterResult> }

export const claudeWriter: Writer = {
  name: "claude",
  async write(kind, b, hd, length, notes = null) {
    const res = await create({
      model: CONFIG.models.writer, max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage(kind, b, hd, length, notes) }],
      output_config: { effort: CONFIG.effort, format: { type: "json_schema", schema: outputSchema(kind) } },
    });
    if (res.stop_reason === "refusal") throw new WriterError("the model declined to write this report");
    if (res.stop_reason === "max_tokens") throw new WriterError("the draft was cut off at max_tokens");
    const text = textOf(res.content);
    if (!text) throw new WriterError("no text in model response");
    const out = JSON.parse(text) as { sections: Record<string, string>; outlook?: OutlookIn };
    return { sections: out.sections, outlook: out.outlook ?? null, model: res.model };
  },
};

// ---------------------------------------------------------------- semantic review

const REVIEW_SCHEMA = {
  type: "object",
  properties: { issues: { type: "array", items: { type: "object", properties: {
    category: { type: "string", enum: ["advice", "terminology", "factual", "continuity", "integrity", "style"] },
    severity: { type: "string", enum: ["blocking", "warning"] }, quote: { type: "string" }, explanation: { type: "string" },
  }, required: ["category", "severity", "quote", "explanation"], additionalProperties: false } } },
  required: ["issues"], additionalProperties: false,
};

export async function semanticReview(body: string, b: Bundle): Promise<Finding[]> {
  if (!env.anthropicKey) return [finding("semantic", "not_run", "warning", "Semantic review not run (ANTHROPIC_API_KEY not set). Deterministic checks only.")];
  try {
    const res = await create({
      model: CONFIG.models.review, max_tokens: 8000,
      system: [{ type: "text", text: REVIEW_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Draft report:\n\n${body}\n\nFact bundle:\n\`\`\`json\n${JSON.stringify(b, null, 1)}\n\`\`\`` }],
      output_config: { effort: "high", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
    });
    if (res.stop_reason === "refusal") return [finding("semantic", "not_run", "blocking", "Semantic reviewer declined; manual review required.")];
    const issues = (JSON.parse(textOf(res.content) || "{}").issues ?? []) as { category: string; severity: "blocking" | "warning"; quote: string; explanation: string }[];
    return issues.map((i) => finding("semantic", i.category, i.severity, i.explanation, i.quote));
  } catch (e) {
    return [finding("semantic", "not_run", "blocking", `Semantic review failed: ${(e as Error).message}`)];
  }
}

// ---------------------------------------------------------------- screenshots

const SHOT_SCHEMA = {
  type: "object",
  properties: {
    timeframe: { type: "string", description: "Timeframe label visible on the chart, or 'unknown'" },
    chart_timestamp: { type: "string", description: "Latest date/time visible on the chart axis or header, or 'unknown'" },
    instrument: { type: "string" },
    levels: { type: "array", items: { type: "object", properties: {
      lower: { type: "number" }, upper: { type: "number" }, label: { type: "string", description: "Text drawn next to the level, if any" },
      clarity: { type: "string", enum: ["clear", "unclear"] } }, required: ["lower", "upper", "label", "clarity"], additionalProperties: false } },
    annotations: { type: "array", items: { type: "string" }, description: "User annotations exactly as written" },
  },
  required: ["timeframe", "chart_timestamp", "instrument", "levels", "annotations"], additionalProperties: false,
};
const SHOT_PROMPT = "Read this trading chart screenshot. Report only what is visible: the timeframe label, the latest visible timestamp, the instrument, "
  + "horizontal levels or zones drawn by the user (price readings from the axis), and any text annotations exactly as written. Do not describe what price did "
  + "after the screenshot, do not predict, and do not interpret annotations. Mark a level 'unclear' if its price cannot be read precisely from the axis.";

export async function readScreenshot(data: Buffer, mediaType: "image/png" | "image/jpeg" | "image/webp"): Promise<Record<string, unknown>> {
  if (!env.anthropicKey) return { status: "manual_entry_required", reason: "ANTHROPIC_API_KEY not set; enter levels manually." };
  const res = await create({
    model: CONFIG.models.vision, max_tokens: 4000,
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: data.toString("base64") } }, { type: "text", text: SHOT_PROMPT }] }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SHOT_SCHEMA } },
  });
  if (res.stop_reason === "refusal") return { status: "manual_entry_required", reason: "extraction declined" };
  return { ...JSON.parse(textOf(res.content) || "{}"), status: "needs_confirmation", note: "Approximate readings from a screenshot. Confirm or correct each level before use." };
}
