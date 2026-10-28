"use client";

import { useQuery } from "@tanstack/react-query";
import { Calculator, Coins, Divide, Gauge, Globe2, Percent, Ruler, Scale, Sigma, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import * as C from "@/lib/calc/forex";
import { api, friendlyError } from "../desk/api";
import { Badge, cx, inputCls } from "../desk/ui";

// ---------------------------------------------------------------- shared inputs

const n = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/,/g, "")));
const money = (x: number, cur: string, d = 2) => `${x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })} ${cur}`;
const num = (x: number, d = 2) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

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
function useRate(from: string, to: string, label?: string) {
  const same = from === to;
  const q = useQuery({ queryKey: ["rate", from, to], queryFn: () => api.rates([`${from}/${to}`]), enabled: !same, staleTime: 60_000 });
  const [override, setOverride] = useState("");
  useEffect(() => setOverride(""), [from, to]);
  const live = same ? 1 : q.data?.[0]?.rate ?? null;
  const value = override.trim() ? n(override) : live;
  const meta = q.data?.[0];
  const field = same ? null : (
    <div className="space-y-1">
      <NumberInput label={label ? `${label} (${from}/${to})` : `Rate ${from}/${to}`} value={override} onChange={setOverride} suffix={to}
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

/** The pair's current price (live, editable) and, only when the account currency is neither side of the pair,
 *  the quote→account cross rate. Together they convert quote-currency amounts the way BabyPips does. */
function useConversion(pair: string, account: string) {
  const { base, quote } = C.split(pair);
  const price = useRate(base, quote, "Current price");
  const cross = useRate(quote, C.needsCross(pair, account) ? account : quote);
  return { price: price.value, cross: C.needsCross(pair, account) ? cross.value : null, ready: price.value != null && (!C.needsCross(pair, account) || cross.value != null),
    fields: <>{price.field}{C.needsCross(pair, account) && cross.field}</> };
}

function Formula({ children }: { children: ReactNode }) {
  return <p className="mt-3 rounded-lg bg-surface-3 px-3 py-2 text-[12px] text-muted"><span className="font-semibold text-fg">How it's calculated: </span>{children}</p>;
}
const conversionNote = (pair: string, acct: string) => {
  const { base, quote } = C.split(pair);
  return acct === quote ? `The account is in ${quote}, the pair's quote currency, so no conversion is needed.`
    : acct === base ? `The account is in ${base}, the pair's base currency, so ${quote} amounts are divided by the ${pair} price.`
    : `${quote} amounts are converted to ${acct} at the ${quote}/${acct} rate.`;
};

function PipValue() {
  const [pair, setPair] = useState<string>("EUR/USD"), [acct, setAcct] = useState<string>("USD"), [units, setUnits] = useState("100000"), [pips, setPips] = useState("1");
  const cv = useConversion(pair, acct);
  const res = cv.ready ? C.pipValue({ pair, units: n(units), pips: n(pips), price: cv.price!, account: acct, crossRate: cv.cross }) : null;
  return (
    <Calc form={<><Select label="Currency pair" value={pair} onChange={setPair} options={C.PAIRS} /><Select label="Account currency" value={acct} onChange={setAcct} options={C.ACCOUNT_CURRENCIES} />
      <SizeInput pair={pair} units={units} setUnits={setUnits} /><NumberInput label="Number of pips" value={pips} onChange={setPips} />{cv.fields}</>}
      result={res ? <>
        <Results items={[["Value per pip", money(res.perPip, acct)], [`Value of ${pips || 0} pips`, money(res.total, acct)],
          ["Per pip, 1 standard lot", money(res.standard, acct)], ["Per pip, 1 mini lot", money(res.mini, acct)], ["Per pip, 1 micro lot", money(res.micro, acct)]]} />
        <Formula>pip value = position size × pip size ({C.pipSize(pair)} for {pair}), in {C.split(pair).quote}. {conversionNote(pair, acct)}</Formula>
      </> : <Empty />} />
  );
}

function PositionSize() {
  const [pair, setPair] = useState<string>("EUR/USD"), [acct, setAcct] = useState<string>("USD"), [bal, setBal] = useState("10000"), [riskMode, setRiskMode] = useState<"percent" | "amount">("percent");
  const [risk, setRisk] = useState("1"), [stopMode, setStopMode] = useState<"pips" | "prices">("pips"), [stop, setStop] = useState("50"), [entry, setEntry] = useState(""), [stopPrice, setStopPrice] = useState("");
  const cv = useConversion(pair, acct);
  const stopPips = stopMode === "pips" ? n(stop) : C.pipsBetween(pair, n(entry), n(stopPrice));
  const res = cv.ready ? C.positionSize({ pair, balance: n(bal), stopPips, price: cv.price!, account: acct, crossRate: cv.cross, ...(riskMode === "percent" ? { riskPercent: n(risk) } : { riskAmount: n(risk) }) }) : null;
  return (
    <Calc form={<><Select label="Account currency" value={acct} onChange={setAcct} options={C.ACCOUNT_CURRENCIES} /><NumberInput label="Account balance" value={bal} onChange={setBal} suffix={acct} />
      <Select label="Risk as" value={riskMode} onChange={setRiskMode} options={[{ value: "percent", label: "Percentage of balance" }, { value: "amount", label: "Fixed amount" }]} />
      <NumberInput label={riskMode === "percent" ? "Risk percentage" : "Amount at risk"} value={risk} onChange={setRisk} suffix={riskMode === "percent" ? "%" : acct} />
      <Select label="Stop-loss as" value={stopMode} onChange={setStopMode} options={[{ value: "pips", label: "Distance in pips" }, { value: "prices", label: "Entry and stop prices" }]} />
      {stopMode === "pips" ? <NumberInput label="Stop-loss" value={stop} onChange={setStop} suffix="pips" />
        : <><NumberInput label="Entry price" value={entry} onChange={setEntry} /><NumberInput label="Stop-loss price" value={stopPrice} onChange={setStopPrice}
            hint={Number.isFinite(stopPips) && stopPips > 0 ? `= ${num(stopPips, 1)} pips` : undefined} /></>}
      <Select label="Currency pair" value={pair} onChange={setPair} options={C.PAIRS} />{cv.fields}</>}
      result={res ? <>
        <Results items={[["Amount at risk", money(res.risk, acct)], ["Position size (units)", num(res.units, 0)], ["Standard lots", num(res.lots, 2)], ["Mini lots", num(res.miniLots, 2)], ["Micro lots", num(res.microLots, 2)],
          ["Pip value per standard lot", money(res.pipValuePerLot, acct)]]} />
        <Formula>lots = amount at risk ÷ (stop-loss in pips × pip value per standard lot). {conversionNote(pair, acct)}</Formula>
      </> : <Empty />} />
  );
}

function Margin() {
  const [pair, setPair] = useState<string>("EUR/USD"), [acct, setAcct] = useState<string>("USD"), [lev, setLev] = useState("30"), [units, setUnits] = useState("100000");
  const cv = useConversion(pair, acct);
  const res = cv.ready ? C.margin({ pair, units: n(units), leverage: n(lev), price: cv.price!, account: acct, crossRate: cv.cross }) : null;
  return (
    <Calc form={<><Select label="Currency pair" value={pair} onChange={setPair} options={C.PAIRS} /><Select label="Account currency" value={acct} onChange={setAcct} options={C.ACCOUNT_CURRENCIES} />
      <Select label="Leverage" value={lev} onChange={setLev} options={["1", "2", "5", "10", "20", "30", "50", "100", "200", "400", "500", "1000"].map((v) => ({ value: v, label: `${v}:1` }))} />
      <SizeInput pair={pair} units={units} setUnits={setUnits} />{cv.fields}</>}
      result={res ? <>
        <Results items={[["Required margin", money(res.margin, acct)], ["Position value", money(res.notional, acct)], ["Margin requirement", `${num(res.requirementPercent)}%`]]} />
        <Formula>required margin = position value in {acct} ÷ leverage. Position value = units × {pair} price (in {C.split(pair).quote}); {conversionNote(pair, acct)}</Formula>
      </> : <Empty />} />
  );
}

function GainLoss() {
  const [start, setStart] = useState("10000"), [mode, setMode] = useState<"end" | "amount" | "percent">("end"), [v, setV] = useState("8000");
  const res = C.gainLoss({ start: n(start), ...(mode === "end" ? { end: n(v) } : mode === "amount" ? { amount: n(v) } : { percent: n(v) }) });
  const sign = (x: number, d = 2) => `${x > 0 ? "+" : ""}${num(x, d)}`;
  return (
    <Calc form={<><NumberInput label="Starting balance" value={start} onChange={setStart} />
      <Select label="I know the" value={mode} onChange={(m) => { setMode(m); setV(""); }} options={[{ value: "end", label: "Ending balance" }, { value: "amount", label: "Amount gained or lost" }, { value: "percent", label: "Percentage gained or lost" }]} />
      <NumberInput label={mode === "end" ? "Ending balance" : mode === "amount" ? "Amount gained (negative for a loss)" : "Percentage (negative for a loss)"} value={v} onChange={setV} suffix={mode === "percent" ? "%" : undefined} /></>}
      result={res ? <>
        <Results items={[["Ending balance", num(res.end)], ["Amount", sign(res.amount)], ["Gain / loss", `${sign(res.percent)}%`],
          ...(res.percent < 0 ? [["Gain needed to recover", `${num(res.recoveryPercent)}%`] as [string, string]] : [])]} />
        <Formula>% change = (ending − starting) ÷ starting × 100. After a loss, the gain needed to get back = loss% ÷ (100 − loss%) × 100.</Formula>
      </> : <Empty />} />
  );
}

function Profit() {
  const [pair, setPair] = useState<string>("EUR/USD"), [acct, setAcct] = useState<string>("USD"), [dir, setDir] = useState<"buy" | "sell">("buy");
  const [open, setOpen] = useState("1.1000"), [close, setClose] = useState("1.1050"), [units, setUnits] = useState("100000");
  const needs = C.needsCross(pair, acct);
  const cross = useRate(C.split(pair).quote, needs ? acct : C.split(pair).quote);
  const res = C.profit({ pair, direction: dir, open: n(open), close: n(close), units: n(units), account: acct, crossRate: needs ? cross.value : null });
  return (
    <Calc form={<><Select label="Currency pair" value={pair} onChange={setPair} options={C.PAIRS} /><Select label="Account currency" value={acct} onChange={setAcct} options={C.ACCOUNT_CURRENCIES} />
      <Select label="Direction" value={dir} onChange={setDir} options={[{ value: "buy", label: "Long (bought)" }, { value: "sell", label: "Short (sold)" }]} />
      <NumberInput label="Open price" value={open} onChange={setOpen} /><NumberInput label="Close price" value={close} onChange={setClose} />
      <SizeInput pair={pair} units={units} setUnits={setUnits} />{needs && cross.field}</>}
      result={res && res.account != null ? <>
        <Results items={[["Pips", num(res.pips, 1)], ["Result", money(res.account, acct)], [`Result in ${C.split(pair).quote}`, money(res.quote, C.split(pair).quote)]]} />
        <Formula>result = (close − open) × units, reversed for a short, in {C.split(pair).quote}. {acct === C.split(pair).base ? `Converted to ${acct} at the close price.` : conversionNote(pair, acct)}</Formula>
      </> : <Empty />} />
  );
}

function RiskReward() {
  const [pair, setPair] = useState<string>("EUR/USD"), [mode, setMode] = useState<"prices" | "pips">("prices");
  const [entry, setEntry] = useState("1.1000"), [stop, setStop] = useState("1.0950"), [target, setTarget] = useState("1.1150");
  const [rp, setRp] = useState("50"), [wp, setWp] = useState("150"), [acct, setAcct] = useState<string>("USD"), [units, setUnits] = useState("");
  const dist = mode === "prices" ? C.riskRewardFromPrices(pair, n(entry), n(stop), n(target)) : { riskPips: n(rp), rewardPips: n(wp) };
  const cv = useConversion(pair, acct);
  const res = dist && !("error" in dist) ? C.riskReward({ pair, riskPips: dist.riskPips, rewardPips: dist.rewardPips, units: n(units) || undefined, price: cv.price ?? undefined, account: acct, crossRate: cv.cross }) : null;
  return (
    <Calc form={<><Select label="Currency pair" value={pair} onChange={setPair} options={C.PAIRS} />
      <Select label="Enter" value={mode} onChange={setMode} options={[{ value: "prices", label: "Entry, stop and target prices" }, { value: "pips", label: "Distances in pips" }]} />
      {mode === "prices" ? <><NumberInput label="Entry price" value={entry} onChange={setEntry} /><NumberInput label="Stop-loss price" value={stop} onChange={setStop} /><NumberInput label="Target price" value={target} onChange={setTarget} /></>
        : <><NumberInput label="Distance to stop-loss" value={rp} onChange={setRp} suffix="pips" /><NumberInput label="Distance to target" value={wp} onChange={setWp} suffix="pips" /></>}
      <NumberInput label="Position size (optional)" value={units} onChange={setUnits} suffix="units" hint="To show the amounts in money." />
      {n(units) > 0 && <><Select label="Account currency" value={acct} onChange={setAcct} options={C.ACCOUNT_CURRENCIES} />{cv.fields}</>}</>}
      result={dist && "error" in dist ? <p className="rounded-xl border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-soft p-4 text-[13px] text-warn">{dist.error}</p> : res ? <>
        <Results items={[["Risk : reward", `1 : ${num(res.ratio, 2)}`], ["Break-even win rate", `${num(res.breakEvenWinRate, 1)}%`], ["Distance to stop", `${num(res.riskPips, 1)} pips`], ["Distance to target", `${num(res.rewardPips, 1)} pips`],
          ...(res.money ? [["Amount at the stop", money(res.money.risk, acct)], ["Amount at the target", money(res.money.reward, acct)]] as [string, string][] : [])]} />
        <Formula>ratio = distance from entry to target ÷ distance from entry to stop. Break-even win rate = 1 ÷ (1 + ratio): the share of outcomes that would need to reach the target for the two sides to balance.</Formula>
      </> : <Empty />} />
  );
}

function Pivots() {
  const [h, setH] = useState("1.3200"), [l, setL] = useState("1.3000"), [c, setC] = useState("1.3100"), [o, setO] = useState("1.3050");
  const [pair, setPair] = useState<string>("EUR/USD"), [period, setPeriod] = useState("daily");
  const [loaded, setLoaded] = useState<string | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const fill = async () => {
    setBusy(true); setErr(null);
    try {
      const b = await api.ohlc(pair, period);
      const d = C.priceDigits(pair);
      setH(b.high.toFixed(d)); setL(b.low.toFixed(d)); setC(b.close.toFixed(d)); setO(b.open.toFixed(d));
      setLoaded(`${pair}, previous ${({ daily: "day", weekly: "week", monthly: "month" } as Record<string, string>)[period]}${b.start ? ` (from ${new Date(b.start).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })})` : ""} · ${b.source}`);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const sets = C.pivots({ high: n(h), low: n(l), close: n(c), open: o.trim() ? n(o) : undefined });
  const keys = ["R4", "R3", "R2", "R1", "PP", "S1", "S2", "S3", "S4"];
  const d = Math.max(...[h, l, c].map((x) => (x.split(".")[1] ?? "").length), 2);
  return (
    <Calc form={<>
      <div className="space-y-2 rounded-xl border border-line p-3">
        <p className="text-[12.5px] font-medium text-muted">Fill from the last completed period</p>
        <div className="grid grid-cols-2 gap-2"><Select label="Pair" value={pair} onChange={setPair} options={C.PAIRS} />
          <Select label="Period" value={period} onChange={setPeriod} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} /></div>
        <button onClick={fill} disabled={busy} className="h-8 w-full cursor-pointer rounded-lg border border-line bg-surface-2 text-[13px] hover:bg-surface-3 disabled:opacity-50">{busy ? "Loading…" : "Fill high, low, close and open"}</button>
        {loaded && <p className="text-[11.5px] text-faint">{loaded}</p>}{err && <p className="text-[12px] text-danger">{err}</p>}
      </div>
      <NumberInput label="High" value={h} onChange={setH} /><NumberInput label="Low" value={l} onChange={setL} /><NumberInput label="Close" value={c} onChange={setC} />
      <NumberInput label="Open (for DeMark)" value={o} onChange={setO} hint="Previous period's open; optional." /></>}
      result={!sets ? <p className="rounded-xl border border-dashed border-line p-4 text-center text-[13px] text-muted">High must be above low, with the close between them.</p> : (<>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="num w-full text-[13px]">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-faint"><tr><th className="px-3 py-2 text-left">Level</th>{sets.map((s) => <th key={s.method} className="px-3 py-2 text-right">{s.method}</th>)}</tr></thead>
            <tbody className="divide-y divide-[var(--border)]">
              {keys.filter((k) => sets.some((s) => s.levels[k] != null)).map((k) => (
                <tr key={k} className={k === "PP" ? "bg-accent-soft" : ""}><td className="px-3 py-1.5 font-semibold">{k}</td>{sets.map((s) => <td key={s.method} className="px-3 py-1.5 text-right">{s.levels[k] != null ? s.levels[k].toFixed(d) : ""}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <Formula>
          Floor: PP = (H + L + C) ÷ 3, R1 = 2PP − L, S1 = 2PP − H, R2 = PP + (H − L), S2 = PP − (H − L), R3 = H + 2(PP − L), S3 = L − 2(H − PP).
          {" "}Woodie: PP = (H + L + 2C) ÷ 4, then R1/S1/R2/S2 as Floor. Camarilla: C ± (H − L) × 1.1 ÷ 12, 6, 4, 2.
          {" "}DeMark: X = H + 2L + C if C &lt; O, 2H + L + C if C &gt; O, else H + L + 2C; PP = X ÷ 4, R1 = X ÷ 2 − L, S1 = X ÷ 2 − H.
          {" "}Fibonacci: PP ± (H − L) × 0.382, 0.618, 1.000.
        </Formula>
      </>)} />
  );
}

function Fibonacci() {
  const [h, setH] = useState("1.2000"), [l, setL] = useState("1.1000"), [trend, setTrend] = useState<"up" | "down">("up");
  const res = C.fibonacci({ high: n(h), low: n(l), trend });
  const d = Math.max(...[h, l].map((x) => (x.split(".")[1] ?? "").length), 2);
  const row = (label: string, rows: { ratio: number; price: number }[]) => (
    <div className="rounded-xl border border-line">
      <p className="border-b border-line bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</p>
      <ul className="num divide-y divide-[var(--border)] text-[13px]">{rows.map((r) => <li key={r.ratio} className="flex justify-between px-3 py-1.5"><span className="text-muted">{num(r.ratio * 100, 1)}%</span><span className="font-semibold">{r.price.toFixed(d)}</span></li>)}</ul>
    </div>
  );
  return (
    <Calc form={<><Select label="Move" value={trend} onChange={setTrend} options={[{ value: "up", label: "Upward (swing low → swing high)" }, { value: "down", label: "Downward (swing high → swing low)" }]} />
      <NumberInput label="Swing high" value={h} onChange={setH} /><NumberInput label="Swing low" value={l} onChange={setL} /></>}
      result={!res ? <Empty /> : <>
        <div className="grid gap-3 sm:grid-cols-2">{row("Retracements", res.retracements)}{row("Extensions", res.extensions)}</div>
        <Formula>{trend === "up" ? "Upward move: retracement = high − (high − low) × ratio; extension = low + (high − low) × ratio." : "Downward move: retracement = low + (high − low) × ratio; extension = high − (high − low) × ratio."} 127.2% is √1.618.</Formula>
      </>} />
  );
}

const PER_YEAR: Record<string, number> = { days: 252, weeks: 52, months: 12, years: 1 };

function Compounding() {
  const [start, setStart] = useState("1000"), [rate, setRate] = useState("2"), [periods, setPeriods] = useState("12"), [unit, setUnit] = useState("months"), [dep, setDep] = useState("0"), [wd, setWd] = useState("0");
  const res = C.compounding({ start: n(start), ratePercent: n(rate), periods: n(periods), deposit: n(dep) || 0, withdrawal: n(wd) || 0 });
  return (
    <Calc form={<><NumberInput label="Starting balance" value={start} onChange={setStart} />
      <div className="grid grid-cols-2 gap-2"><NumberInput label="Number of periods" value={periods} onChange={setPeriods} />
        <Select label="Period" value={unit} onChange={setUnit} options={[{ value: "days", label: "Trading days" }, { value: "weeks", label: "Weeks" }, { value: "months", label: "Months" }, { value: "years", label: "Years" }]} /></div>
      <NumberInput label={`Return per ${unit.replace(/s$/, "")}`} value={rate} onChange={setRate} suffix="%" />
      <NumberInput label="Deposit per period" value={dep} onChange={setDep} hint="Optional." /><NumberInput label="Withdrawal per period" value={wd} onChange={setWd} hint="Optional." /></>}
      result={!res ? <Empty /> : (
        <div className="space-y-3">
          <Results items={[["Ending balance", num(res.end)], ["Total gain", num(res.totalGain)], ["Total deposits", num(res.deposits)], ["Total withdrawals", num(res.withdrawals)],
            ...(unit !== "years" ? [["Annualised equivalent", `${num(C.annualised(n(rate), PER_YEAR[unit]))}%`] as [string, string]] : [])]} />
          <Table head={["Period", "Start", "Gain", "Deposit", "Withdrawal", "End"]} rows={res.rows.map((r) => [r.period, num(r.start), num(r.gain), num(r.deposit), num(r.withdrawal), num(r.end)])} />
          <Formula>each period: end = start × (1 + return%) + deposit − withdrawal. The return is applied first, so a deposit compounds from the next period. A fixed return is an illustration; real results vary.</Formula>
        </div>
      )} />
  );
}

function Drawdown() {
  const [start, setStart] = useState("10000"), [loss, setLoss] = useState("2"), [count, setCount] = useState("10");
  const res = C.drawdown({ start: n(start), lossPercent: n(loss), losses: n(count) });
  const last = res?.rows[res.rows.length - 1];
  return (
    <Calc form={<><NumberInput label="Starting balance" value={start} onChange={setStart} /><NumberInput label="Loss per losing trade" value={loss} onChange={setLoss} suffix="%" hint="Percentage of the balance at the time." />
      <NumberInput label="Consecutive losing trades" value={count} onChange={setCount} /></>}
      result={!res || !last ? <Empty /> : (
        <div className="space-y-3">
          <Results items={[["Starting balance", num(n(start))], ["Balance after the losses", num(res.end)], ["Drawdown", `${num(last.drawdownPercent)}%`], ["Gain needed to recover", `${num(last.recoveryPercent)}%`]]} />
          <Table head={["Trade", "Balance", "Drawdown", "Gain to recover"]} rows={res.rows.map((r) => [r.trade, num(r.balance), `${num(r.drawdownPercent)}%`, `${num(r.recoveryPercent)}%`])} />
          <Formula>after n losses: balance = start × (1 − loss%)ⁿ. Drawdown = 1 − balance ÷ start. Gain to recover = drawdown ÷ (1 − drawdown).</Formula>
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
      result={r.value && Number.isFinite(n(amt)) ? <><Results items={[["Converted", money(n(amt) * r.value, to, to === "JPY" ? 0 : 2)], ["Rate", `1 ${from} = ${num(r.value, 5)} ${to}`], ["Inverse", `1 ${to} = ${num(1 / r.value, 5)} ${from}`]]} />
        <Formula>converted = amount × rate.</Formula></> : <Empty />} />
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
  { id: "position", title: "Position size", icon: <Scale className="size-4" />, about: "The position size at which the stop-loss distance equals the amount you chose to risk.", el: () => <PositionSize /> },
  { id: "margin", title: "Margin", icon: <Gauge className="size-4" />, about: "Margin a broker would hold for a position at a given leverage.", el: () => <Margin /> },
  { id: "gainloss", title: "Gain & loss %", icon: <Percent className="size-4" />, about: "The percentage gained or lost between two balances, and the gain needed to recover a loss.", el: () => <GainLoss /> },
  { id: "profit", title: "Trade profit/loss", icon: <TrendingUp className="size-4" />, about: "The result of a position between two prices, in pips and in your account currency.", el: () => <Profit /> },
  { id: "rr", title: "Risk-reward", icon: <Divide className="size-4" />, about: "The distance to the stop-loss against the distance to the target, and the break-even win rate.", el: () => <RiskReward /> },
  { id: "pivot", title: "Pivot points", icon: <Sigma className="size-4" />, about: "Floor, Woodie, Camarilla, DeMark and Fibonacci pivot levels from the previous day, week or month.", el: () => <Pivots /> },
  { id: "fib", title: "Fibonacci", icon: <Percent className="size-4" />, about: "Retracement and extension levels of a move between a swing high and a swing low.", el: () => <Fibonacci /> },
  { id: "compound", title: "Compounding", icon: <Coins className="size-4" />, about: "How a balance grows at a fixed percentage per period, with optional deposits and withdrawals.", el: () => <Compounding /> },
  { id: "drawdown", title: "Drawdown", icon: <TrendingDown className="size-4" />, about: "The balance after a run of losses and the gain needed to get back to the start.", el: () => <Drawdown /> },
  { id: "convert", title: "Currency converter", icon: <Globe2 className="size-4" />, about: "Convert an amount between currencies at the latest rate.", el: () => <Converter /> },
];

export function Calculators() {
  const [id, setId] = useState(() => { try { return localStorage.getItem("fx.calc") ?? "pip"; } catch { return "pip"; } });
  useEffect(() => { try { localStorage.setItem("fx.calc", id); } catch { /* storage unavailable */ } }, [id]);
  const cur = LIST.find((c) => c.id === id) ?? LIST[0];
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-muted" role="note">
        <strong className="text-fg">General trading arithmetic.</strong> Nothing here is a recommendation to trade.
      </div>
      <div className="grid gap-3 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav className="panel h-fit min-w-0 p-2 lg:sticky lg:top-24" aria-label="Calculators">
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
