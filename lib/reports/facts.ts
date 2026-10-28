// Fact bundles: everything a report may state, each item with an id the text must cite (F# facts, L# levels,
// E# events, P# policy/news). Strictly as-of: only bars closed by the data cutoff, only event values recorded by
// the cutoff, only policy/news published by the cutoff, only reports published by the cutoff.
import { CONFIG, instrument, type Kind } from "../config.ts";
import { addDays, dateIn, displayZone, hhmm, isWeekday, monday, shortDate, stamp, weekDays, dayMonthYear, dayName } from "../dates.ts";
import * as T from "../core/technical.ts";
import { evaluateBreak, levelStatus, type BreakRules } from "../core/breaks.ts";
import { assessDirection, CORRECT_INCORRECT, DIRECTION_LABEL, type Direction } from "../core/evaluation.ts";
import { classifySurprise, revisionDirection } from "../core/events.ts";
import { dayWindow, weekWindow } from "../core/sessions.ts";
import { eventAsOf, eventCurrencies, type CalendarEvent } from "../data/calendar.ts";
import { isMonetaryPolicy, type NewsItem, type PolicyItem } from "../data/policy.ts";
import type { StoredLevel } from "../data/levels.ts";
import type { Series, SeriesBar } from "../data/yahoo.ts";
import type { Bundle, EventItem, Index, Item, LevelItem, Outlook, OutlookSummary, StoredCondition, StoredZone, VersionSummary } from "./types.ts";

export interface ResearchItem { title: string; source_name: string; url: string; published: string | null; summary: string; currencies: string[] }

export interface Context {
  code: string; kind: Kind; period: string; cutoff: number; series: Series;
  events: CalendarEvent[]; policy: PolicyItem[]; news: NewsItem[]; research: ResearchItem[];
  levels: StoredLevel[]; index: Index;
}

export const breakRules = (): BreakRules => ({ basis: CONFIG.technical.breaks.basis, sustainedCloses: CONFIG.technical.breaks.sustainedCloses, reversalCloses: CONFIG.technical.breaks.reversalCloses });

export function economies(code: string): [string, string][] {
  const i = instrument(code);
  if (i.kind === "fx_spot") return [["base", i.base], ["quote", i.quote]];
  if (i.kind === "metal") return [["base", "XAU (gold)"], ["quote", "USD"]];
  if (i.kind === "index_cash") return [["base", "US equities (Nasdaq-100)"], ["quote", "USD"]];
  return [["base", "USD"], ["quote", "Basket currencies (EUR, JPY, GBP, CAD, SEK, CHF)"]];
}

/** For BASE/QUOTE, a higher price means BASE strengthened against QUOTE. */
export function currencyEffect(base: string, quote: string, change: number): Record<string, string> {
  if (change === 0) return { [base]: "unchanged", [quote]: "unchanged" };
  return change > 0 ? { [base]: "stronger", [quote]: "weaker" } : { [base]: "weaker", [quote]: "stronger" };
}

const f = (x: number | null | undefined, d: number) => (x == null ? null : x.toFixed(d));
const signed = (x: number, d: number) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(d)}`;
const ohlc = (c: T.Bar, d: number) => [f(c.open, d), f(c.high, d), f(c.low, d), f(c.close, d)];
const nums = (t: string) => t.match(/[-+]?\d+(?:\.\d+)?/g) ?? [];
const iso = (t: number) => new Date(t).toISOString();

/** Hourly bars a full session should contain, for disclosure only. */
export function expectedH1(code: string, d: string): number {
  const i = instrument(code), w = dayWindow(i.session, d);
  if (i.session.open) return Math.ceil((w.end - w.start) / 3600_000);
  const h = Math.round((w.end - w.start) / 3600_000);
  return i.session.close === "17:00" ? h - 1 : h; // exchange futures pause for an hour after 17:00 New York
}

// ---------------------------------------------------------------- published versions (from the index)

export function published(index: Index, kind: Kind, o: { period?: string; week?: string; before?: number } = {}): (VersionSummary & { outlook?: Outlook; conclusion?: string; lesson?: string })[] {
  return (index.versions as (VersionSummary & { outlook?: Outlook })[])
    .filter((v) => v.status === "published" && v.kind === kind && (!o.period || v.period_key === o.period) && (!o.week || v.week_key === o.week)
      && (o.before == null || Date.parse(v.published_at!) <= o.before))
    .sort((a, b) => a.period_key.localeCompare(b.period_key) || a.version - b.version);
}

export function outlookSummary(v: VersionSummary & { outlook?: Outlook }): OutlookSummary | null {
  const o = v.outlook;
  if (!o) return null;
  return { version_id: v.id, version: v.version, version_type: v.version_type, period_key: v.period_key, published_at: v.published_at!,
    published_display: v.published_display!, data_cutoff_display: v.data_cutoff_display, direction: o.direction,
    direction_label: DIRECTION_LABEL[o.direction as Direction], qualification: o.qualification, conditions: o.conditions, reference_price: o.reference_price };
}

// ---------------------------------------------------------------- bundle

class Builder {
  b: Bundle;
  n = { F: 0, L: 0, E: 0, P: 0 };
  constructor(meta: Bundle["meta"]) {
    this.b = { meta, facts: {}, levels: {}, events: {}, policy: {}, continuity: {}, evaluation: null, warnings: [], missing: [] };
  }
  add<T extends Item>(group: "facts" | "levels" | "events" | "policy", prefix: "F" | "L" | "E" | "P", item: Omit<T, "id">): string {
    const id = `${prefix}${++this.n[prefix]}`;
    (this.b[group] as Record<string, Item>)[id] = { ...item, id } as unknown as Item;
    return id;
  }
}

export function buildBundle(ctx: Context): Bundle {
  const { code, kind, period, cutoff, series } = ctx;
  const inst = instrument(code), d = inst.decimals, rule = inst.session;
  const tc = CONFIG.technical, rules = breakRules();
  const wk = monday(period);
  const horizon = kind === "weekly_analysis" || kind === "weekly_review" ? weekWindow(rule, wk) : dayWindow(rule, period);
  const { timezone: tz, timezone_label: tzl } = displayZone();

  const B = new Builder({
    instrument: code, display: inst.display, base: inst.base, quote: inst.quote, instrument_kind: inst.kind, instrument_label: inst.label ?? null,
    economies: economies(code), kind, period_key: period, week_key: wk, horizon_start: iso(horizon.start), horizon_end: iso(horizon.end),
    horizon_display: `${stamp(horizon.start)} to ${stamp(horizon.end)}`, data_cutoff: iso(cutoff), data_cutoff_display: stamp(cutoff),
    display_timezone: tz, display_label: tzl, session_description: rule.description,
    break_rules: { basis: rules.basis, sustained_closes: rules.sustainedCloses, reversal_closes: rules.reversalCloses, timeframe: tc.breaks.timeframe },
    providers: [series.provider], data_mode: series.fixture ? "fixture" : "live", reference_price: null, reference_time: null, atr_d1: null,
    h1_structure: "insufficient", allowed_times: [], calendar_numbers: [], decimals: d,
  });
  const b = B.b;
  const src = series.fixture ? "DEVELOPMENT FIXTURE" : `Yahoo Finance ${inst.yahoo}`;
  if (series.fixture) b.warnings.push({ code: "fixture_data", severity: "info", message: "DEVELOPMENT FIXTURE: synthetic data, not market data." });

  const h1 = T.closedBefore(series.H1, cutoff), d1 = T.closedBefore(series.D1, cutoff) as SeriesBar[], w1 = T.closedBefore(series.W1, cutoff) as SeriesBar[];
  if (!h1.length || !d1.length) b.missing.push(`No complete price data for ${inst.display} before the data cutoff.`);

  // ---- reference price: a fresh quote while the market is open, else the latest complete hourly close
  let refPrice: number | null = null, refTime: number | null = null;
  const q = series.quote;
  if (q && q.time <= cutoff && cutoff - q.time <= 300_000) {
    refPrice = q.price; refTime = q.time;
    B.add("facts", "F", { kind: "price", role: "reference_price", values: [f(q.price, d)], source: src, time: iso(q.time),
      text: `${inst.display} latest quote ${f(q.price, d)} at ${stamp(q.time)} (${src}). This is a quote, not a closing price.` });
  } else if (h1.length) {
    const last = h1[h1.length - 1];
    refPrice = last.close; refTime = last.end;
    B.add("facts", "F", { kind: "price", role: "reference_price", values: [f(last.close, d)], source: src, time: iso(last.end),
      text: `Latest complete 1H bar for ${inst.display} closed at ${f(last.close, d)} at ${stamp(last.end)} (${src}). This is an hourly close, not a daily closing price.` });
  }
  b.meta.reference_price = refPrice;
  b.meta.reference_time = refTime ? iso(refTime) : null;

  const levelItem = (ref: string, tf: string, role: "support" | "resistance", lo: number, hi: number, reason: string): Omit<LevelItem, "id"> => {
    const area = lo === hi ? f(lo, d) : `${f(lo, d)}–${f(hi, d)}`;
    return { kind: "level", ref, role, lower: lo, upper: hi, timeframe: tf, origin: "automated", status: "active", break_confirmed: false,
      text: `${role === "support" ? "Support" : "Resistance"} reference ${area}: ${reason} (calculated).`, values: [f(lo, d), f(hi, d)] };
  };

  if (d1.length) {
    const p = d1[d1.length - 1];
    const chg = p.close - p.open;
    const n = h1.filter((c) => c.start >= p.start && c.start < p.end).length, exp = expectedH1(code, p.date!);
    const cover = n && n < exp ? `; ${n} of ${exp} hourly bars were provided by the source for this session` : "";
    B.add("facts", "F", { kind: "price", role: "previous_session", source: src, time: iso(p.end),
      values: [...ohlc(p, d), signed(chg, d), Math.abs(chg).toFixed(d)],
      text: `Previous complete session (${shortDate(p.date!)}, ended ${stamp(p.end)}): open ${f(p.open, d)}, high ${f(p.high, d)}, low ${f(p.low, d)}, close ${f(p.close, d)}; change ${signed(chg, d)} (${src} daily bar${cover}).` });
    B.add("levels", "L", levelItem(`D1:low:${p.date}`, "D1", "support", p.low, p.low, `previous session low (${p.date})`));
    B.add("levels", "L", levelItem(`D1:high:${p.date}`, "D1", "resistance", p.high, p.high, `previous session high (${p.date})`));
  }
  if (w1.length) {
    const pw = w1[w1.length - 1];
    B.add("facts", "F", { kind: "price", role: "previous_week", source: src, time: iso(pw.end),
      values: [...ohlc(pw, d), signed(pw.close - pw.open, d)],
      text: `Previous complete week (week of ${dayMonthYear(pw.date!)}): open ${f(pw.open, d)}, high ${f(pw.high, d)}, low ${f(pw.low, d)}, close ${f(pw.close, d)} (${src} weekly bar).` });
    B.add("levels", "L", levelItem(`W1:low:${pw.date}`, "W1", "support", pw.low, pw.low, `previous week low (week of ${pw.date})`));
    B.add("levels", "L", levelItem(`W1:high:${pw.date}`, "W1", "resistance", pw.high, pw.high, `previous week high (week of ${pw.date})`));
  }

  const atrD1 = T.atr(d1, tc.atrPeriod);
  b.meta.atr_d1 = atrD1;
  if (atrD1) B.add("facts", "F", { kind: "indicator", values: [f(atrD1, d)], source: "calculation",
    text: `ATR(${tc.atrPeriod}) on daily bars: ${f(atrD1, d)} (Wilder; volatility context only).` });
  const closes = d1.map((c) => c.close);
  for (const m of tc.movingAverages) {
    const v = m.type === "SMA" ? T.sma(closes, m.period) : T.ema(closes, m.period);
    if (v != null) B.add("facts", "F", { kind: "indicator", ma: `${m.type}(${m.period})`, position: closes[closes.length - 1] > v ? "above" : "below", values: [f(v, d)], source: "calculation",
      text: `${m.type}(${m.period}) of daily closes: ${f(v, d)}; the last daily close was ${closes[closes.length - 1] > v ? "above" : "below"} it.` });
  }
  if (tc.rsi.enabled) {
    const r = T.rsi(closes, tc.rsi.period);
    if (r != null) B.add("facts", "F", { kind: "indicator", values: [r.toFixed(1)], source: "calculation", text: `RSI(${tc.rsi.period}) daily: ${r.toFixed(1)}.` });
  }
  const swings = T.findSwings(h1, cutoff, tc.swings.left, tc.swings.right);
  const struct = T.structure(swings);
  b.meta.h1_structure = struct;
  const recent = swings.slice(-4);
  if (recent.length) B.add("facts", "F", { kind: "structure", structure: struct, values: recent.map((s) => f(s.price, d)), source: "calculation",
    text: `1H structure from confirmed swing points: ${struct}. Recent swings: ${recent.map((s) => `${s.label ?? s.kind} ${f(s.price, d)} (confirmed ${stamp(s.confirmedAt)})`).join("; ")}. `
      + `Swing rule: ${tc.swings.left} bars left, ${tc.swings.right} bars right; a swing counts only after the right-side bars close.` });
  const wtd = h1.filter((c) => c.start >= weekWindow(rule, wk).start);
  if (wtd.length && kind !== "weekly_analysis") {
    const hi = Math.max(...wtd.map((c) => c.high)), lo = Math.min(...wtd.map((c) => c.low));
    B.add("facts", "F", { kind: "price", values: [f(hi, d), f(lo, d)], source: src, text: `Range this week through the data cutoff: high ${f(hi, d)}, low ${f(lo, d)} (1H bars).` });
  }
  // Sessions in the lookback for which the source published no daily bar (holiday or data gap).
  const have = new Set(series.D1.map((c) => c.date));
  for (let x = addDays(dateIn(cutoff, rule.tz), -10); x <= dateIn(cutoff, rule.tz); x = addDays(x, 1)) {
    if (isWeekday(x) && dayWindow(rule, x).end <= cutoff && !have.has(x))
      b.warnings.push({ code: "missing_session", severity: "warning", message: `The source published no daily bar for ${x} (market holiday or data gap).` });
  }

  // ---- stored levels (yours or confirmed screenshot readings)
  for (const lv of ctx.levels) {
    if (["archived", "invalidated"].includes(lv.status) || lv.createdAt > cutoff) continue;
    const since = h1.filter((c) => c.start >= lv.createdAt);
    const st = levelStatus("active", lv.lower, lv.upper, lv.role, since, rules);
    const stale = cutoff - lv.createdAt > 7 * 86400_000;
    const note = stale ? ` Levels are carried forward from ${stamp(lv.createdAt)}; current structure has not been verified against them by the user.` : "";
    B.add("levels", "L", { kind: "level", ref: lv.id, role: lv.role, lower: lv.lower, upper: lv.upper, timeframe: lv.timeframe, origin: lv.origin,
      status: st.status, break_confirmed: st.status === "broken" || st.status === "reclaimed", status_reasons: st.reasons, values: [f(lv.lower, d), f(lv.upper, d)],
      text: `${lv.role === "support" ? "Support" : "Resistance"} area ${f(lv.lower, d)}–${f(lv.upper, d)} (${lv.timeframe}, ${lv.origin}${lv.approximate ? ", approximate reading from a screenshot" : ""}): ${lv.reason}. Status at cutoff: ${st.status}.${note}` } as Omit<LevelItem, "id">);
  }

  // ---- events
  const curs = eventCurrencies(code);
  const [evFrom, evTo] = kind === "weekly_analysis" || kind === "daily_analysis"
    ? [cutoff - (kind === "daily_analysis" ? 1 : 3) * 86400_000, horizon.end] : [horizon.start, horizon.end];
  const allowedTimes = new Set([hhmm(cutoff)]);
  for (const ev of ctx.events) {
    if (!curs.includes(ev.currency) || ev.scheduledAt < evFrom || ev.scheduledAt >= evTo || !CONFIG.calendar.impacts.includes(ev.impact ?? "")) continue;
    const st = eventAsOf(ev, cutoff);
    const surprise = st.actual ? classifySurprise(st.actual, st.consensus) : null;
    const t = stamp(ev.scheduledAt);
    allowedTimes.add(hhmm(ev.scheduledAt));
    const parts = [`${ev.currency} ${ev.title} — scheduled ${t} (source time ${ev.sourceTime})`, `consensus ${st.consensus ?? "not available"}, previous ${st.previous ?? "n/a"}`];
    if (st.revisedPrevious) parts.push(`previous revised to ${st.revisedPrevious} (${revisionDirection(st.previous, st.revisedPrevious)})`);
    if (st.state === "released" || st.state === "revised") parts.push(`actual ${st.actual} (${surprise}; source: ${st.actualSources.join(", ")})`);
    else if (st.state === "conflicting") parts.push("available sources disagree on the actual; interpretation is withheld pending verification");
    else if (ev.scheduledAt <= cutoff) parts.push(`the release was scheduled for ${t}, but the actual result is not yet verified`);
    if (st.state === "delayed") parts.push(`delayed; rescheduled to ${st.rescheduledTo}`);
    if (ev.fixture) parts.push("DEVELOPMENT FIXTURE");
    B.add<EventItem>("events", "E", { kind: "event", event_id: ev.id, currency: ev.currency, title: ev.title, impact: ev.impact, scheduled_at: iso(ev.scheduledAt),
      scheduled_display: t, source_time: ev.sourceTime, state: st.state, surprise, actual: st.actual, consensus: st.consensus, previous: st.previous,
      revised_previous: st.revisedPrevious, source: ev.source, text: parts.join("; ") + ".", values: [st.consensus, st.previous, st.actual, st.revisedPrevious] });
    if (st.state === "conflicting") b.warnings.push({ code: "source_conflict", severity: "warning", message: `Sources disagree on ${ev.title}; interpretation is withheld pending verification.` });
  }

  // ---- policy, news and research findings
  const pFrom = cutoff - 10 * 86400_000;
  for (const p of ctx.policy.filter((p) => curs.includes(p.currency) && p.publishedAt <= cutoff && p.publishedAt >= pFrom && isMonetaryPolicy(p.kind, p.title)).slice(0, 12)) {
    B.add("policy", "P", { kind: "policy", bank: p.bank, currency: p.currency, type: p.kind, title: p.title, url: p.url, published_at: iso(p.publishedAt), published_display: stamp(p.publishedAt),
      text: `${p.bank.toUpperCase()} ${p.kind}: "${p.title}" (${stamp(p.publishedAt)}). ${(p.summary ?? "").slice(0, 400)}`.trim(),
      values: [], numbers_in_text: nums(`${p.title} ${p.summary ?? ""}`), source: p.url ?? p.source });
  }
  const visible = ctx.news.filter((n) => n.publishedAt <= cutoff && n.publishedAt >= pFrom && (!n.currencies.length || n.currencies.some((c) => curs.includes(c))))
    .sort((a, c) => c.publishedAt - a.publishedAt);
  // Feed headlines: the newest few per currency, so one busy currency cannot crowd out the other side of the pair.
  const perCur = CONFIG.headlines.perCurrencyInBundle, taken = new Set<string>();
  const feed = curs.flatMap((c) => visible.filter((n) => n.enteredBy === "feed" && n.currencies.includes(c)).slice(0, perCur))
    .filter((n) => (taken.has(n.id) ? false : (taken.add(n.id), true)));
  for (const n of [...visible.filter((n) => n.enteredBy !== "feed").slice(0, 20), ...feed]) {
    const how = n.enteredBy === "user" ? "user-entered headline" : n.enteredBy === "feed" ? "headline only; article content not verified" : "found by web search";
    B.add("policy", "P", { kind: "news", source_name: n.sourceName, title: n.title, url: n.url, entered_by: n.enteredBy, currencies: n.currencies, published_at: iso(n.publishedAt),
      published_display: stamp(n.publishedAt),
      text: `${n.sourceName} (${how}): "${n.title}" (${stamp(n.publishedAt)}). ${(n.summary ?? "").slice(0, 400)}`.trim(),
      values: [], numbers_in_text: nums(`${n.title} ${n.summary ?? ""}`), source: n.url ?? n.sourceName });
  }
  for (const r of ctx.research) {
    B.add("policy", "P", { kind: "news", source_name: r.source_name, title: r.title, url: r.url, entered_by: "research", published_display: r.published ?? "date not stated",
      text: `${r.source_name} (found by web search${r.published ? `, ${r.published}` : ""}): "${r.title}". ${r.summary.slice(0, 500)}`.trim(),
      values: [], numbers_in_text: nums(`${r.title} ${r.summary}`), source: r.url });
  }

  continuity(B, ctx, wk);
  if (kind === "daily_review") dailyEvaluation(B, ctx, h1);
  else if (kind === "weekly_review") weeklyEvaluation(B, ctx, wk);

  // Times of earlier published reports are quotable too.
  const items = [b.continuity.weekly, b.continuity.previous_weekly, ...(b.continuity.daily ?? []), b.evaluation?.original, b.evaluation?.weekly?.original];
  for (const it of items) {
    if (it?.published_at) allowedTimes.add(hhmm(Date.parse(it.published_at)));
    if (it?.data_cutoff_display) allowedTimes.add(String(it.data_cutoff_display).split(" ").slice(-2)[0]);
  }
  b.meta.allowed_times = [...allowedTimes].sort();
  // Calendar days and years around the period may appear without a citation.
  const cal = new Set<string>();
  for (let i = -10; i < 12; i++) { const x = addDays(wk, i); cal.add(String(+x.slice(8, 10))); cal.add(x.slice(0, 4)); }
  b.meta.calendar_numbers = [...cal].sort();
  return b;
}

// ---------------------------------------------------------------- continuity

function continuity(B: Builder, ctx: Context, wk: string) {
  const { kind, period, cutoff, index } = ctx, b = B.b;
  const wv = published(index, "weekly_analysis", { period: wk, before: kind !== "weekly_review" ? cutoff : undefined });
  const orig = wv[0], latest = wv[wv.length - 1];
  b.continuity.weekly = orig ? outlookSummary(orig) : null;
  if (orig && latest && latest.id !== orig.id) b.continuity.weekly_latest = outlookSummary(latest);
  if (kind === "weekly_analysis") {
    const prevMon = addDays(wk, -7);
    const pr = published(index, "weekly_review", { period: prevMon, before: cutoff });
    b.continuity.previous_weekly_review = pr.length ? { version_id: pr[pr.length - 1].id, published_display: pr[pr.length - 1].published_display, summary: pr[pr.length - 1].lesson ?? null } : null;
    const pw = published(index, "weekly_analysis", { period: prevMon });
    b.continuity.previous_weekly = pw.length ? outlookSummary(pw[0]) : null;
    return;
  }
  const byDay: Record<string, OutlookSummary & { evaluation?: unknown; updates?: unknown[] }> = {};
  for (const dv of published(index, "daily_analysis", { week: wk, before: cutoff })) {
    if (kind === "daily_analysis" && dv.period_key >= period) continue;
    const s = outlookSummary(dv);
    if (!s) continue;
    if (!byDay[dv.period_key]) {
      const ev = index.evaluations.filter((e) => e.outlook_version_id === dv.id).pop();
      byDay[dv.period_key] = { ...s, evaluation: ev ? { directional: ev.directional, conditional: ev.conditional } : null };
    } else {
      (byDay[dv.period_key].updates ??= []).push({ version: s.version, type: s.version_type, direction: s.direction, published_display: s.published_display });
    }
  }
  b.continuity.daily = Object.values(byDay);
  b.continuity.reviews = published(index, "daily_review", { week: wk, before: kind !== "weekly_review" ? cutoff : undefined })
    .filter((r) => r.version === 1).map((r) => ({ period_key: r.period_key, published_display: r.published_display, conclusion: r.conclusion ?? null }));
  b.continuity.change_log = index.changes.filter((c) => c.week_key === wk && Date.parse(c.at) <= cutoff).map((c) => ({ at: c.at_display, from: c.from, to: c.to, evidence: c.evidence }));
  if (!b.continuity.weekly) b.continuity.note = "No weekly analysis was published for this week; continuity uses the working theme from the daily reports.";
}

// ---------------------------------------------------------------- evaluation for reviews

function conditionsEval(o: Outlook, bars: T.Bar[], d: number) {
  return o.conditions.map((c: StoredCondition) => {
    const r = evaluateBreak(bars, c.boundary, c.side, breakRules());
    return { id: c.id, text: c.text, boundary: f(c.boundary, d)!, side: c.side, effect: c.effect, outcome: r.outcome,
      confirmed_at: r.confirmedAt ? iso(r.confirmedAt) : null, reversed_at: r.reversedAt ? iso(r.reversedAt) : null, rejections: r.rejections };
  });
}

function zoneReactions(o: Outlook, bars: T.Bar[], d: number, word = "session") {
  return o.zones.map((z: StoredZone) => {
    const touched = bars.some((c) => c.low <= z.upper && c.high >= z.lower);
    const st = levelStatus("active", z.lower, z.upper, z.role, bars, breakRules());
    const br = evaluateBreak(bars, z.role === "support" ? z.lower : z.upper, z.role === "support" ? "below" : "above", breakRules());
    const Role = z.role === "support" ? "Support" : "Resistance";
    const [reaction, meaning] = !touched ? ["Not reached", `No test of this area in the ${word}.`]
      : st.status === "broken" ? ["Sustained break", `${Role} gave way under the configured close rule.`]
      : st.status === "reclaimed" ? ["Broken, then reclaimed", "The break did not hold."]
      : br.firstReachedAt && br.rejections ? ["Traded through, closed back", `${Role} held on a closing basis (rejection).`]
      : ["Tested, held", `${Role} held.`];
    const area = z.lower === z.upper ? f(z.lower, d)! : `${f(z.lower, d)}–${f(z.upper, d)}`;
    return { level_ref: z.ref, area, role: z.role, reaction, meaning, status: st.status, values: [f(z.lower, d), f(z.upper, d)], fact_id: "" };
  });
}

const label = (outcome: string) => (CONFIG.evaluation.wording === "correct_incorrect" ? CORRECT_INCORRECT[outcome as keyof typeof CORRECT_INCORRECT] : outcome);

function dailyEvaluation(B: Builder, ctx: Context, h1: T.Bar[]) {
  const { code, period, series, index } = ctx, b = B.b;
  const inst = instrument(code), d = inst.decimals;
  const pv = published(index, "daily_analysis", { period });
  const orig = pv[0], latest = pv[pv.length - 1];
  const w = dayWindow(inst.session, period);
  const day = series.D1.find((c) => c.date === period && c.end <= ctx.cutoff) ?? null;
  const ev: Record<string, any> = { session_date: period }; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (orig) ev.original = outlookSummary(orig);
  if (!day || !day.complete) {
    b.missing.push(`No complete session bar for ${period}; the review cannot assess the session.`);
    ev.session_incomplete = true;
    b.evaluation = ev;
    return;
  }
  const bars = h1.filter((c) => c.start >= w.start && c.start < w.end);
  const exp = expectedH1(code, period), maxMiss = CONFIG.technical.maxMissingH1 + (inst.kind === "fx_spot" && dayName(period) === "Monday" ? 2 : 0);
  if (bars.length < exp - maxMiss) b.warnings.push({ code: "intraday_gaps", severity: "warning", message: `Intraday checks for ${period} use ${bars.length} of ${exp} hourly bars provided by the source.` });
  const hiBar = bars.length ? bars.reduce((a, c) => (c.high > a.high ? c : a)) : null;
  const loBar = bars.length ? bars.reduce((a, c) => (c.low < a.low ? c : a)) : null;
  const atrV = orig?.outlook?.atr_at_publication ?? b.meta.atr_d1;
  const thr = atrV ? CONFIG.evaluation.inconclusiveAtrFraction * atrV : 0;
  const net = day.close - day.open;
  ev.session_direction = Math.abs(net) <= thr ? "consolidated" : net > 0 ? "rose" : "fell";
  const eff = inst.kind === "fx_spot" && ev.session_direction !== "consolidated" ? currencyEffect(inst.base, inst.quote, net) : null;
  const seq = hiBar && loBar ? ` The session high came at ${stamp(hiBar.start)} and the low at ${stamp(loBar.start)} (the ${hiBar.start < loBar.start ? "high" : "low"} came first).` : "";
  const src = series.fixture ? "DEVELOPMENT FIXTURE" : `Yahoo Finance ${inst.yahoo}`;
  ev.session_fact = B.add("facts", "F", { kind: "price", role: "reviewed_session", source: src,
    values: [...ohlc(day, d), signed(net, d), Math.abs(net).toFixed(d), f(thr, d)],
    text: `Reviewed session ${shortDate(period)} (ended ${stamp(day.end)}): open ${f(day.open, d)}, high ${f(day.high, d)}, low ${f(day.low, d)}, close ${f(day.close, d)}; net ${signed(net, d)}; `
      + `classified as '${ev.session_direction}' (threshold ${f(thr, d)} = ${CONFIG.evaluation.inconclusiveAtrFraction} x ATR).${seq}`
      + (eff ? ` Currency effect: ${Object.entries(eff).map(([k, v]) => `${k} ${v}`).join(", ")}.` : "") });
  if (!orig?.outlook) {
    b.missing.push(`No published daily analysis exists for ${period}; there is no original outlook to review.`);
    b.evaluation = ev;
    return;
  }
  const o = orig.outlook;
  const horizonBars = bars.filter((c) => c.start >= Date.parse(orig.data_cutoff));
  const rng: [number, number] | null = o.range_lower != null && o.range_upper != null ? [o.range_lower, o.range_upper] : null;
  const dr = assessDirection(o.direction as Direction, o.reference_price, day, o.atr_at_publication, CONFIG.evaluation, rng);
  Object.assign(ev, {
    original: outlookSummary(orig), latest: latest.id !== orig.id ? outlookSummary(latest) : null,
    directional: { outcome: dr.outcome, explanation: dr.explanation, net_from_reference: dr.net == null ? null : signed(dr.net, d),
      threshold: dr.threshold == null ? null : f(dr.threshold, d), label: label(dr.outcome) },
    conditional: conditionsEval(o, horizonBars, d), zones: zoneReactions(o, horizonBars, d),
  });
  const vals = [ev.directional.net_from_reference, ev.directional.threshold, f(o.reference_price, d), ...ev.conditional.map((c: { boundary: string }) => c.boundary)].filter(Boolean);
  ev.evaluation_fact = B.add("facts", "F", { kind: "evaluation", values: vals, source: "calculation",
    text: `Published outlook (v${orig.version}, ${ev.original.published_display}, data cutoff ${ev.original.data_cutoff_display}): ${ev.original.direction_label} `
      + `from reference ${f(o.reference_price, d)}. Directional assessment: ${dr.outcome} (${dr.explanation}).` });
  for (const z of ev.zones) z.fact_id = B.add("facts", "F", { kind: "reaction", values: z.values, source: "calculation", text: `Published ${z.role} ${z.area}: ${z.reaction}. ${z.meaning}` });
  b.evaluation = ev;
}

function weeklyEvaluation(B: Builder, ctx: Context, wk: string) {
  const { code, series, index } = ctx, b = B.b;
  const inst = instrument(code), d = inst.decimals;
  const ww = weekWindow(inst.session, wk);
  const week = series.W1.find((c) => c.date === wk && c.end <= ctx.cutoff) ?? null;
  const ev: Record<string, any> = { week: wk }; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!week || !week.complete) {
    b.missing.push("No complete weekly bar for the week; the weekly review cannot assess the week.");
    b.evaluation = ev;
    return;
  }
  const prior = series.W1.filter((c) => c.end <= ww.start && c.complete);
  const n = Math.min(14, prior.length);
  const atrW = n >= 4 ? T.atr(prior, n) : null;
  const thr = atrW ? CONFIG.evaluation.inconclusiveAtrFraction * atrW : null;
  const net = week.close - week.open;
  const dir = thr == null ? null : Math.abs(net) <= thr ? "consolidated" : net > 0 ? "rose" : "fell";
  ev.session_direction = dir;
  let prevDir: string | null = null;
  if (prior.length && thr != null) { const pn = prior[prior.length - 1].close - prior[prior.length - 1].open; prevDir = Math.abs(pn) <= thr ? "consolidated" : pn > 0 ? "rose" : "fell"; }
  // Heading word for "Why the Market Continued / Reversed / Consolidated" relative to the prior week.
  ev.sequence = dir == null ? null : dir === "consolidated" ? "consolidated" : prevDir === dir ? "continued" : prevDir === "rose" || prevDir === "fell" ? "reversed" : dir;
  const src = series.fixture ? "DEVELOPMENT FIXTURE" : `Yahoo Finance ${inst.yahoo}`;
  ev.week_fact = B.add("facts", "F", { kind: "price", role: "reviewed_week", source: src,
    values: [...ohlc(week, d), signed(net, d), f(atrW, d), f(thr, d)],
    text: `Week of ${dayMonthYear(wk)}: open ${f(week.open, d)}, high ${f(week.high, d)}, low ${f(week.low, d)}, close ${f(week.close, d)}; net ${signed(net, d)}`
      + (thr ? `; weekly ATR(${n}) ${f(atrW, d)}, threshold ${f(thr, d)}.` : "; weekly ATR not available (fewer than 4 prior weeks).") });
  const h1 = T.closedBefore(series.H1, ctx.cutoff);
  const wv = published(index, "weekly_analysis", { period: wk });
  const orig = wv[0];
  if (orig?.outlook) {
    const o = orig.outlook;
    const rng: [number, number] | null = o.range_lower != null && o.range_upper != null ? [o.range_lower, o.range_upper] : null;
    const dr = assessDirection(o.direction as Direction, o.reference_price, week, atrW, CONFIG.evaluation, rng);
    const bars = h1.filter((c) => c.start >= ww.start && c.start < ww.end && c.start >= Date.parse(orig.data_cutoff));
    ev.weekly = { original: outlookSummary(orig), directional: label(dr.outcome), explanation: dr.explanation, conditional: conditionsEval(o, bars, d), zones: zoneReactions(o, bars, d, "week") };
    for (const z of ev.weekly.zones) z.fact_id = B.add("facts", "F", { kind: "reaction", values: z.values, source: "calculation", text: `Weekly published ${z.role} ${z.area}: ${z.reaction}. ${z.meaning}` });
  } else ev.weekly = null;
  ev.days = weekDays(wk).map((day) => {
    const o0 = published(index, "daily_analysis", { period: day })[0];
    const row: Record<string, unknown> = { date: day, day: dayName(day) };
    const bar = series.D1.find((c) => c.date === day) ?? null;
    if (!o0?.outlook) return { ...row, published_bias: "No report published", directional: "Not assessable", conditional: "Not assessable" };
    const o = o0.outlook, w = dayWindow(inst.session, day);
    const bars = h1.filter((c) => c.start >= w.start && c.start < w.end && c.start >= Date.parse(o0.data_cutoff));
    const rng: [number, number] | null = o.range_lower != null && o.range_upper != null ? [o.range_lower, o.range_upper] : null;
    const dr = assessDirection(o.direction as Direction, o.reference_price, bar, o.atr_at_publication, CONFIG.evaluation, rng);
    const conds = conditionsEval(o, bars, d);
    return { ...row, published_bias: DIRECTION_LABEL[o.direction as Direction], directional: label(dr.outcome),
      conditional: conds.map((c) => `${c.side} ${c.boundary}: ${c.outcome}`).join("; ") || "No conditions stated", version: o0.version };
  });
  b.evaluation = ev;
}
