"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Grid3x3, RefreshCw, Users } from "lucide-react";
import { useState } from "react";
import { api, friendlyError, type CotRow, type StrengthRow } from "../desk/api";
import { Button, Spinner, Tabs, cx } from "../desk/ui";

type Tab = "strength" | "correlation" | "cot";

const pct = (v: number, d = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;
const int = (v: number) => `${v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
const signed = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${int(v)}`);

function Problem({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-4 text-sm text-danger">
      <span>{friendlyError(error)}</span><Button size="sm" onClick={retry}><RefreshCw className="size-4" />Retry</Button>
    </div>
  );
}

/** Diverging bars around zero: one row per currency, strongest first. */
function StrengthBars({ title, sub, rows }: { title: string; sub: string; rows: StrengthRow[] }) {
  const max = Math.max(0.05, ...rows.map((r) => Math.abs(r.pct)));
  return (
    <div className="min-w-0">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <p className="mb-3 text-[12px] text-faint">{sub}</p>
      <ol className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={r.currency} className="grid grid-cols-[1.25rem_2.75rem_1fr_4.5rem] items-center gap-2 text-[13px]">
            <span className="num text-faint">{i + 1}</span>
            <span className="num font-semibold">{r.currency}</span>
            <span className="relative h-5 rounded bg-surface-2" aria-hidden>
              <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
              <span className={cx("absolute inset-y-0.5 rounded-sm", r.pct >= 0 ? "left-1/2 bg-ok" : "right-1/2 bg-danger")}
                style={{ width: `${(Math.abs(r.pct) / max) * 50}%` }} />
            </span>
            <span className={cx("num text-right", r.pct > 0 ? "text-ok" : r.pct < 0 ? "text-danger" : "text-muted")}>{pct(r.pct)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StrengthView() {
  const q = useQuery({ queryKey: ["strength"], queryFn: api.strength, refetchInterval: 60_000, refetchIntervalInBackground: false });
  if (q.isLoading) return <Spinner label="Loading prices" />;
  if (q.error || !q.data) return <Problem error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-5 p-4">
      <div className="grid gap-6 md:grid-cols-2">
        <StrengthBars title="Today" sub={`Since the New York 17:00 open, ${d.today_start_display}`} rows={d.today} />
        <StrengthBars title="This week" sub={`Since the week opened, ${d.week_start_display}`} rows={d.week} />
      </div>
      <div>
        <h3 className="mb-2 text-[13px] font-semibold">All 28 pairs today</h3>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
          {[...d.crosses_today].sort((a, b) => b.pct - a.pct).map((c) => (
            <div key={c.pair} className="flex items-center justify-between rounded-md border border-line bg-surface-2 px-2 py-1 text-[12.5px]">
              <span className="num">{c.pair}</span>
              <span className={cx("num", c.pct > 0 ? "text-ok" : c.pct < 0 ? "text-danger" : "text-muted")}>{pct(c.pct)}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[12px] text-faint">
        Each currency's strength is its average % change against the other seven, worked out from Yahoo Finance quotes of the seven USD pairs
        ({d.quotes.map((x) => x.symbol).join(", ")}). Updated {d.as_of_display}, every minute while this page is open. It describes what has happened, not what will.
        {d.errors.length > 0 && <span className="text-warn"> Missing: {d.errors.join("; ")}.</span>}
      </p>
    </div>
  );
}

/** Background for a correlation: green for positive, red for negative, stronger colour for a stronger link. */
const cellStyle = (r: number | null) => r == null ? {} : { background: `color-mix(in srgb, var(${r >= 0 ? "--ok" : "--danger"}) ${Math.round(Math.abs(r) * 55)}%, transparent)` };

function CorrelationView() {
  const q = useQuery({ queryKey: ["correlation"], queryFn: api.correlation, staleTime: 30 * 60_000 });
  const [days, setDays] = useState<20 | 60>(20);
  if (q.isLoading) return <Spinner label="Loading daily prices" />;
  if (q.error || !q.data) return <Problem error={q.error} retry={() => q.refetch()} />;
  const d = q.data, m = days === 20 ? d.m20 : d.m60;
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-surface-2 p-0.5" role="group" aria-label="Period">
          {([20, 60] as const).map((n) => (
            <button key={n} onClick={() => setDays(n)} aria-pressed={days === n}
              className={cx("cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-medium", days === n ? "bg-accent-soft text-fg" : "text-muted hover:text-fg")}>{n} days</button>
          ))}
        </div>
        <span className="text-[12px] text-faint">Last trading day included: {d.last_date ?? "—"}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-1 text-[13px]">
          <thead>
            <tr><th className="sr-only">Pair</th>{d.labels.map((l) => <th key={l.code} className="px-1 py-1 text-center font-medium text-muted">{l.display}</th>)}</tr>
          </thead>
          <tbody>
            {d.labels.map((row, i) => (
              <tr key={row.code}>
                <th className="whitespace-nowrap pr-2 text-left font-medium text-muted">{row.display}</th>
                {m[i].map((r, j) => (
                  <td key={j} className="num rounded-md px-1 py-2 text-center" style={i === j ? undefined : cellStyle(r)}>
                    {i === j ? <span className="text-faint">—</span> : r == null ? "—" : r.toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-faint">
        Correlation of daily % changes over the last {days} trading days both markets traded, from Yahoo Finance daily closes. +1: they moved together; −1: they moved
        opposite; near 0: no steady link. {d.note} Updated {d.as_of_display}.
        {d.errors.length > 0 && <span className="text-warn"> Missing: {d.errors.join("; ")}.</span>}
      </p>
    </div>
  );
}

function LongBar({ r }: { r: CotRow }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative h-2 w-20 overflow-hidden rounded bg-danger" aria-hidden><span className="absolute inset-y-0 left-0 bg-ok" style={{ width: `${r.spec_long_pct}%` }} /></span>
      <span className="num">{r.spec_long_pct.toFixed(0)}%</span>
    </div>
  );
}

function CotView() {
  const q = useQuery({ queryKey: ["cot"], queryFn: api.cot, staleTime: 60 * 60_000 });
  if (q.isLoading) return <Spinner label="Loading the CFTC report" />;
  if (q.error || !q.data) return <Problem error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const change = (v: number | null) => <span className={cx("num", v == null ? "text-faint" : v > 0 ? "text-ok" : v < 0 ? "text-danger" : "text-muted")}>{signed(v)}</span>;
  return (
    <div className="space-y-3 p-4">
      {d.error && <p className="text-[13px] text-warn">{d.error}{d.rows.length ? " Showing the last stored report." : ""}</p>}
      {d.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="text-left text-[11.5px] uppercase tracking-wider text-faint">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Contract</th>
                <th className="px-2 font-medium text-right">Spec. long</th><th className="px-2 font-medium text-right">Spec. short</th>
                <th className="px-2 font-medium text-right">Spec. net</th><th className="px-2 font-medium text-right">Weekly change</th>
                <th className="px-2 font-medium">Long share</th>
                <th className="px-2 font-medium text-right">Commercial net</th><th className="px-2 font-medium text-right">Weekly change</th>
                <th className="pl-2 font-medium text-right">Open interest</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.code} className="border-b border-line/60">
                  <td className="py-2 pr-3"><span className="font-medium">{r.label}</span> <span className="num text-faint">{r.currency}</span></td>
                  <td className="num px-2 text-right">{int(r.spec_long)}</td><td className="num px-2 text-right">{int(r.spec_short)}</td>
                  <td className={cx("num px-2 text-right font-semibold", r.spec_net > 0 ? "text-ok" : r.spec_net < 0 ? "text-danger" : "")}>{signed(r.spec_net)}</td>
                  <td className="px-2 text-right">{change(r.spec_net_change)}</td>
                  <td className="px-2"><LongBar r={r} /></td>
                  <td className="num px-2 text-right">{signed(r.comm_net)}</td><td className="px-2 text-right">{change(r.comm_net_change)}</td>
                  <td className="num pl-2 text-right">{int(r.open_interest)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] text-faint">
        Contracts held by large speculators (non-commercial traders) and commercial hedgers in US futures, from the CFTC Commitments of Traders report (Legacy, futures only),
        positions as of {d.report_date ?? "—"}. Published every Friday for the Tuesday before.{" "}
        <a className="underline" href={d.source_url} target="_blank" rel="noreferrer">CFTC</a>.{d.fetched_display && <> Fetched {d.fetched_display}.</>}
      </p>
    </div>
  );
}

export function Markets() {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem("fx.marketsTab") as Tab) || "strength"; } catch { return "strength"; } });
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem("fx.marketsTab", t); } catch { /* storage unavailable */ } };
  return (
    <section className="panel min-w-0">
      <div className="border-b border-line px-2">
        <Tabs label="markets" value={tab} onChange={pick} tabs={[
          { id: "strength", label: <><Activity className="size-4" aria-hidden />Currency strength</> },
          { id: "correlation", label: <><Grid3x3 className="size-4" aria-hidden />Correlation</> },
          { id: "cot", label: <><Users className="size-4" aria-hidden />COT positioning</> },
        ]} />
      </div>
      {tab === "strength" && <StrengthView />}
      {tab === "correlation" && <CorrelationView />}
      {tab === "cot" && <CotView />}
    </section>
  );
}
