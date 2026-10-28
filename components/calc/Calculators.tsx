"use client";

import { useQuery } from "@tanstack/react-query";
import { Calculator, Clock, Coins, Divide, Gauge, Globe2, Percent, Ruler, Scale, Sigma, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import * as C from "@/lib/calc/forex";
import { api, friendlyError } from "../desk/api";
import { Badge, cx, inputCls } from "../desk/ui";

// ---------------------------------------------------------------- shared inputs

const n = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/,/g, "")));
const money = (x: number, cur: string, d = 2) => `${x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })} ${cur}`;
const num = (x: number, d = 2) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const priceDigits = (pair: string) => (C.pipSize(pair) === 0.01 ? 3 : 5);

function NumberInput({ label, value, onChange, hint, suffix }: { label: string; value: string; onChange: (v: string) => void; hint?: string; suffix?: string }) {
  const bad = value.trim() !== "" && !Number.isFinite(n(value));
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="font-medium text-muted">{label}</span>
      <span className="relative">
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={bad}
          className={cx(inputCls, "num w-full", suffix && "pr-12", bad && "border-danger")} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-2.5 grid place-items-center text-[12px] text-faint">{suffix}</span>}
      </span>
      {bad ? <span className="text-[12px] text-danger">Enter a number.</span> : hint && <span className="text-[12px] text-faint">{hint}</span>}
    </label>
  );
}

function Select<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: readonly T[] | { value: T; label: string }[] }) {
  const opts = (options as readonly (T | { value: T; label: string })[]).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="font-medium text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cx(inputCls, "cursor-pointer")}>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** A live conversion rate (Yahoo Finance, free) that the user can override. Same currency → 1. */
function useRate(from: string, to: string) {
  const same = from === to;
  const q = useQuery({ queryKey: ["rate", from, to], queryFn: () => api.rates([`${from}/${to}`]), enabled: !same, staleTime: 60_000 });
  const [override, setOverride] = useState("");
  useEffect(() => setOverride(""), [from, to]);
  const live = same ? 1 : q.data?.[0]?.rate ?? null;
  const value = override.trim() ? n(override) : live;
  const meta = q.data?.[0];
  const field = same ? null : (
    <div className="space-y-1">
      <NumberInput label={`Rate ${from}/${to}`} value={override} onChange={setOverride} suffix={to}
        hint={q.isLoading ? "Fetching the latest rate…" : meta?.error ? "Could not fetch a rate; enter one." : live != null ? `Latest ${num(live, 5)} — leave empty to use it` : undefined} />
      {meta?.rate != null && !override.trim() && (
        <p className="text-[11.5px] text-faint">
          {meta.fixture ? <Badge tone="fixture">fixture rate</Badge> : null} As of {meta.time ? new Date(meta.time).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—"} · {meta.sources?.join(", ")}
        </p>
      )}
      {q.error && <p className="text-[12px] text-danger">{friendlyError(q.error)}</p>}
    </div>
  );
  return { value: value != null && Number.isFinite(value) && value > 0 ? value : null, field };
}

/** Units of `to` per unit of `from`; for the pair itself, its own price is used when it matches. */
function Results({ items, note }: { items: [string, ReactNode][]; note?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k}><dt className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-faint">{k}</dt><dd className="num mt-0.5 text-[20px] font-semibold leading-tight">{v}</dd></div>
        ))}
      </dl>
      {note && <p className="mt-3 text-[12px] text-faint">{note}</p>}
    </div>
  );
}
const Empty = () => <p className="rounded-xl border border-dashed border-line p-4 text-center text-[13px] text-muted">Fill in the fields to see the result.</p>;

function SizeInput({ pair, units, setUnits }: { pair: string; units: string; setUnits: (v: string) => void }) {
  const [mode, setMode] = useState<"units" | "lots">("lots");
  const [lots, setLots] = useState("1");
  useEffect(() => { if (mode === "lots") setUnits(String(n(lots) * C.lotUnits(pair))); }, [lots, mode, pair, setUnits]);
  return (
    <div className="space-y-1">
      <div className="flex gap-1 text-[12px]">
        {(["lots", "units"] as const).map((m) => <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={cx("cursor-pointer rounded px-2 py-0.5", mode === m ? "bg-accent-soft text-fg" : "text-muted hover:text-fg")}>{m}</button>)}
      </div>
      {mode === "lots" ? <NumberInput label="Position size" value={lots} onChange={setLots} suffix="lots" hint={`1 lot = ${C.lotUnits(pair).toLocaleString()} ${C.split(pair).base === "XAU" ? "oz" : "units"}`} />
        : <NumberInput label="Position size" value={units} onChange={setUnits} suffix="units" />}
    </div>
  );
}

// ---------------------------------------------------------------- calculators

function PipValue() {
  const [pair, setPair] = useState<string>("EUR/USD"), [acct, setAcct] = useState<string>("USD"), [units, setUnits] = useState("100000"), [pips, setPips] = useState("1");
  const r = useRate(C.split(pair).quote, acct);
  const res = r.value ? C.pipValue({ pair, units: n(units), pips: n(pips), quoteToAccount: r.value }) : null;
  return (
    <Calc form={<><Select label="Currency pair" value={pair} onChange={setPair} options={C.PAIRS} /><Select label="Account currency" value={acct} onChange={setAcct} options={C.ACCOUNT_CURRENCIES} />
      <SizeInput pair={pair} units={units} setUnits={setUnits} /><NumberInput label="Pips" value={pips} onChange={setPips} />{r.field}</>}
      result={res ? <Results items={[["Value per pip", money(res.perPip, acct)], [`Value of ${pips || 0} pips`, money(res.total, acct)]]} note={`One pip on ${pair} is ${C.pipSize(pair)}.`} /> : <Empty />} />
  );
}

function PositionSize() {
  const [pair, setPair] = useState<string>("EUR/USD"), [acct, setAcct] = useState<string>("USD"), [bal, setBal] = useState("10000"), [riskMode, setRiskMode] = useState<"percent" | "amount">("percent");
  const [risk, setRisk] = useState("1"), [stop, setStop] = useState("50");
  const r = useRate(C.split(pair).quote, acct);
  const res = r.value ? C.positionSize({ pair, balance: n(bal), stopPips: n(stop), quoteToAccount: r.value, ...(riskMode === "percent" ? { riskPercent: n(risk) } : { riskAmount: n(risk) }) }) : null;
  return (
    <Calc form={<><Select label="Account currency" value={acct} onChange={setAcct} options={C.ACCOUNT_CURRENCIES} /><NumberInput label="Account balance" value={bal} onChange={setBal} suffix={acct} />
      <Select label="Risk as" value={riskMode} onChange={setRiskMode} options={[{ value: "percent", label: "Percentage of balance" }, { value: "amount", label: "Fixed amount" }]} />
      <NumberInput label="Risk" value={risk} onChange={setRisk} suffix={riskMode === "percent" ? "%" : acct} />
      <NumberInput label="Stop distance" value={stop} onChange={setStop} suffix="pips" /><Select label="Currency pair" value={pair} onChange={setPair} options={C.PAIRS} />{r.field}</>}
      result={res ? <Results items={[["Amount at risk", money(res.risk, acct)], ["Units", num(res.units, 0)], ["Standard lots", num(res.lots, 2)], ["Mini lots", num(res.miniLots, 2)], ["Micro lots", num(res.microLots, 2)]]} /> : <Empty />} />
  );
}

function Margin() {
  const [pair, setPair] = useState<string>("EUR/USD"), [acct, setAcct] = useState<string>("USD"), [lev, setLev] = useState("100"), [units, setUnits] = useState("100000");
  const r = useRate(C.split(pair).base, acct);
  const res = r.value ? C.margin({ units: n(units), leverage: n(lev), baseToAccount: r.value }) : null;
  return (
    <Calc form={<><Select label="Currency pair" value={pair} onChange={setPair} options={C.PAIRS} /><Select label="Account currency" value={acct} onChange={setAcct} options={C.ACCOUNT_CURRENCIES} />
      <Select label="Leverage" value={lev} onChange={setLev} options={["1", "2", "5", "10", "20", "30", "50", "100", "200", "400", "500", "1000"].map((v) => ({ value: v, label: `1:${v}` }))} />
      <SizeInput pair={pair} units={units} setUnits={setUnits} />{r.field}</>}
      result={res ? <Results items={[["Required margin", money(res.margin, acct)], ["Position value", money(res.notional, acct)]]} note={`Margin = position value ÷ ${lev || "?"}.`} /> : <Empty />} />
  );
}

function Profit() {
  const [pair, setPair] = useState<string>("EUR/USD"), [acct, setAcct] = useState<string>("USD"), [dir, setDir] = useState<"buy" | "sell">("buy");
  const [open, setOpen] = useState("1.1000"), [close, setClose] = useState("1.1050"), [units, setUnits] = useState("100000");
  const r = useRate(C.split(pair).quote, acct);
  const res = r.value ? C.profit({ pair, direction: dir, open: n(open), close: n(close), units: n(units), quoteToAccount: r.value }) : null;
  return (
    <Calc form={<><Select label="Currency pair" value={pair} onChange={setPair} options={C.PAIRS} /><Select label="Account currency" value={acct} onChange={setAcct} options={C.ACCOUNT_CURRENCIES} />
      <Select label="Direction" value={dir} onChange={setDir} options={[{ value: "buy", label: "Long (bought)" }, { value: "sell", label: "Short (sold)" }]} />
      <NumberInput label="Open price" value={open} onChange={setOpen} /><NumberInput label="Close price" value={close} onChange={setClose} />
      <SizeInput pair={pair} units={units} setUnits={setUnits} />{r.field}</>}
      result={res ? <Results items={[["Pips", num(res.pips, 1)], ["Result", money(res.account, acct)], [`Result in ${C.split(pair).quote}`, money(res.quote, C.split(pair).quote)]]}
        note="Converted at the current rate shown, not the rate at the time the position closed." /> : <Empty />} />
  );
}

function RiskReward() {
  const [pair, setPair] = useState<string>("EUR/USD"), [entry, setEntry] = useState("1.1000"), [stop, setStop] = useState("1.0950"), [target, setTarget] = useState("1.1150");
  const res = C.riskReward({ pair, entry: n(entry), stop: n(stop), target: n(target) });
  return (
    <Calc form={<><Select label="Currency pair" value={pair} onChange={setPair} options={C.PAIRS} /><NumberInput label="Entry price" value={entry} onChange={setEntry} />
      <NumberInput label="Stop price" value={stop} onChange={setStop} /><NumberInput label="Target price" value={target} onChange={setTarget} /></>}
      result={!res ? <Empty /> : "error" in res ? <p className="rounded-xl border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-soft p-4 text-[13px] text-warn">{res.error}</p>
        : <Results items={[["Ratio", `1 : ${num(res.ratio, 2)}`], ["Direction", res.direction], ["Distance to stop", `${num(res.riskPips, 1)} pips`], ["Distance to target", `${num(res.rewardPips, 1)} pips`]]} />} />
  );
}

function Pivots() {
  const [h, setH] = useState("1.3200"), [l, setL] = useState("1.3000"), [c, setC] = useState("1.3100"), [o, setO] = useState("1.3050");
  const sets = C.pivots({ high: n(h), low: n(l), close: n(c), open: o.trim() ? n(o) : undefined });
  const keys = ["R4", "R3", "R2", "R1", "PP", "S1", "S2", "S3", "S4"];
  return (
    <Calc form={<><NumberInput label="High" value={h} onChange={setH} /><NumberInput label="Low" value={l} onChange={setL} /><NumberInput label="Close" value={c} onChange={setC} />
      <NumberInput label="Open (for DeMark)" value={o} onChange={setO} hint="Previous period's open; optional." /></>}
      result={!sets ? <p className="rounded-xl border border-dashed border-line p-4 text-center text-[13px] text-muted">High must be above low, with the close between them.</p> : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="num w-full text-[13px]">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-faint"><tr><th className="px-3 py-2 text-left">Level</th>{sets.map((s) => <th key={s.method} className="px-3 py-2 text-right">{s.method}</th>)}</tr></thead>
            <tbody className="divide-y divide-[var(--border)]">
              {keys.filter((k) => sets.some((s) => s.levels[k] != null)).map((k) => (
                <tr key={k} className={k === "PP" ? "bg-accent-soft" : ""}><td className="px-3 py-1.5 font-semibold">{k}</td>{sets.map((s) => <td key={s.method} className="px-3 py-1.5 text-right">{s.levels[k] != null ? s.levels[k].toFixed(5) : ""}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )} />
  );
}

function Fibonacci() {
  const [h, setH] = useState("1.2000"), [l, setL] = useState("1.1000"), [trend, setTrend] = useState<"up" | "down">("up");
  const res = C.fibonacci({ high: n(h), low: n(l), trend });
  const row = (label: string, rows: { ratio: number; price: number }[]) => (
    <div className="rounded-xl border border-line">
      <p className="border-b border-line bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</p>
      <ul className="num divide-y divide-[var(--border)] text-[13px]">{rows.map((r) => <li key={r.ratio} className="flex justify-between px-3 py-1.5"><span className="text-muted">{num(r.ratio * 100, 1)}%</span><span className="font-semibold">{r.price.toFixed(5)}</span></li>)}</ul>
    </div>
  );
  return (
    <Calc form={<><Select label="Move" value={trend} onChange={setTrend} options={[{ value: "up", label: "Upward (low → high)" }, { value: "down", label: "Downward (high → low)" }]} />
      <NumberInput label="High" value={h} onChange={setH} /><NumberInput label="Low" value={l} onChange={setL} /></>}
      result={!res ? <Empty /> : <div className="grid gap-3 sm:grid-cols-2">{row("Retracements", res.retracements)}{row("Extensions", res.extensions)}</div>} />
  );
}

function Compounding() {
  const [start, setStart] = useState("1000"), [rate, setRate] = useState("2"), [periods, setPeriods] = useState("12"), [dep, setDep] = useState("0");
  const res = C.compounding({ start: n(start), ratePercent: n(rate), periods: n(periods), deposit: n(dep) || 0 });
  return (
    <Calc form={<><NumberInput label="Starting balance" value={start} onChange={setStart} /><NumberInput label="Return per period" value={rate} onChange={setRate} suffix="%" />
      <NumberInput label="Number of periods" value={periods} onChange={setPeriods} /><NumberInput label="Deposit per period" value={dep} onChange={setDep} hint="Added at the end of each period; optional." /></>}
      result={!res ? <Empty /> : (
        <div className="space-y-3">
          <Results items={[["Ending balance", num(res.end)], ["Total gain", num(res.totalGain)], ["Total deposits", num(res.deposits)]]} note="Illustration of a fixed percentage per period; actual results vary." />
          <Table head={["Period", "Start", "Gain", "Deposit", "End"]} rows={res.rows.map((r) => [r.period, num(r.start), num(r.gain), num(r.deposit), num(r.end)])} />
        </div>
      )} />
  );
}

function Drawdown() {
  const [start, setStart] = useState("10000"), [loss, setLoss] = useState("2"), [count, setCount] = useState("10");
  const res = C.drawdown({ start: n(start), lossPercent: n(loss), losses: n(count) });
  const last = res?.rows[res.rows.length - 1];
  return (
    <Calc form={<><NumberInput label="Starting balance" value={start} onChange={setStart} /><NumberInput label="Loss per losing trade" value={loss} onChange={setLoss} suffix="%" />
      <NumberInput label="Consecutive losing trades" value={count} onChange={setCount} /></>}
      result={!res || !last ? <Empty /> : (
        <div className="space-y-3">
          <Results items={[["Remaining balance", num(res.end)], ["Drawdown", `${num(last.drawdownPercent)}%`], ["Gain needed to recover", `${num(last.recoveryPercent)}%`]]} />
          <Table head={["Trade", "Balance", "Drawdown", "Gain to recover"]} rows={res.rows.map((r) => [r.trade, num(r.balance), `${num(r.drawdownPercent)}%`, `${num(r.recoveryPercent)}%`])} />
        </div>
      )} />
  );
}

function Converter() {
  const all = [...C.ACCOUNT_CURRENCIES, "XAU"] as const;
  const [amt, setAmt] = useState("1000"), [from, setFrom] = useState<string>("USD"), [to, setTo] = useState<string>("EUR");
  const r = useRate(from, to);
  return (
    <Calc form={<><NumberInput label="Amount" value={amt} onChange={setAmt} suffix={from} /><Select label="From" value={from} onChange={setFrom} options={all} /><Select label="To" value={to} onChange={setTo} options={all} />{r.field}</>}
      result={r.value && Number.isFinite(n(amt)) ? <Results items={[["Converted", money(n(amt) * r.value, to, to === "JPY" ? 0 : 2)], ["Rate", `1 ${from} = ${num(r.value, 5)} ${to}`]]} /> : <Empty />} />
  );
}

function MarketHours() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const sessions = C.sessionsAt(now);
  const open = C.fxMarketOpen(now);
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - dayStart.getTime()) / 86400_000) * 100));
  const t = (x: number) => new Date(x).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const until = (x: number) => { const m = Math.round((x - now) / 60000); return m >= 60 * 24 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : `${Math.floor(m / 60)}h ${m % 60}m`; };
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">Times in your browser's timezone. The FX market is <strong className={open ? "text-ok" : "text-warn"}>{open ? "open" : "closed for the weekend"}</strong>. It trades from Sunday 17:00 to Friday 17:00 New York time.</p>
      <div className="relative rounded-xl border border-line bg-surface-2 p-3">
        <div className="relative mb-2 h-4 text-[10.5px] text-faint">{[0, 6, 12, 18].map((h) => <span key={h} className="num absolute" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, "0")}:00</span>)}</div>
        {sessions.map((s) => {
          const w = s.current ?? s.next;
          return (
            <div key={s.name} className="mb-2 flex items-center gap-3">
              <span className="w-20 text-[13px] font-medium">{s.name}</span>
              <div className="relative h-6 flex-1 rounded bg-surface-3">
                {s.windows.map((x, i) => {
                  const a = pct(x.start), b = pct(x.end);
                  return b > a && <span key={i} className={cx("absolute inset-y-0 rounded", s.open_now && x.start === s.current?.start ? "bg-accent" : "bg-accent/35")} style={{ left: `${a}%`, width: `${b - a}%` }} />;
                })}
                <span className="absolute inset-y-[-4px] w-0.5 bg-fg" style={{ left: `${pct(now)}%` }} aria-hidden />
              </div>
              <span className="num w-44 text-right text-[12px] text-muted">
                {s.open_now && s.current ? <>Open · closes in {until(s.current.end)}</> : w ? <>Opens {t(w.start)} · in {until(w.start)}</> : "Closed"}
              </span>
            </div>
          );
        })}
      </div>
      <Table head={["Session", "Local hours", "Your time", "Status"]} rows={sessions.map((s) => {
        const w = s.current ?? s.next;
        return [s.name, `${s.open}–${s.close} (${s.tz.split("/")[1].replace("_", " ")})`, w ? `${t(w.start)}–${t(w.end)}` : "—", s.open_now ? "Open" : "Closed"];
      })} />
      <p className="text-[12px] text-faint">Overlaps, such as London with New York, are when two sessions are open together. Session hours are each centre's usual business hours and follow its own daylight-saving rules.</p>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-xl border border-line">
      <table className="num w-full text-[12.5px]">
        <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wider text-faint"><tr>{head.map((h, i) => <th key={h} className={cx("px-3 py-2", i ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-[var(--border)]">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={cx("px-3 py-1.5", j ? "text-right" : "text-left")}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Calc({ form, result }: { form: ReactNode; result: ReactNode }) {
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]"><div className="space-y-3">{form}</div><div className="min-w-0">{result}</div></div>;
}

const LIST: { id: string; title: string; icon: ReactNode; about: string; el: () => ReactNode }[] = [
  { id: "pip", title: "Pip value", icon: <Ruler className="size-4" />, about: "What one pip is worth in your account currency for a given position size.", el: () => <PipValue /> },
  { id: "position", title: "Position size", icon: <Scale className="size-4" />, about: "The position size at which a given stop distance equals a chosen amount of the account.", el: () => <PositionSize /> },
  { id: "margin", title: "Margin", icon: <Gauge className="size-4" />, about: "Margin a broker would hold for a position at a given leverage.", el: () => <Margin /> },
  { id: "profit", title: "Profit / loss", icon: <TrendingUp className="size-4" />, about: "The result of a position between two prices, in pips and in your account currency.", el: () => <Profit /> },
  { id: "rr", title: "Risk-reward", icon: <Divide className="size-4" />, about: "Distances from an entry price to a stop and a target, and their ratio.", el: () => <RiskReward /> },
  { id: "pivot", title: "Pivot points", icon: <Sigma className="size-4" />, about: "Classic, Woodie, Camarilla, Fibonacci and DeMark pivot levels from the previous period's prices.", el: () => <Pivots /> },
  { id: "fib", title: "Fibonacci", icon: <Percent className="size-4" />, about: "Retracement and extension levels of a move between a high and a low.", el: () => <Fibonacci /> },
  { id: "compound", title: "Compounding", icon: <Coins className="size-4" />, about: "How a balance grows at a fixed percentage per period, with optional deposits.", el: () => <Compounding /> },
  { id: "drawdown", title: "Drawdown", icon: <TrendingDown className="size-4" />, about: "The balance after a run of losses and the gain needed to get back to the start.", el: () => <Drawdown /> },
  { id: "convert", title: "Currency converter", icon: <Globe2 className="size-4" />, about: "Convert an amount between currencies at the latest rate.", el: () => <Converter /> },
  { id: "hours", title: "Market hours", icon: <Clock className="size-4" />, about: "Which trading sessions are open now and when the others open.", el: () => <MarketHours /> },
];

export function Calculators() {
  const [id, setId] = useState(() => { try { return localStorage.getItem("fx.calc") ?? "pip"; } catch { return "pip"; } });
  useEffect(() => { try { localStorage.setItem("fx.calc", id); } catch { /* storage unavailable */ } }, [id]);
  const cur = LIST.find((c) => c.id === id) ?? LIST[0];
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-muted" role="note">
        <strong className="text-fg">General trading arithmetic.</strong> These tools are separate from the analysis reports, which never use them. Nothing here is a recommendation to trade.
      </div>
      <div className="grid gap-3 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav className="panel h-fit p-2 lg:sticky lg:top-24" aria-label="Calculators">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col tabs-scroll">
            {LIST.map((c) => (
              <li key={c.id} className="shrink-0">
                <button onClick={() => setId(c.id)} aria-current={c.id === cur.id ? "page" : undefined}
                  className={cx("flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13.5px] transition-colors",
                    c.id === cur.id ? "bg-accent-soft font-medium text-fg" : "text-muted hover:bg-surface-3 hover:text-fg")}>
                  <span className={c.id === cur.id ? "text-accent" : ""} aria-hidden>{c.icon}</span>{c.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <section className="panel min-w-0 p-5" aria-labelledby="calc-title">
          <div className="mb-4 flex items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent" aria-hidden><Calculator className="size-4" /></span>
            <div><h2 id="calc-title" className="text-[17px] font-semibold">{cur.title} calculator</h2><p className="text-[13px] text-muted">{cur.about}</p></div>
          </div>
          <div key={cur.id}>{cur.el()}</div>
        </section>
      </div>
    </div>
  );
}
