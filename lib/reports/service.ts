// Report lifecycle: draft -> checks -> publish (immutable) -> corrections and updates as new versions.
// Storage: one document per version plus one small index per instrument (what the dashboard lists).
//   reports/{inst}/{kind}/{period}/v{n}.draft.json   drafts (editable, removed once published or discarded)
//   reports/{inst}/{kind}/{period}/v{n}.json         published versions, written create-only: never overwritten
import { createHash } from "node:crypto";
import { ANALYSIS_KINDS, CONFIG, env, instrument, type Kind } from "../config.ts";
import { addDays, dateIn, dayName, isWeekday, monday, stamp } from "../dates.ts";
import { DIRECTION_LABEL, type Direction } from "../core/evaluation.ts";
import { dayWindow, weekWindow } from "../core/sessions.ts";
import { detectAdvice, finding, type Finding } from "../content/advice.ts";
import { runDeterministic, summarize } from "../content/checks.ts";
import { dictionary } from "../content/terminology.ts";
import { eventsBetween, recordValue } from "../data/calendar.ts";
import { levelsFor } from "../data/levels.ts";
import { headlineItems } from "../data/headlines.ts";
import { newsItems, policyItems } from "../data/policy.ts";
import { fetchSeries, type Series } from "../data/yahoo.ts";
import { getSettings } from "../settings.ts";
import { getJSON, putImmutable, putJSON, store, update } from "../store.ts";
import { claudeWriter, research, semanticReview, type ResearchResult, type Writer } from "./claude.ts";
import { buildBundle, economies, type ResearchItem } from "./facts.ts";
import { render } from "./render.ts";
import { headings } from "./templates.ts";
import { templateWriter } from "./templateWriter.ts";
import type { Bundle, Checks, Index, Outlook, OutlookIn, Version, VersionSummary } from "./types.ts";

export class PublishError extends Error {
  findings: Finding[];
  constructor(message: string, findings: Finding[] = []) { super(message); this.findings = findings; }
}

export const indexPath = (inst: string) => `index/${inst}.json`;
const emptyIndex = (inst: string): Index => ({ instrument: inst, versions: [], changes: [], evaluations: [], jobs: [], warnings: [], updated_at: null });
export const loadIndex = async (inst: string) => ({ ...emptyIndex(inst), ...((await getJSON<Index>(indexPath(inst))) ?? {}) });
export const updateIndex = (inst: string, fn: (ix: Index) => void) => update<Index>(indexPath(inst), () => emptyIndex(inst), (ix) => {
  const full = { ...emptyIndex(inst), ...ix };
  fn(full);
  full.updated_at = new Date().toISOString();
  return full;
});

export const periodKey = (kind: Kind, period: string) => (kind === "weekly_analysis" || kind === "weekly_review" ? monday(period) : period);
export const versionId = (inst: string, kind: Kind, period: string, n: number) => `${inst}.${kind}.${period}.${n}`;
export function parseId(id: string) {
  const [inst, kind, period, n] = id.split(".");
  if (!CONFIG.instruments[inst] || !n) throw new PublishError("no such version");
  return { inst, kind: kind as Kind, period, n: +n };
}
const docPath = (id: string, status: Version["status"]) => {
  const { inst, kind, period, n } = parseId(id);
  return `reports/${inst}/${kind}/${period}/v${n}${status === "published" ? "" : ".draft"}.json`;
};

type IndexEntry = VersionSummary & { outlook?: Outlook; conclusion?: string; lesson?: string };

export function summary(v: Version): IndexEntry {
  return {
    id: v.id, report_id: `${v.instrument}.${v.kind}.${v.period_key}`, kind: v.kind, period_key: v.period_key, week_key: v.week_key, version: v.version,
    version_type: v.version_type, status: v.status, title: v.title, writer: v.writer, data_mode: v.data_mode, partial: v.partial,
    created_display: stamp(v.created_at), published_display: v.published_at ? stamp(v.published_at) : null, data_cutoff_display: stamp(v.data_cutoff),
    blocking: v.checks.blocking, warnings: v.checks.warnings, change_note: v.change_note,
    direction: v.outlook?.direction ?? v.sections.outlook?.direction ?? null, created_at: v.created_at, published_at: v.published_at, data_cutoff: v.data_cutoff,
    ...(v.status === "published" && v.outlook ? { outlook: v.outlook } : {}),
    ...(v.status === "published" && v.kind === "daily_review" ? { conclusion: v.sections.text.daily_conclusion } : {}),
    ...(v.status === "published" && v.kind === "weekly_review" ? { lesson: v.sections.text.lesson } : {}),
  };
}

export async function getVersion(id: string): Promise<Version | null> {
  const { inst } = parseId(id);
  const ix = await loadIndex(inst);
  const s = ix.versions.find((v) => v.id === id);
  if (!s || s.status === "discarded") return null;
  return getJSON<Version>(docPath(id, s.status));
}

function validateOutlook(o: OutlookIn | null, b: Bundle): Finding[] {
  if (!o) return [];
  const out: Finding[] = [];
  for (const c of o.conditions) if (!b.levels[c.level_id]) out.push(finding("outlook", "unknown_level", "blocking", `Condition refers to unknown level ${c.level_id}.`));
  for (const id of [...o.zone_ids, ...o.range_level_ids]) if (!b.levels[id]) out.push(finding("outlook", "unknown_level", "blocking", `Outlook refers to unknown level ${id}.`));
  if (o.direction === "range_bound" && o.range_level_ids.length !== 2) out.push(finding("outlook", "range_without_bounds", "warning", "Range-bound outlook without two range levels; assessed without a range."));
  return out;
}

async function runChecks(kind: Kind, b: Bundle, sections: Record<string, string>, outlook: OutlookIn | null, semantic: Finding[] = []): Promise<Checks> {
  const dict = dictionary((await getSettings()).terms);
  const fs = runDeterministic(sections, b, dict, CONFIG.reports.lengthWords[kind], b.meta.decimals);
  fs.push(...validateOutlook(outlook, b));
  if (outlook?.qualification) fs.push(...detectAdvice(outlook.qualification, "bias"));
  for (const c of outlook?.conditions ?? []) fs.push(...detectAdvice(c.text, "conditions"));
  fs.push(...semantic);
  if (b.meta.data_mode === "fixture" && env.production) fs.push(finding("data", "fixture_in_production", "blocking", "Fixture data cannot be used in production."));
  return summarize(fs);
}

/** An explicit name wins (corrections reuse the original writer); otherwise the Configure setting decides.
 *  Claude runs only when it is chosen and ANTHROPIC_API_KEY is set; everything else uses the free template writer. */
export const writerFor = (name?: string | null, setting: "template" | "claude" = CONFIG.writer): Writer =>
  (name ?? setting) === "claude" && env.anthropicKey ? claudeWriter : templateWriter;

export interface DraftOpts {
  cutoff?: number; writer?: string | null; versionType?: "correction" | "update"; deadline?: number;
  research?: ResearchItem[] | null; // reuse earlier research (corrections) instead of searching again
  series?: Series; index?: Index; save?: boolean;
}

/** Build the bundle, write the sections, run the checks. Saved as a draft unless opts.save === false. */
export async function generateDraft(inst: string, kind: Kind, periodIn: string, o: DraftOpts = {}): Promise<Version> {
  instrument(inst);
  const period = periodKey(kind, periodIn);
  const deadline = o.deadline ?? Date.now() + 270_000;
  const writer = writerFor(o.writer, (await getSettings()).writer);
  const series = o.series ?? await fetchSeries(inst);
  const rule = instrument(inst).session;
  const horizon = kind === "weekly_analysis" || kind === "weekly_review" ? weekWindow(rule, period) : dayWindow(rule, period);
  const evWindow: [number, number] = [Math.min(horizon.start, Date.now()) - 4 * 86400_000, horizon.end + 86400_000];

  // Research (web search) runs before the cutoff is fixed, so what it finds is part of the evidence.
  let found: ResearchResult | null = null;
  let researchItems = o.research ?? [];
  if (writer.name === "claude" && o.research == null && o.cutoff == null) {
    try {
      found = await research(inst, kind, economies(inst), await eventsBetween(...evWindow), Date.now());
      researchItems = found.news;
      for (const a of found.actuals) {
        const ev = (await eventsBetween(...evWindow)).find((e) => e.id === a.event_id);
        if (ev) await recordValue(monday(new Date(ev.scheduledAt).toISOString().slice(0, 10)), ev.id, "actual", a.actual, `${a.source_name} (web search)`, a.url).catch(() => undefined);
      }
    } catch (e) {
      found = { news: [], actuals: [], model: null, searches: 0, sources: [`research failed: ${(e as Error).message}`] };
    }
  }
  const cutoff = o.cutoff ?? Date.now();
  const [events, policy, news, headlines, levels, index] = await Promise.all([eventsBetween(...evWindow), policyItems(), newsItems(), headlineItems(), levelsFor(inst), o.index ?? loadIndex(inst)]);
  const bundle = buildBundle({ code: inst, kind, period, cutoff, series, events, policy, news: [...news, ...headlines], research: researchItems, levels, index });
  const hd = headings(kind, bundle.meta, bundle.evaluation);
  const bounds = CONFIG.reports.lengthWords[kind];
  let result = await writer.write(kind, bundle, hd, bounds);
  let notes: string[] = [];
  const dict = dictionary((await getSettings()).terms);
  for (let i = 0; i < (writer.name === "template" ? 0 : CONFIG.reports.maxRevisions); i++) {
    if (Date.now() > deadline - 120_000) break; // no time left for another pass: the findings stay on the draft
    const pre = runDeterministic(result.sections, bundle, dict, bounds, bundle.meta.decimals);
    notes = pre.filter((f) => f.severity === "blocking" && f.check !== "data")
      .map((f) => `${f.message} Text: "${f.excerpt}"${f.suggestion ? ` Suggestion: ${f.suggestion}` : ""}`);
    if (!notes.length) break;
    result = await writer.write(kind, bundle, hd, bounds, notes);
  }

  const vs = index.versions.filter((v) => v.kind === kind && v.period_key === period);
  const hasPublished = vs.some((v) => v.status === "published");
  const n = Math.max(0, ...vs.map((v) => v.version)) + 1;
  const vtype = hasPublished ? o.versionType ?? "correction" : "original";
  const { title, body } = render(kind, bundle, result.sections, result.outlook, hd, { version: n, versionType: vtype });
  const semantic = writer.name === "template"
    ? [finding("semantic", "not_run", "info", "Template writer: text consists only of deterministic sentences; semantic review skipped.")]
    : Date.now() > deadline - 45_000
      ? [finding("semantic", "not_run", "blocking", "Semantic review skipped: the run ran out of time. Review the draft manually before publishing.")]
      : await semanticReview(body, bundle);
  const checks = await runChecks(kind, bundle, result.sections, result.outlook, semantic);
  const now = new Date().toISOString();
  const v: Version = {
    id: versionId(inst, kind, period, n), instrument: inst, kind, period_key: period, week_key: monday(period), version: n, status: "draft", version_type: vtype,
    title, body_md: body, sections: { text: result.sections, outlook: result.outlook, headings: hd, revision_notes: notes },
    facts: bundle, checks, data_cutoff: new Date(cutoff).toISOString(), created_at: now, published_at: null, change_note: null, supersedes_id: null,
    content_hash: null, writer: writer.name, model: result.model, data_mode: bundle.meta.data_mode, partial: false, missing: bundle.missing,
    outlook: null, evaluation: null, research: found ? { model: found.model, searches: found.searches, sources: found.sources } : null,
  };
  if (o.save !== false) await saveDraft(v);
  return v;
}

async function saveDraft(v: Version) {
  await putJSON(docPath(v.id, "draft"), v);
  await updateIndex(v.instrument, (ix) => {
    ix.versions = [...ix.versions.filter((x) => x.id !== v.id), summary(v)];
    ix.warnings = v.facts.warnings.map((w) => ({ ...w, at: v.created_at }));
  });
}

export async function updateDraft(id: string, sections: Record<string, string>, outlook?: OutlookIn | null): Promise<Version> {
  const v = await getVersion(id);
  if (!v) throw new PublishError("no such version");
  if (v.status !== "draft") throw new PublishError("only drafts can be edited; correct a published report as a new version");
  const o = outlook !== undefined ? outlook : v.sections.outlook;
  const { title, body } = render(v.kind, v.facts, sections, o, v.sections.headings, { version: v.version, versionType: v.version_type });
  const semantic = writerFor(null, (await getSettings()).writer).name === "claude" ? await semanticReview(body, v.facts) : [];
  Object.assign(v, { title, body_md: body, sections: { ...v.sections, text: sections, outlook: o, edited_manually: true }, checks: await runChecks(v.kind, v.facts, sections, o, semantic) });
  await saveDraft(v);
  return v;
}

/** Publish a draft (by id, or a Version object not yet stored). The published document is write-once. */
export async function publish(target: string | Version, changeNote?: string | null, allowPartial = false, nowMs = Date.now()): Promise<Version> {
  const stored = typeof target === "string";
  const v = stored ? await getVersion(target) : target;
  if (!v) throw new PublishError("no such version");
  if (v.status !== "draft") throw new PublishError(`version is ${v.status}, not a draft`);
  if (v.data_mode === "fixture" && env.production) throw new PublishError("fixture-based reports cannot be published in production");
  if (v.version_type !== "original" && !changeNote) throw new PublishError("a correction or update needs a change note");
  const outlook = v.sections.outlook;
  const checks = await runChecks(v.kind, v.facts, v.sections.text, outlook, v.checks.findings.filter((f) => f.check === "semantic"));
  const content = checks.findings.filter((f) => f.severity === "blocking" && f.check !== "data");
  const data = checks.findings.filter((f) => f.severity === "blocking" && f.check === "data");
  if (content.length) throw new PublishError(`${content.length} blocking content finding(s); revise the draft`, content);
  let partial = false;
  if (data.length) {
    if (CONFIG.reports.partialPublication === "label" && allowPartial) partial = true;
    else throw new PublishError(`${data.length} blocking data finding(s): essential data missing or unverified`, data);
  }
  const now = new Date(nowMs).toISOString();
  const { body } = render(v.kind, v.facts, v.sections.text, outlook, v.sections.headings, { version: v.version, versionType: v.version_type, published: now, changeNote, partial });
  const index = await loadIndex(v.instrument);
  const prev = index.versions.filter((x) => x.kind === v.kind && x.period_key === v.period_key && x.status === "published").sort((a, b) => a.version - b.version).pop();
  Object.assign(v, { body_md: body, checks: { ...checks, blocking: 0 }, change_note: changeNote ?? null, partial, published_at: now,
    content_hash: createHash("sha256").update(body).digest("hex"), supersedes_id: prev?.id ?? null, status: "published" as const });
  if (ANALYSIS_KINDS.includes(v.kind) && outlook) v.outlook = storedOutlook(v, outlook);
  if (v.kind === "daily_review" || v.kind === "weekly_review") v.evaluation = evaluationRecord(v);
  await putImmutable(docPath(v.id, "published"), v);
  if (stored) await store().del(docPath(v.id, "draft"));
  const discard = index.versions.filter((x) => x.kind === v.kind && x.period_key === v.period_key && x.status === "draft" && x.id !== v.id);
  await Promise.all(discard.map((x) => store().del(docPath(x.id, "draft"))));
  await updateIndex(v.instrument, (ix) => {
    ix.versions = [...ix.versions.filter((x) => x.id !== v.id).map((x) => (discard.some((d) => d.id === x.id) ? { ...x, status: "discarded" as const } : x)), summary(v)];
    if (v.evaluation) ix.evaluations = [...ix.evaluations.filter((e) => !(e.outlook_version_id === v.evaluation!.outlook_version_id)), v.evaluation].slice(-200);
    if (v.outlook) {
      // Outlook change log: compare with the most recent published outlook for this instrument and week.
      const last = (ix.versions as IndexEntry[]).filter((x) => x.id !== v.id && x.status === "published" && x.week_key === v.week_key && x.outlook)
        .sort((a, b) => Date.parse(a.published_at!) - Date.parse(b.published_at!)).pop();
      if (last?.outlook && (last.outlook.direction !== v.outlook.direction || v.version_type !== "original")) {
        const lab = (o: Outlook) => DIRECTION_LABEL[o.direction as Direction] + (o.qualification ? ` (${o.qualification})` : "");
        ix.changes.push({ at: now, at_display: stamp(now), week_key: v.week_key, previous_version_id: last.id, new_version_id: v.id, from: lab(last.outlook), to: lab(v.outlook),
          evidence: changeNote ?? (v.sections.text.market_context ?? v.sections.text.weekly_bias ?? "").slice(0, 600) });
      }
    }
  });
  return v;
}

function storedOutlook(v: Version, o: OutlookIn): Outlook {
  const b = v.facts, m = b.meta, lv = b.levels;
  const rng = o.range_level_ids.filter((x) => lv[x]).map((x) => lv[x]);
  return {
    kind: v.kind === "weekly_analysis" ? "weekly" : "daily", direction: o.direction, qualification: o.qualification || null,
    horizon_start: m.horizon_start, horizon_end: m.horizon_end, reference_price: m.reference_price, reference_time: m.reference_time, atr_at_publication: m.atr_d1,
    range_lower: rng.length === 2 ? Math.min(...rng.map((l) => l.lower)) : null, range_upper: rng.length === 2 ? Math.max(...rng.map((l) => l.upper)) : null,
    conditions: o.conditions.filter((c) => lv[c.level_id]).map((c, i) => ({ id: i + 1, text: c.text, level_ref: lv[c.level_id].ref, boundary: lv[c.level_id][c.boundary],
      boundary_edge: c.boundary, side: c.side, effect: c.effect })),
    zones: o.zone_ids.filter((x) => lv[x]).map((x) => ({ ref: lv[x].ref, role: lv[x].role, lower: lv[x].lower, upper: lv[x].upper, text: lv[x].text })),
    weekly_context_version_id: v.kind === "daily_analysis" ? b.continuity.weekly?.version_id ?? null : null,
    rules: { breaks: m.break_rules, evaluation: CONFIG.evaluation },
    evidence: [...Object.keys(b.facts), ...Object.keys(b.levels), ...Object.keys(b.events), ...Object.keys(b.policy)],
  };
}

function evaluationRecord(v: Version): Version["evaluation"] {
  const ev = v.facts.evaluation ?? {};
  const daily = v.kind === "daily_review";
  const orig = daily ? ev.original : ev.weekly?.original;
  if (!orig || (daily && !ev.directional)) return null;
  return {
    outlook_version_id: orig.version_id, period_key: v.period_key, kind: daily ? "daily" : "weekly", direction: orig.direction, qualification: orig.qualification,
    version: orig.version, directional: daily ? ev.directional.outcome : ev.weekly.directional, detail: daily ? ev.directional : { explanation: ev.weekly.explanation },
    conditional: daily ? ev.conditional : ev.weekly.conditional, session_ohlc: v.facts.facts[daily ? ev.session_fact : ev.week_fact]?.values ?? null, evaluated_at: v.published_at!,
  };
}

/** A new draft for a published report; the published version is untouched.
 *  correction: same data cutoff and evidence (fixes errors). update: new cutoff (later information). */
export async function correct(id: string, versionType: "correction" | "update" = "correction", writer?: string | null): Promise<Version> {
  const v = await getVersion(id);
  if (!v || v.status !== "published") throw new PublishError("only published versions can be corrected");
  const prior = Object.values(v.facts.policy).filter((p) => p.entered_by === "research")
    .map((p) => ({ title: String(p.title), source_name: String(p.source_name), url: String(p.url), published: p.published_display === "date not stated" ? null : String(p.published_display), summary: "", currencies: [] }));
  return generateDraft(v.instrument, v.kind, v.period_key, versionType === "correction"
    ? { cutoff: Date.parse(v.data_cutoff), research: prior, writer: writer ?? v.writer, versionType }
    : { writer: writer ?? v.writer, versionType });
}

// ---------------------------------------------------------------- schedule

/** The report period a job run at `now` is responsible for, or null if nothing is due. */
export function slotFor(job: Kind, inst: string, now = Date.now()): string | null {
  const rule = instrument(inst).session;
  const today = dateIn(now);
  if (job === "weekly_analysis") { const wd = new Date(`${today}T12:00:00Z`).getUTCDay(); return wd === 1 ? today : addDays(today, wd === 0 ? 1 : 8 - wd); }
  if (job === "daily_analysis") return isWeekday(today) ? today : null;
  if (job === "daily_review") {
    for (let d = addDays(today, -1), i = 0; i < 7; i++, d = addDays(d, -1)) if (isWeekday(d)) return dayWindow(rule, d).end <= now ? d : null;
    return null;
  }
  for (let d = addDays(today, -1), i = 0; i < 8; i++, d = addDays(d, -1)) if (dayName(d) === "Friday") return weekWindow(rule, monday(d)).end <= now ? monday(d) : null;
  return null;
}

/** Run one scheduled job for one instrument. Idempotent per (job, slot, instrument) unless forced. */
export async function runJob(job: Kind, inst: string, o: { force?: boolean; now?: number; writer?: string | null; deadline?: number } = {}) {
  const now = o.now ?? Date.now();
  const slot = slotFor(job, inst, now);
  if (!slot) return { job, instrument: inst, status: "skipped", reason: "no session due (weekend, holiday or session not closed yet)" };
  const index = await loadIndex(inst);
  const done = index.jobs.find((j) => j.job === job && j.slot === slot && ["succeeded", "running"].includes(j.status) && now - Date.parse(j.started_at) < (j.status === "running" ? 600_000 : Infinity));
  const hasVersion = index.versions.some((v) => v.kind === job && v.period_key === periodKey(job, slot) && v.status !== "discarded");
  if ((done || hasVersion) && !o.force) return { job, instrument: inst, slot, status: "duplicate" };
  const started = new Date(now).toISOString();
  const record = (patch: Partial<Index["jobs"][number]>) => updateIndex(inst, (ix) => {
    const cur = ix.jobs.find((j) => j.job === job && j.slot === slot && j.started_at === started);
    if (cur) Object.assign(cur, patch);
    else ix.jobs.push({ job, slot, instrument: inst, status: "running", attempts: 1, error: null, started_at: started, started_display: stamp(started), finished_at: null, version_id: null, ...patch });
    ix.jobs = ix.jobs.slice(-60);
  });
  await record({});
  try {
    const mode = (await getSettings()).publication_mode;
    const v = await generateDraft(inst, job, slot, { save: false, writer: o.writer, deadline: o.deadline });
    let status = "drafted";
    if (mode === "automatic" && v.checks.blocking === 0) {
      await publish(v, v.version_type !== "original" ? "Automatic regeneration" : null);
      status = "published";
    } else await saveDraft(v);
    await record({ status: "succeeded", finished_at: new Date().toISOString(), version_id: v.id, detail: status === "drafted" && mode === "automatic" ? `kept as draft: ${v.checks.blocking} blocking finding(s)` : status });
    return { job, instrument: inst, slot, status, version_id: v.id, blocking: v.checks.blocking };
  } catch (e) {
    const error = `${(e as Error).name}: ${(e as Error).message}`;
    await record({ status: "failed", finished_at: new Date().toISOString(), error }).catch(() => undefined);
    return { job, instrument: inst, slot, status: "failed", error };
  }
}

/** Jobs due for a cron run: "reviews" (03:00 UTC) or "analyses" (05:00 UTC), by weekday in the display timezone. */
export function dueJobs(run: "reviews" | "analyses", now = Date.now()): Kind[] {
  const wd = new Date(dateIn(now) + "T12:00:00Z").getUTCDay();
  if (run === "reviews") return wd >= 2 && wd <= 6 ? ["daily_review"] : [];
  return wd >= 1 && wd <= 5 ? ["daily_analysis"] : wd === 6 ? ["weekly_review"] : ["weekly_analysis"];
}
