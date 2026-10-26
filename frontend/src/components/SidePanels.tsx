import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, BookOpenCheck, CalendarClock, Clock, ImageUp, Layers, Plus, ScanSearch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type FactItem } from "../api";
import { Badge, Button, DirectionTag, Empty, Field, Panel, Spinner, cx, inputCls } from "../ui";

export function FreshnessBar({ instrument }: { instrument: string }) {
  const f = useQuery({ queryKey: ["fresh", instrument], queryFn: () => api.freshness(instrument), refetchInterval: 60_000 });
  const w = useQuery({ queryKey: ["warnings", instrument], queryFn: () => api.warnings(instrument), refetchInterval: 60_000 });
  const conflicts = (w.data ?? []).filter((x) => x.code === "source_conflict");
  if (!f.data) return null;
  const tone = f.data.status === "ok" ? "ok" : f.data.status === "stale" ? "warn" : "danger";
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]" aria-live="polite">
      <Badge tone={tone}><Clock className="size-3" />Data {f.data.status === "ok" ? "fresh" : f.data.status}</Badge>
      <span className="text-muted">{f.data.message}</span>
      {f.data.last_h1_close && <span className="num text-faint">Last 1H close {f.data.last_h1_close} · {f.data.provider}</span>}
      <Badge tone={f.data.market_open ? "accent" : "neutral"}>{f.data.market_open ? "Market open" : "Market closed"}</Badge>
      {f.data.is_fixture && <Badge tone="fixture">Prices are development fixtures</Badge>}
      {conflicts.length > 0 && <Badge tone="danger"><AlertTriangle className="size-3" />{conflicts.length} source conflict{conflicts.length > 1 ? "s" : ""}: interpretation withheld</Badge>}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { price: "Price", indicator: "Indicator", structure: "Structure", level: "Level", event: "Release",
  policy: "Central bank", news: "Headline", evaluation: "Evaluation", reaction: "Reaction" };

export function EvidencePanel({ versionId, focus }: { versionId: number | null; focus: string | null }) {
  const r = useQuery({ queryKey: ["report", versionId], queryFn: () => api.report(versionId!), enabled: versionId != null });
  const refs = useRef<Record<string, HTMLLIElement | null>>({});
  useEffect(() => { if (focus) refs.current[focus]?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [focus]);
  const items: FactItem[] = r.data ? [...Object.values(r.data.facts.facts), ...Object.values(r.data.facts.levels),
    ...Object.values(r.data.facts.events), ...Object.values(r.data.facts.policy)] : [];
  const warns = r.data?.facts.warnings ?? [];
  return (
    <Panel title="Sources and evidence" icon={<BookOpenCheck className="size-4" />} bodyClass="p-0"
      actions={r.data && <span className="text-[12px] text-faint">{items.length} items</span>}>
      {!versionId ? <div className="p-4"><Empty>Select a report to see its evidence.</Empty></div> : !r.data ? <Spinner /> : (
        <div className="max-h-[440px] overflow-y-auto">
          {(warns.length > 0 || r.data.facts.missing.length > 0) && (
            <div className="space-y-1.5 border-b border-line p-3">
              {r.data.facts.missing.map((m, i) => <div key={"m" + i} className="flex gap-2 text-[12.5px] text-danger"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{m}</div>)}
              {warns.map((w, i) => (
                <div key={i} className={cx("flex gap-2 text-[12.5px]", w.code === "fixture_data" ? "text-fixture" : w.severity === "blocking" ? "text-danger" : "text-warn")}>
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{w.message}
                </div>
              ))}
            </div>
          )}
          <ul className="divide-y divide-[var(--border)]">
            {items.map((it) => (
              <li key={it.id} ref={(el) => { refs.current[it.id] = el; }}
                className={cx("px-3 py-2.5 text-[12.5px] transition-colors duration-300", focus === it.id && "bg-accent-soft")}>
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="num rounded bg-surface-3 px-1 text-[11px] text-accent">{it.id}</span>
                  <span className="text-[11px] uppercase tracking-wider text-faint">{KIND_LABEL[it.kind] ?? it.kind}</span>
                  {it.kind === "event" && <Badge tone={it.state === "released" || it.state === "revised" ? "ok" : it.state === "conflicting" ? "danger" : "neutral"}>{String(it.state)}</Badge>}
                  {it.kind === "news" && it.entered_by === "user" && <Badge>user-entered</Badge>}
                </div>
                <p className="leading-relaxed text-fg">{it.text}</p>
                {(it.url || it.source) && <p className="mt-0.5 truncate text-[11.5px] text-faint">{it.url ? <a className="underline" href={String(it.url)} target="_blank" rel="noreferrer">{String(it.url)}</a> : String(it.source)}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

const STATE_TONE: Record<string, "ok" | "warn" | "danger" | "neutral" | "accent"> = {
  released: "ok", revised: "accent", scheduled: "neutral", delayed: "warn", conflicting: "danger", unavailable: "warn" };

export function CalendarPanel({ instrument, weekKey }: { instrument: string; weekKey: string }) {
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ["cal", instrument, weekKey], queryFn: () => api.calendar(instrument, weekKey) });
  const [entry, setEntry] = useState<{ id: string; value: string; source: string; url: string } | null>(null);
  const add = useMutation({ mutationFn: () => api.addActual(entry!.id, entry!.value, entry!.source, entry!.url || undefined),
    onSuccess: () => { setEntry(null); qc.invalidateQueries({ queryKey: ["cal"] }); qc.invalidateQueries({ queryKey: ["warnings"] }); } });
  const refresh = useMutation({ mutationFn: api.refreshCalendar, onSuccess: () => qc.invalidateQueries({ queryKey: ["cal"] }) });
  return (
    <Panel title="Economic calendar · EAT" icon={<CalendarClock className="size-4" />} bodyClass="p-0"
      actions={<Button size="sm" variant="ghost" busy={refresh.isPending} onClick={() => refresh.mutate()} title="Fetch the configured calendar feed">Refresh</Button>}>
      {refresh.error && <p className="px-3 pt-2 text-[12px] text-danger">{String(refresh.error)}</p>}
      {!c.data ? <Spinner /> : c.data.length === 0 ? <div className="p-4"><Empty>No events stored for this week.</Empty></div> : (
        <div className="max-h-[380px] overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-surface-2 text-left text-[11px] uppercase tracking-wider text-faint">
              <tr><th className="px-3 py-2 font-medium">Time</th><th className="px-1 py-2 font-medium">Event</th><th className="px-1 py-2 text-right font-medium">Cons.</th><th className="px-1 py-2 text-right font-medium">Prev.</th><th className="px-3 py-2 text-right font-medium">Actual</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {c.data.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="num whitespace-nowrap px-3 py-2 text-muted" title={`Source time: ${e.source_time}`}>{e.time_eat}</td>
                  <td className="px-1 py-2">
                    <div className="flex items-center gap-1.5"><span className="num text-[11px] font-semibold text-accent">{e.currency}</span>
                      {e.impact === "High" && <span className="size-1.5 rounded-full bg-warn" title="High impact" />}</div>
                    <div className="leading-snug">{e.title}</div>
                    <Badge tone={STATE_TONE[e.state] ?? "neutral"} className="mt-1">{e.state === "unavailable" ? "not yet verified" : e.state}</Badge>
                  </td>
                  <td className="num px-1 py-2 text-right">{e.consensus ?? "—"}</td>
                  <td className="num px-1 py-2 text-right text-muted">{e.revised_previous ? <span title={`Originally ${e.previous}`}>{e.revised_previous}*</span> : e.previous ?? "—"}</td>
                  <td className="num px-3 py-2 text-right">
                    {e.actual ?? <button className="cursor-pointer text-[11.5px] text-accent underline" onClick={() => setEntry({ id: e.id, value: "", source: "", url: "" })}>Add</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entry && (
        <form className="grid grid-cols-2 gap-2 border-t border-line p-3" onSubmit={(ev) => { ev.preventDefault(); add.mutate(); }}>
          <Field label="Actual value"><input className={inputCls} required value={entry.value} onChange={(e) => setEntry({ ...entry, value: e.target.value })} placeholder="e.g. 0.3%" /></Field>
          <Field label="Source"><input className={inputCls} required value={entry.source} onChange={(e) => setEntry({ ...entry, source: e.target.value })} placeholder="official:ONS" /></Field>
          <div className="col-span-2"><Field label="Source URL" hint="Prefer the official statistical release."><input className={inputCls} value={entry.url} onChange={(e) => setEntry({ ...entry, url: e.target.value })} /></Field></div>
          {add.error && <p className="col-span-2 text-[12px] text-danger">{String(add.error)}</p>}
          <div className="col-span-2 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEntry(null)}>Cancel</Button><Button size="sm" variant="primary" type="submit" busy={add.isPending}>Record actual</Button></div>
        </form>
      )}
    </Panel>
  );
}

const LEVEL_TONE: Record<string, "ok" | "warn" | "danger" | "neutral" | "accent"> = { active: "accent", tested: "neutral", broken: "warn", reclaimed: "ok", invalidated: "danger", archived: "neutral" };

export function LevelsPanel({ instrument, decimals }: { instrument: string; decimals: number }) {
  const qc = useQueryClient();
  const l = useQuery({ queryKey: ["levels", instrument], queryFn: () => api.levels(instrument) });
  const [form, setForm] = useState<{ lower: string; upper: string; role: string; timeframe: string; reason: string } | null>(null);
  const add = useMutation({
    mutationFn: () => api.addLevel({ instrument, lower: Number(form!.lower), upper: Number(form!.upper || form!.lower), role: form!.role, timeframe: form!.timeframe, reason: form!.reason }),
    onSuccess: () => { setForm(null); qc.invalidateQueries({ queryKey: ["levels", instrument] }); },
  });
  const archive = useMutation({ mutationFn: (id: number) => api.setLevelStatus(id, "archived", "Archived from dashboard"), onSuccess: () => qc.invalidateQueries({ queryKey: ["levels", instrument] }) });
  const fmt = (x: number) => x.toFixed(decimals);
  const rows = (l.data ?? []).filter((x) => x.status !== "archived").slice(0, 14);
  return (
    <Panel title="Technical reference levels" icon={<Layers className="size-4" />} bodyClass="p-0"
      actions={<Button size="sm" variant="ghost" onClick={() => setForm({ lower: "", upper: "", role: "resistance", timeframe: "H1", reason: "" })}><Plus className="size-4" />Add</Button>}>
      <p className="border-b border-line px-3 py-2 text-[12px] text-faint">Descriptive reference areas only. Status follows the configured close-based break rule.</p>
      {form && (
        <form className="grid grid-cols-2 gap-2 border-b border-line p-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Field label="Lower"><input className={cx(inputCls, "num")} required inputMode="decimal" value={form.lower} onChange={(e) => setForm({ ...form, lower: e.target.value })} /></Field>
          <Field label="Upper"><input className={cx(inputCls, "num")} inputMode="decimal" value={form.upper} onChange={(e) => setForm({ ...form, upper: e.target.value })} placeholder="same as lower" /></Field>
          <Field label="Role"><select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="resistance">Resistance</option><option value="support">Support</option></select></Field>
          <Field label="Timeframe"><select className={inputCls} value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value })}>{["H1", "D1", "W1"].map((t) => <option key={t}>{t}</option>)}</select></Field>
          <div className="col-span-2"><Field label="Reason"><input className={inputCls} required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. area where the CPI decline started" /></Field></div>
          {add.error && <p className="col-span-2 text-[12px] text-danger">{String(add.error)}</p>}
          <div className="col-span-2 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button size="sm" variant="primary" type="submit" busy={add.isPending}>Save level</Button></div>
        </form>
      )}
      {!l.data ? <Spinner /> : rows.length === 0 ? <div className="p-4"><Empty>No levels yet. Calculated levels appear after the first report.</Empty></div> : (
        <ul className="max-h-[320px] divide-y divide-[var(--border)] overflow-y-auto">
          {rows.map((x) => (
            <li key={x.id} className="group flex items-center gap-2 px-3 py-2 text-[12.5px]">
              <span className={cx("h-6 w-1 rounded-full", x.role === "resistance" ? "bg-accent" : "bg-muted")} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="num font-medium">{x.lower === x.upper ? fmt(x.lower) : `${fmt(x.lower)}–${fmt(x.upper)}`}</span>
                  <span className="text-faint">{x.role} · {x.timeframe} · {x.origin}{x.approximate ? " · approx." : ""}</span>
                </div>
                <div className="truncate text-faint">{x.reason}</div>
              </div>
              <Badge tone={LEVEL_TONE[x.status] ?? "neutral"}>{x.status}</Badge>
              <button onClick={() => archive.mutate(x.id)} className="cursor-pointer text-[11.5px] text-faint opacity-0 transition-opacity hover:text-fg focus:opacity-100 group-hover:opacity-100">Archive</button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const OUT_TONE: Record<string, "ok" | "warn" | "danger" | "neutral" | "accent"> = { Supported: "ok", "Not supported": "danger", Mixed: "warn", Inconclusive: "neutral", "Not assessable": "neutral" };

export function EvaluationPanel({ instrument }: { instrument: string }) {
  const e = useQuery({ queryKey: ["evaluations", instrument], queryFn: () => api.evaluations(instrument) });
  const rows = e.data ?? [];
  const counts = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.directional]: (a[r.directional] ?? 0) + 1 }), {});
  return (
    <Panel title="Outlook evaluation history" icon={<Activity className="size-4" />} bodyClass="p-0">
      <p className="border-b border-line px-3 py-2 text-[12px] text-faint">Analytical expectations only: no trades, returns or win rates are calculated.</p>
      {!e.data ? <Spinner /> : rows.length === 0 ? <div className="p-4"><Empty>Evaluations appear when daily reviews are published.</Empty></div> : (
        <>
          <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
            {Object.entries(counts).map(([k, n]) => <Badge key={k} tone={OUT_TONE[k] ?? "neutral"}>{k}: {n}</Badge>)}
          </div>
          <ul className="max-h-[300px] divide-y divide-[var(--border)] overflow-y-auto">
            {rows.map((r, i) => (
              <motion.li key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.02, 0.3) }} className="px-3 py-2 text-[12.5px]">
                <div className="flex items-center gap-2">
                  <span className="num text-muted">{r.period_key}</span>
                  <DirectionTag direction={r.direction} />
                  <Badge tone={OUT_TONE[r.directional] ?? "neutral"} className="ml-auto">{r.directional}</Badge>
                </div>
                {r.conditional.length > 0 && (
                  <div className="mt-1 space-y-0.5 text-faint">
                    {r.conditional.map((c, j) => <div key={j}><span className="num">{c.side} {c.boundary}</span>: {c.outcome}</div>)}
                  </div>
                )}
              </motion.li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

export function ScreenshotPanel({ instrument }: { instrument: string }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [extract, setExtract] = useState(true);
  const [res, setRes] = useState<{ id: number; extracted: Record<string, unknown> } | null>(null);
  const [rows, setRows] = useState<{ lower: string; upper: string; role: string; reason: string }[]>([]);
  const [chartTs, setChartTs] = useState("");
  const up = useMutation({
    mutationFn: () => api.uploadScreenshot(instrument, file!, extract),
    onSuccess: (r) => {
      setRes(r);
      const lv = (r.extracted.levels as { lower: number; upper: number; label: string; clarity: string }[] | undefined) ?? [];
      setRows(lv.map((x) => ({ lower: String(x.lower), upper: String(x.upper), role: "resistance", reason: `${x.label || "screenshot level"}${x.clarity === "unclear" ? " (unclear reading)" : ""}` })));
    },
  });
  const confirm = useMutation({
    mutationFn: () => api.confirmScreenshot(res!.id, rows.map((r) => ({ instrument, lower: Number(r.lower), upper: Number(r.upper || r.lower), role: r.role, timeframe: String(res!.extracted.timeframe ?? "H1").slice(0, 4) || "H1", reason: r.reason, approximate: true })), chartTs ? new Date(chartTs).toISOString() : undefined),
    onSuccess: () => { setRes(null); setRows([]); setFile(null); qc.invalidateQueries({ queryKey: ["levels", instrument] }); },
  });
  return (
    <Panel title="Chart screenshot (optional)" icon={<ImageUp className="size-4" />}>
      {!res ? (
        <div className="space-y-2.5">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong bg-surface-2 px-3 py-5 text-center text-[13px] text-muted hover:border-accent">
            <ImageUp className="size-5" aria-hidden />
            {file ? <span className="text-fg">{file.name}</span> : <span>Choose a TradingView screenshot (PNG, JPEG, WebP)</span>}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" checked={extract} onChange={(e) => setExtract(e.target.checked)} />Read visible levels with Claude (approximate; needs API key)</label>
          {up.error && <p className="text-[12px] text-danger">{String(up.error)}</p>}
          <Button size="sm" variant="primary" disabled={!file} busy={up.isPending} onClick={() => up.mutate()}><ScanSearch className="size-4" />Upload</Button>
        </div>
      ) : (
        <div className="space-y-2.5 text-[13px]">
          <p className="text-warn">Readings are approximate. Confirm or correct each level; nothing is used until confirmed. The screenshot says nothing about price after it was taken.</p>
          {res.extracted.status === "manual_entry_required" && <p className="text-muted">{String(res.extracted.reason ?? "Enter the levels shown on the chart.")}</p>}
          {Array.isArray(res.extracted.annotations) && (res.extracted.annotations as string[]).length > 0 && (
            <p className="text-muted">Annotations kept as written: {(res.extracted.annotations as string[]).join("; ")}</p>
          )}
          <Field label="Chart timestamp (as shown)" hint={`Read from image: ${String(res.extracted.chart_timestamp ?? "unknown")}`}>
            <input type="datetime-local" className={inputCls} value={chartTs} onChange={(e) => setChartTs(e.target.value)} />
          </Field>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
              <input className={cx(inputCls, "num")} value={r.lower} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, lower: e.target.value } : x))} aria-label="Lower" />
              <input className={cx(inputCls, "num")} value={r.upper} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, upper: e.target.value } : x))} aria-label="Upper" />
              <select className={inputCls} value={r.role} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} aria-label="Role"><option value="resistance">Res.</option><option value="support">Sup.</option></select>
              <input className={cx(inputCls, "col-span-3")} value={r.reason} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, reason: e.target.value } : x))} aria-label="Reason" />
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { lower: "", upper: "", role: "resistance", reason: "screenshot level" }])}><Plus className="size-4" />Add level</Button>
          {confirm.error && <p className="text-[12px] text-danger">{String(confirm.error)}</p>}
          <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setRes(null)}>Discard</Button><Button size="sm" variant="primary" busy={confirm.isPending} disabled={!rows.length} onClick={() => confirm.mutate()}>Confirm levels</Button></div>
        </div>
      )}
    </Panel>
  );
}
