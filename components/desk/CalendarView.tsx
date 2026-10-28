"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Filter, Play, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays } from "./App";
import { api, friendlyError, useNow, type CalRow } from "./api";
import { Badge, Button, Field, Spinner, cx, inputCls } from "./ui";

type Mode = "day" | "week" | "month";
const IMPACTS = ["High", "Medium", "Low", "Holiday"] as const;
const IMPACT_STYLE: Record<string, { color: string; bars: number; label: string }> = {
  High: { color: "var(--imp-high)", bars: 3, label: "High impact" },
  Medium: { color: "var(--imp-med)", bars: 2, label: "Medium impact" },
  Low: { color: "var(--imp-low)", bars: 1, label: "Low impact" },
  Holiday: { color: "var(--faint)", bars: 0, label: "Bank holiday" },
};

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthEnd = (d: string) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

function range(mode: Mode, anchor: string): [string, string] {
  if (mode === "day") return [anchor, anchor];
  if (mode === "week") { const sun = addDays(anchor, -new Date(`${anchor}T12:00:00Z`).getUTCDay()); return [sun, addDays(sun, 6)]; } // Sunday to Saturday, like Forex Factory
  return [monthStart(anchor), monthEnd(anchor)];
}

function Impact({ impact }: { impact: string }) {
  const s = IMPACT_STYLE[impact] ?? IMPACT_STYLE.Low;
  return (
    <span className="inline-flex h-4 items-end gap-[2px]" title={s.label} role="img" aria-label={s.label}>
      {s.bars === 0 ? <span className="size-2.5 rounded-full border-2" style={{ borderColor: s.color }} />
        : [1, 2, 3].map((i) => <span key={i} className="w-[4px] rounded-sm" style={{ height: `${4 + i * 3}px`, background: i <= s.bars ? s.color : "var(--border-strong)" }} />)}
    </span>
  );
}

function Actual({ r }: { r: CalRow }) {
  if (r.state === "conflicting") return <span className="text-[12px] text-warn" title={Object.entries(r.conflicting ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n")}>sources disagree</span>;
  // Speeches and statements have no figures, so nothing is pending for them.
  if (!r.actual) return Date.parse(r.at) <= Date.now() && !r.all_day && (r.forecast || r.previous) ? <span className="text-[12px] text-faint" title="Not yet recorded; the free Forex Factory feed has no actuals">pending</span> : null;
  const tone = r.tone === "better" ? "text-[var(--good)]" : r.tone === "worse" ? "text-[var(--bad)]" : "text-fg";
  return <span className={cx("font-semibold", tone)} title={r.tone === "better" ? "Better than forecast for the currency" : r.tone === "worse" ? "Worse than forecast for the currency" : "In line with forecast"}>{r.actual}</span>;
}

function Previous({ r }: { r: CalRow }) {
  if (!r.revised_previous) return <span>{r.previous ?? ""}</span>;
  return (
    <span className={cx("inline-flex items-center gap-1", r.revision === "up" ? "text-[var(--good)]" : r.revision === "down" ? "text-[var(--bad)]" : "")} title={`Revised from ${r.previous}`}>
      {r.revised_previous}<span className="size-0 border-y-[4px] border-l-[6px] border-y-transparent border-l-current opacity-70" aria-label="revised" />
    </span>
  );
}

function Detail({ r, onDone }: { r: CalRow; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ value: "", source: "", url: "" });
  const add = useMutation({ mutationFn: () => api.addActual(r.id, f.value, f.source, f.url || undefined),
    onSuccess: () => { setF({ value: "", source: "", url: "" }); qc.invalidateQueries({ queryKey: ["calrange"] }); qc.invalidateQueries({ queryKey: ["cal"] }); onDone(); } });
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
      <div className="grid gap-4 border-t border-line bg-surface-2 px-4 py-3 text-[12.5px] md:grid-cols-2">
        <div className="space-y-1.5">
          <p><span className="text-faint">Source:</span> {r.source}{r.is_fixture && <Badge tone="fixture" className="ml-1.5">fixture</Badge>}</p>
          <p><span className="text-faint">Original timestamp:</span> <span className="num">{r.source_time}</span></p>
          {r.actual_sources.length > 0 && <p><span className="text-faint">Actual from:</span> {r.actual_sources.join(", ")}</p>}
          <div>
            <p className="text-faint">Value history</p>
            <ul className="mt-0.5 space-y-0.5">
              {r.history.filter((h) => h.value != null).map((h, i) => (
                <li key={i} className="num text-[11.5px] text-muted">{h.at_display} · {h.field.replace("_", " ")} <span className="text-fg">{h.value}</span> · {h.url ? <a className="underline" href={h.url} target="_blank" rel="noreferrer">{h.source}</a> : h.source}</li>
              ))}
            </ul>
          </div>
        </div>
        {!r.all_day && (
          <form className="grid grid-cols-2 gap-2 self-start" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <p className="col-span-2 font-medium">Record the actual result</p>
            <Field label="Actual"><input className={inputCls} required value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder={r.forecast ?? "e.g. 0.3%"} /></Field>
            <Field label="Source"><input className={inputCls} required value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="official:ONS" /></Field>
            <div className="col-span-2"><Field label="Source URL (optional)" hint="Prefer the official statistics release. Values are kept in a history, never overwritten."><input className={inputCls} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field></div>
            {add.error && <p className="col-span-2 text-danger">{friendlyError(add.error)}</p>}
            <div className="col-span-2"><Button size="sm" variant="primary" type="submit" busy={add.isPending}>Save actual</Button></div>
          </form>
        )}
      </div>
    </motion.div>
  );
}

const COLS = "md:grid md:grid-cols-[76px_58px_46px_48px_minmax(0,1fr)_36px_84px_84px_84px] md:items-center";

function Row({ r, firstOfDay, firstOfTime, open, onToggle, rowRef, isNext, now }: { r: CalRow; firstOfDay: boolean; firstOfTime: boolean; open: boolean; onToggle: () => void; rowRef?: (el: HTMLDivElement | null) => void; isNext: boolean; now: number }) {
  const past = Date.parse(r.at) <= now;
  return (
    <div ref={rowRef} className={cx("cal-row", firstOfTime && "border-t border-line", isNext && "bg-accent-soft")}>
      {firstOfDay && <div className="border-b border-line bg-surface-2 px-3 py-1.5 text-[12px] font-semibold md:hidden">{fmt(r.date, { weekday: "long", day: "numeric", month: "short" })}</div>}
      <div className={cx(COLS, "hidden min-h-[30px] px-3 py-1 text-[12.5px]", past && !isNext && "opacity-75")}>
        <div className="text-[12px] leading-tight">{firstOfDay && <><div className="font-semibold">{fmt(r.date, { weekday: "short" })}</div><div className="text-muted">{fmt(r.date, { day: "numeric", month: "short" })}</div></>}</div>
        <div className={cx("num text-[12.5px]", past ? "text-faint" : "text-muted")}>
          {firstOfTime && (r.all_day ? "All day" : <span className="inline-flex items-center gap-1">{isNext && <Play className="size-3 fill-current text-accent" aria-label="Up next" />}{r.time}</span>)}
        </div>
        <div className="num font-semibold">{r.currency}</div>
        <div><Impact impact={r.impact} /></div>
        <div className={cx("min-w-0 truncate", r.impact === "High" && "font-medium")} title={r.title}>{r.title}</div>
        <div><button onClick={onToggle} aria-expanded={open} className="grid size-7 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-fg" title="Details and record actual"><ChevronDown className={cx("size-4 transition-transform", open && "rotate-180")} /><span className="sr-only">Details for {r.title}</span></button></div>
        <div className="num text-right"><Actual r={r} /></div>
        <div className="num text-right text-muted">{r.forecast ?? ""}</div>
        <div className="num text-right text-muted"><Previous r={r} /></div>
      </div>
      <button onClick={onToggle} aria-expanded={open} className="w-full cursor-pointer px-3 py-2.5 text-left md:hidden">
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="num w-11 text-muted">{r.all_day ? "All day" : r.time}</span>
          <span className="num font-semibold">{r.currency}</span><Impact impact={r.impact} />
          {isNext && <Badge tone="accent">Up next</Badge>}
          <ChevronDown className={cx("ml-auto size-4 text-faint transition-transform", open && "rotate-180")} aria-hidden />
        </div>
        <div className="mt-0.5 text-[13.5px] font-medium">{r.title}</div>
        {(r.actual || r.forecast || r.previous) && (
          <div className="num mt-1 flex gap-4 text-[12px]">
            <span><span className="text-faint">Act </span><Actual r={r} /></span>
            <span><span className="text-faint">Fcst </span>{r.forecast ?? "—"}</span>
            <span><span className="text-faint">Prev </span><Previous r={r} /></span>
          </div>
        )}
      </button>
      <AnimatePresence initial={false}>{open && <Detail r={r} onDone={onToggle} />}</AnimatePresence>
    </div>
  );
}

function MiniMonth({ month, selected, today, mode, onPick, marked }: { month: string; selected: [string, string]; today: string; mode: Mode; onPick: (d: string, m: Mode) => void; marked: Set<string> }) {
  const first = monthStart(month);
  const start = addDays(first, -((new Date(`${first}T12:00:00Z`).getUTCDay() + 7) % 7)); // weeks start on Sunday, like Forex Factory
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
  return (
    <table className="w-full text-center text-[12px]" aria-label={fmt(first, { month: "long", year: "numeric" })}>
      <thead><tr><th className="w-6" />{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <th key={i} className="pb-1 font-medium text-faint">{d}</th>)}</tr></thead>
      <tbody>
        {weeks.map((wk) => (
          <tr key={wk[0]}>
            <td><button className="grid size-6 cursor-pointer place-items-center rounded text-faint hover:bg-surface-3 hover:text-fg" onClick={() => onPick(wk[1], "week")} aria-label={`Week of ${wk[1]}`}><ChevronsRight className="size-3" /></button></td>
            {wk.map((d) => {
              const inSel = d >= selected[0] && d <= selected[1] && mode !== "month";
              return (
                <td key={d} className="p-[1px]">
                  <button onClick={() => onPick(d, "day")} aria-current={d === today ? "date" : undefined}
                    className={cx("num relative h-7 w-full cursor-pointer rounded-md transition-colors", d.slice(0, 7) !== month.slice(0, 7) && "text-faint/60",
                      inSel ? "bg-accent-soft text-fg" : "hover:bg-surface-3", d === today && "ring-1 ring-accent font-semibold text-accent")}>
                    {Number(d.slice(8))}
                    {marked.has(d) && <span className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent/70" aria-hidden />}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CalendarView({ today, instrumentCurrencies }: { today: string; instrumentCurrencies: string[] }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("day"); // opens on today, like Forex Factory
  const [anchor, setAnchor] = useState(today);
  const [month, setMonth] = useState(today);
  const [open, setOpen] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [filter, setFilter] = useState<{ currencies: string[]; impacts: string[] }>(() => {
    try { return JSON.parse(localStorage.getItem("fx.calFilter") ?? "") as { currencies: string[]; impacts: string[] }; } catch { return { currencies: [], impacts: [] }; }
  });
  useEffect(() => { try { localStorage.setItem("fx.calFilter", JSON.stringify(filter)); } catch { /* storage unavailable */ } }, [filter]);
  const [from, to] = range(mode, anchor);
  const data = useQuery({ queryKey: ["calrange", from, to, filter], queryFn: () => api.calendarRange(from, to, filter.currencies, filter.impacts), refetchInterval: 60_000 });
  const monthData = useQuery({ queryKey: ["calrange", monthStart(month), monthEnd(month), filter], queryFn: () => api.calendarRange(monthStart(month), monthEnd(month), filter.currencies, filter.impacts) });
  const marked = useMemo(() => new Set(monthData.data?.rows.map((r) => r.date)), [monthData.data]);
  const refresh = useMutation({ mutationFn: api.refreshCalendar, onSuccess: () => qc.invalidateQueries({ queryKey: ["calrange"] }) });
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const pick = (d: string, m: Mode) => { setAnchor(d); setMode(m); setMonth(d); setOpen(null); };
  const step = (n: number) => pick(mode === "day" ? addDays(anchor, n) : mode === "week" ? addDays(anchor, 7 * n) : addDays(monthStart(anchor), n > 0 ? 32 : -1), mode);
  const upNext = () => {
    const next = data.data?.rows.find((r) => r.id === nextId);
    if (next) refs.current[next.id]?.scrollIntoView({ block: "center", behavior: "smooth" });
    else pick(today, "week");
  };
  const rows = data.data?.rows ?? [];
  const title = mode === "day" ? `${anchor === today ? "Today: " : ""}${fmt(anchor, { weekday: "short", day: "numeric", month: "short" })}`
    : mode === "week" ? `Week of ${fmt(addDays(range("week", anchor)[0], 1), { day: "numeric", month: "short" })}` : fmt(anchor, { month: "long", year: "numeric" });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const now = useNow(30_000); // the "now" line and Up next follow the browser clock
  const nowIdx = rows.findIndex((r) => Date.parse(r.at) > now);
  const nextId = rows.find((r) => Date.parse(r.at) > now && r.impact !== "Holiday")?.id;
  const quick: [string, () => void][] = [
    ["Today", () => pick(today, "day")], ["Tomorrow", () => pick(addDays(today, 1), "day")], ["Yesterday", () => pick(addDays(today, -1), "day")],
    ["This week", () => pick(today, "week")], ["Next week", () => pick(addDays(today, 7), "week")], ["Last week", () => pick(addDays(today, -7), "week")],
    ["This month", () => pick(today, "month")], ["Up next", upNext],
  ];

  return (
    <div className="grid gap-3 lg:h-[calc(100dvh-7.5rem)] lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="panel order-2 h-fit space-y-3 p-3 lg:order-none lg:sticky lg:top-24">
        <div className="flex items-center justify-between">
          <button className="grid size-7 cursor-pointer place-items-center rounded text-muted hover:bg-surface-3" onClick={() => setMonth(addDays(monthStart(month), -1))} aria-label="Previous month"><ChevronsLeft className="size-4" /></button>
          <button className="cursor-pointer text-[13px] font-semibold hover:text-accent" onClick={() => pick(month, "month")}>{fmt(month, { month: "short", year: "numeric" })}</button>
          <button className="grid size-7 cursor-pointer place-items-center rounded text-muted hover:bg-surface-3" onClick={() => setMonth(addDays(monthStart(month), 32))} aria-label="Next month"><ChevronsRight className="size-4" /></button>
        </div>
        <MiniMonth month={month} selected={[from, to]} today={today} mode={mode} onPick={pick} marked={marked} />
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 border-t border-line pt-2.5 text-[12.5px]">
          {quick.map(([l, fn]) => <button key={l} onClick={fn} className="cursor-pointer rounded px-1.5 py-1 text-left text-accent hover:bg-surface-3">{l}</button>)}
        </div>
      </aside>

      <section className="panel flex min-w-0 flex-col overflow-hidden lg:h-full">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div className="flex items-center rounded-lg border border-line bg-surface-2">
            <button className="grid size-9 cursor-pointer place-items-center rounded-l-lg text-muted hover:bg-surface-3 hover:text-fg" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft className="size-4" /></button>
            <span className="min-w-[9.5rem] px-2 text-center text-[13.5px] font-semibold">{title}</span>
            <button className="grid size-9 cursor-pointer place-items-center rounded-r-lg text-muted hover:bg-surface-3 hover:text-fg" onClick={() => step(1)} aria-label="Next"><ChevronRight className="size-4" /></button>
          </div>
          <div className="flex rounded-lg border border-line bg-surface-2 p-0.5" role="group" aria-label="Range">
            {(["day", "week", "month"] as Mode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                className={cx("cursor-pointer rounded-md px-2.5 py-1 text-[12.5px] capitalize", mode === m ? "bg-accent-soft font-medium text-fg" : "text-muted hover:text-fg")}>{m}</button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={upNext}><Play className="size-3.5 fill-current" aria-hidden />Up next</Button>
            <Button size="sm" variant={filter.currencies.length || filter.impacts.length ? "primary" : "secondary"} onClick={() => setShowFilter(!showFilter)} title="Filter by currency and impact">
              <Filter className="size-4" aria-hidden />Filter{filter.currencies.length + filter.impacts.length ? ` (${filter.currencies.length + filter.impacts.length})` : ""}
            </Button>
            <Button size="sm" variant="ghost" busy={refresh.isPending} onClick={() => refresh.mutate()} title="Fetch the latest Forex Factory weekly feed">{!refresh.isPending && <RefreshCw className="size-4" aria-hidden />}<span className="sr-only">Refresh</span></Button>
            <Badge title={data.data?.timezone}>{data.data?.timezone_label ?? "…"}</Badge>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {showFilter && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b border-line bg-surface-2">
              <div className="space-y-3 px-4 py-3 text-[12.5px]">
                <div>
                  <p className="mb-1.5 font-medium text-muted">Impact</p>
                  <div className="flex flex-wrap gap-1.5">
                    {IMPACTS.map((i) => (
                      <button key={i} onClick={() => setFilter({ ...filter, impacts: toggle(filter.impacts, i) })} aria-pressed={filter.impacts.includes(i)}
                        className={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1", filter.impacts.includes(i) ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-3")}>
                        <Impact impact={i} />{i}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 font-medium text-muted">Currencies</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[...new Set([...(data.data?.currencies ?? []), ...(monthData.data?.currencies ?? []), ...filter.currencies])].sort().map((c) => (
                      <button key={c} onClick={() => setFilter({ ...filter, currencies: toggle(filter.currencies, c) })} aria-pressed={filter.currencies.includes(c)}
                        className={cx("num cursor-pointer rounded-lg border px-2.5 py-1", filter.currencies.includes(c) ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-3")}>{c}</button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setFilter({ ...filter, currencies: instrumentCurrencies })}>Only the selected instrument's currencies</Button>
                  <Button size="sm" variant="ghost" onClick={() => setFilter({ currencies: [], impacts: [] })}>Show everything</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={cx(COLS, "hidden border-b border-line bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint")}>
          <span>Date</span><span>Time</span><span>Cur.</span><span>Impact</span><span>Event</span><span>Detail</span><span className="text-right">Actual</span><span className="text-right">Forecast</span><span className="text-right">Previous</span>
        </div>
        {data.isLoading ? <Spinner label="Loading calendar" /> : data.error ? <p className="p-4 text-sm text-danger">{friendlyError(data.error)}</p> : rows.length === 0 ? (
          <div className="space-y-1 p-6 text-center text-sm text-muted">
            <p>No events stored for this {mode}{filter.currencies.length || filter.impacts.length ? " with the current filter" : ""}.</p>
            <p className="text-[12.5px] text-faint">Forex Factory's free feed covers the current week. Earlier weeks are kept as they were fetched, and next week appears once Forex Factory publishes it. Use the refresh button to fetch the latest.</p>
          </div>
        ) : (
          <div role="table" aria-label="Economic calendar" className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((r, i) => (
              <div key={r.id}>
                {i === nowIdx && i > 0 && <div className="relative h-0 border-t-2 border-accent" aria-label="Now"><span className="absolute -top-2.5 left-3 rounded bg-accent px-1.5 text-[10px] font-semibold uppercase text-white">now</span></div>}
                <Row r={r} firstOfDay={i === 0 || rows[i - 1].date !== r.date} firstOfTime={i === 0 || rows[i - 1].date !== r.date || rows[i - 1].time !== r.time}
                  open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} rowRef={(el) => { refs.current[r.id] = el; }} isNext={r.id === nextId} now={now} />
              </div>
            ))}
          </div>
        )}
        <p className="border-t border-line px-4 py-2 text-[11.5px] text-faint">
          Schedule, forecast and previous: Forex Factory weekly export. Actual results: biquote.io free economic calendar, refreshed every two minutes while the calendar is open (and editable in each row's details).
          {data.data?.actuals_sync?.error && <span className="text-warn"> {data.data.actuals_sync.error}.</span>}
          Green and red show whether the actual was better or worse than the forecast for that currency; it is not a market call.
          {data.data && <> Times in {data.data.timezone_label} ({data.data.timezone}).</>}
        </p>
      </section>
    </div>
  );
}
