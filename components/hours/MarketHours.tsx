"use client";

import * as C from "@/lib/calc/forex";
import { browserZone, useNow } from "../desk/api";
import { memo, useMemo, useState } from "react";
import { dtf, partsOf } from "@/lib/fmt";
import { cx } from "../desk/ui";

const two = (n: number) => String(n).padStart(2, "0");
function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${two(m)}m` : `${h}h ${two(m)}m ${two(s % 60)}s`;
}
/** Wall-clock parts of an instant in a zone. */
function parts(t: number, tz: string) {
  const p = partsOf("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short", day: "numeric", month: "short" }, t);
  return { h: Number(p.hour), m: Number(p.minute), s: Number(p.second), date: `${p.weekday} ${p.day} ${p.month}` };
}

/** Classic analogue face: hour, minute and sweeping second hand. */
function Clock({ h, m, s, open }: { h: number; m: number; s: number; open: boolean }) {
  const hand = (deg: number, len: number, w: number, cls: string) => (
    <line x1="50" y1="50" x2={50 + len * Math.sin((deg * Math.PI) / 180)} y2={50 - len * Math.cos((deg * Math.PI) / 180)} strokeWidth={w} strokeLinecap="round" className={cls} />
  );
  return (
    <svg viewBox="0 0 100 100" className="size-28 sm:size-40" role="img" aria-label={`${two(h)}:${two(m)}`}>
      <circle cx="50" cy="50" r="47" className="fill-[var(--surface-2)] stroke-[var(--border-strong)]" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="43" className={cx("fill-none", open ? "stroke-[var(--ok)]" : "stroke-[var(--border)]")} strokeWidth="1" />
      {Array.from({ length: 60 }, (_, i) => {
        const a = (i * 6 * Math.PI) / 180, major = i % 5 === 0, r1 = major ? 36 : 39;
        return <line key={i} x1={50 + r1 * Math.sin(a)} y1={50 - r1 * Math.cos(a)} x2={50 + 41 * Math.sin(a)} y2={50 - 41 * Math.cos(a)} strokeWidth={major ? 1.6 : 0.6} className="stroke-[var(--muted)]" />;
      })}
      {[12, 3, 6, 9].map((n, i) => <text key={n} x={50 + 29 * Math.sin((i * Math.PI) / 2)} y={50 - 29 * Math.cos((i * Math.PI) / 2) + 3.2} textAnchor="middle" className="fill-[var(--muted)] font-serif text-[9px]">{n}</text>)}
      {hand(((h % 12) + m / 60) * 30, 21, 3.2, "stroke-[var(--text)]")}
      {hand((m + s / 60) * 6, 31, 2, "stroke-[var(--text)]")}
      {hand(s * 6, 35, 0.9, "stroke-[var(--danger)] transition-[x2,y2] duration-200")}
      <circle cx="50" cy="50" r="2.2" className="fill-[var(--danger)]" />
    </svg>
  );
}

// ---------------------------------------------------------------- time zone converter (BabyPips-style board)

const SESSION_COLOR: Record<string, string> = { Sydney: "#3b5bdb", Tokyo: "#a3008a", London: "#3b9cf0", "New York": "#4cc21c" };
const ZONES: [string, string][] = [["Australia/Sydney", "Sydney"], ["Asia/Tokyo", "Tokyo"], ["Asia/Hong_Kong", "Hong Kong"], ["Asia/Dubai", "Dubai"],
  ["Africa/Kampala", "Kampala"], ["Africa/Nairobi", "Nairobi"], ["Africa/Kigali", "Kigali"], ["Africa/Lagos", "Lagos"], ["Africa/Johannesburg", "Johannesburg"],
  ["Europe/London", "London"], ["Europe/Berlin", "Frankfurt"], ["America/New_York", "New York"], ["America/Chicago", "Chicago"], ["America/Los_Angeles", "Los Angeles"], ["UTC", "UTC"]];
const offset = (tz: string, t: number) => dtf("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date(t)).find((x) => x.type === "timeZoneName")?.value.replace("GMT", "GMT ").replace("GMT ", "GMT") ?? "GMT";
const ABBR: Record<string, (off: string) => string> = {
  "Australia/Sydney": (o) => (o.includes("+11") ? "AEDT" : "AEST"), "Asia/Tokyo": () => "JST",
  "Europe/London": (o) => (o.includes("+1") ? "BST" : "GMT"), "America/New_York": (o) => (o.includes("-4") ? "EDT" : "EST"),
};
const ord = (d: number) => `${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`;
function clock(t: number, tz: string, h24: boolean) {
  return dtf("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: !h24 }).format(new Date(t)).toLowerCase();
}

/** Small round flags, drawn inline. */
function Flag({ name }: { name: string }) {
  const common = { width: 28, height: 28, viewBox: "0 0 28 28" };
  const clip = <clipPath id={`f-${name}`}><circle cx="14" cy="14" r="13" /></clipPath>;
  const ring = <circle cx="14" cy="14" r="13" fill="none" stroke="var(--border-strong)" />;
  if (name === "Tokyo") return <svg {...common} aria-hidden><circle cx="14" cy="14" r="13" fill="#fff" /><circle cx="14" cy="14" r="5.5" fill="#bc002d" />{ring}</svg>;
  if (name === "New York") return (
    <svg {...common} aria-hidden><defs>{clip}</defs><g clipPath={`url(#f-${name})`}>
      {Array.from({ length: 7 }, (_, i) => <rect key={i} y={i * 4} width="28" height="2" fill="#b22234" />)}{Array.from({ length: 7 }, (_, i) => <rect key={`w${i}`} y={i * 4 + 2} width="28" height="2" fill="#fff" />)}
      <rect width="13" height="14" fill="#3c3b6e" />{[3, 7, 11].flatMap((x) => [3, 7, 11].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="0.9" fill="#fff" />))}
    </g>{ring}</svg>
  );
  const jack = (
    <g>
      <rect width="28" height="28" fill="#012169" />
      <path d="M0 0L28 28M28 0L0 28" stroke="#fff" strokeWidth="5" /><path d="M0 0L28 28M28 0L0 28" stroke="#c8102e" strokeWidth="2" />
      <path d="M14 0V28M0 14H28" stroke="#fff" strokeWidth="7" /><path d="M14 0V28M0 14H28" stroke="#c8102e" strokeWidth="4" />
    </g>
  );
  if (name === "London") return <svg {...common} aria-hidden><defs>{clip}</defs><g clipPath={`url(#f-${name})`}>{jack}</g>{ring}</svg>;
  return ( // Sydney: Australian flag, simplified
    <svg {...common} aria-hidden><defs>{clip}</defs><g clipPath={`url(#f-${name})`}>
      <rect width="28" height="28" fill="#012169" /><g transform="scale(0.5)">{jack}</g>
      {[[20, 8], [23, 14], [17, 16], [20, 21], [7, 21]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 4 ? 2 : 1.2} fill="#fff" />)}
    </g>{ring}</svg>
  );
}

/** Computed once per day shown (it does not depend on the current second). */
const ActivityCurve = memo(function ActivityCurve({ start, end }: { start: number; end: number }) {
  const n = 96, pts = Array.from({ length: n + 1 }, (_, i) => { const t = start + ((end - start) * i) / n; return { t, a: C.activityAt(t).score }; });
  const max = 7, y = (a: number) => 52 - (a / max) * 44;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${((i / n) * 1000).toFixed(1)},${y(p.a).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 1000 56" preserveAspectRatio="none" className="h-14 w-full" aria-hidden>
      <defs><linearGradient id="act" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="#e64980" /><stop offset="45%" stopColor="#f59f00" /><stop offset="100%" stopColor="#40c057" /></linearGradient></defs>
      <path d={`${d} L1000,56 L0,56 Z`} fill="var(--surface-3)" opacity="0.6" />
      <path d={d} fill="none" stroke="url(#act)" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
});

function Converter({ now }: { now: number }) {
  const browser = browserZone() || "UTC";
  const [tz, setTz] = useState(browser);
  const [h24, setH24] = useState(true);
  const zones = ZONES.some(([z]) => z === browser) ? ZONES : [[browser, browser.split("/").pop()!.replace("_", " ")] as [string, string], ...ZONES];
  // Session windows, open/closed states and the activity level change at most once a minute: recompute per minute.
  const minute = Math.floor(now / 60_000);
  const { day, sessions, live, act } = useMemo(() => {
    const t = minute * 60_000, day = C.dayIn(t, tz);
    return { day, sessions: C.sessionsInDay(day.start, day.end), live: C.sessionsAt(t), act: C.activityAt(t) };
  }, [minute, tz]);
  const span = day.end - day.start;
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - day.start) / span) * 100));
  const nowPct = pct(now);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const label = (h: number) => (h24 ? String(h) : h === 0 ? "•" : String(((h + 11) % 12) + 1));
  const lights = { High: "#40c057", Medium: "#f59f00", Low: "#e64980" } as const;

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-end gap-4 border-b border-line px-5 pb-3 pt-4">
        <div>
          <h2 className="font-serif text-[20px] tracking-wide">Forex market time zone converter</h2>
          <p className="text-[12.5px] text-muted">Session hours shown in the time zone you choose. Bars mark when each centre is trading.</p>
        </div>
        <label className="ml-auto flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Time zone
          <select value={tz} onChange={(e) => setTz(e.target.value)} className="h-9 cursor-pointer rounded-lg border border-transparent bg-accent-strong px-3 text-[13.5px] font-medium normal-case tracking-normal text-white">
            {zones.map(([z, name]) => <option key={z} value={z}>{name} ({offset(z, now)})</option>)}
          </select>
        </label>
        <div className="flex flex-col items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint"><span id="h24-label">24-hour time</span>
          <button role="switch" aria-checked={h24} aria-labelledby="h24-label" onClick={() => setH24(!h24)} className={cx("relative h-6 w-11 rounded-full transition-colors", h24 ? "bg-accent-strong" : "bg-surface-3")}>
            <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left]", h24 ? "left-[22px]" : "left-0.5")} />
          </button>
        </div>
      </div>

      <div className="px-3 pb-4 pt-2 sm:px-5">
        <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[230px_minmax(0,1fr)] md:gap-x-0">
          {/* hour scale + now pin */}
          <div className="hidden md:block" />
          <div className="relative h-20">
            <div className="absolute inset-x-0 bottom-1 flex">
              {hours.map((h) => <span key={h} className={cx("num flex-1 text-center text-[12px] font-semibold text-muted", h % 3 !== 0 && "max-sm:invisible")}>{label(h)}</span>)}
            </div>
            <div className="absolute top-0 z-20 -translate-x-1/2" style={{ left: `${nowPct}%` }}>
              <div className="flex flex-col items-center rounded-t-full rounded-b-lg bg-accent-strong px-2.5 pb-1.5 pt-2 text-center text-white shadow-lg">
                <svg viewBox="0 0 20 20" className="size-5" aria-hidden><circle cx="10" cy="10" r="9" fill="#fff" />
                  <line x1="10" y1="10" x2={10 + 5 * Math.sin((parts(now, tz).h % 12 + parts(now, tz).m / 60) * Math.PI / 6)} y2={10 - 5 * Math.cos((parts(now, tz).h % 12 + parts(now, tz).m / 60) * Math.PI / 6)} stroke="#333" strokeWidth="1.8" strokeLinecap="round" />
                  <line x1="10" y1="10" x2={10 + 7 * Math.sin(parts(now, tz).m * Math.PI / 30)} y2={10 - 7 * Math.cos(parts(now, tz).m * Math.PI / 30)} stroke="#333" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <span className="num text-[11.5px] font-bold leading-tight">{clock(now, tz, h24)}</span>
                <span className="text-[10.5px] leading-tight opacity-90">{dtf("en-US", { timeZone: tz, weekday: "long" }).format(new Date(now))}</span>
              </div>
            </div>
          </div>

          {sessions.map((s) => {
            const p = parts(now, s.tz), off = offset(s.tz, now), isOpen = live.find((x) => x.name === s.name)?.open_now ?? false;
            const dp = partsOf("en-US", { timeZone: s.tz, weekday: "short", month: "short", day: "numeric" }, now), date = `${dp.weekday} ${dp.month}. ${ord(Number(dp.day))}`;
            return (
              <div key={s.name} className="contents">
                <div className="mt-2 flex items-center gap-3 rounded-l-xl bg-surface-2 px-3 py-3 max-md:rounded-xl md:mt-3">
                  <Flag name={s.name} />
                  <div className="min-w-0 leading-tight">
                    <p className="font-serif text-[16px] font-semibold">{s.name}</p>
                    <p className="num text-[14px] text-muted">{clock(now, s.tz, h24)}<span className="sr-only"> {two(p.s)}s</span></p>
                    <p className="text-[11px] leading-snug text-faint">{date} {ABBR[s.tz]?.(off) ?? ""} ({off.replace("GMT", "UTC ")})</p>
                  </div>
                </div>
                <div className="relative mt-1 h-[78px] overflow-hidden rounded-r-xl bg-surface-2 max-md:rounded-xl md:mt-3">
                  {hours.map((h) => <span key={h} className="absolute inset-y-0 w-px bg-[var(--border)]" style={{ left: `${(h / 24) * 100}%` }} aria-hidden />)}
                  <span className="absolute left-2 top-1.5 z-10 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: SESSION_COLOR[s.name] }}>
                    {s.name} session {isOpen ? "open" : "closed"}
                  </span>
                  {s.windows.map((w, i) => (
                    <span key={i} title={`${clock(w.start, tz, h24)} – ${clock(w.end, tz, h24)}`} className={cx("absolute bottom-3 top-7 rounded-sm transition-opacity", !isOpen && "opacity-85")}
                      style={{ left: `${pct(w.start)}%`, width: `${pct(w.end) - pct(w.start)}%`, background: SESSION_COLOR[s.name] }} />
                  ))}
                  <span className="absolute inset-y-0 z-10 w-[3px] -translate-x-1/2 bg-accent-strong" style={{ left: `${nowPct}%` }} aria-hidden />
                </div>
              </div>
            );
          })}

          {/* typical activity */}
          <div className="mt-4 flex flex-col items-center justify-center gap-2 px-3 text-center">
            <p className="text-[12.5px] font-semibold text-muted">Trading volume is usually {act.level.toLowerCase()} at this time of day.</p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-0.5 text-[12.5px] font-semibold">
              <span className="size-3 rounded-full" style={{ background: lights[act.level] }} aria-hidden />{act.level}
            </span>
          </div>
          <div className="relative mt-4 rounded-xl border border-line bg-surface-2">
            <ActivityCurve start={day.start} end={day.end} />
            <span className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-accent-strong" style={{ left: `${nowPct}%` }} aria-hidden />
            <span className="absolute top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-full border border-line bg-[var(--surface)] p-1 shadow" style={{ left: `${nowPct}%` }} aria-hidden>
              {(["High", "Medium", "Low"] as const).map((l) => <span key={l} className="size-3 rounded-full" style={{ background: act.level === l ? lights[l] : "var(--surface-3)" }} />)}
            </span>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] text-faint">Volume is an estimate from how many centres are trading at once (London and New York weigh most); it is not measured volume. Session hours are each centre's usual business hours and follow its own daylight-saving rules.</p>
      </div>
    </section>
  );
}

export function MarketHours() {
  const now = useNow(1000);
  const tz = browserZone() || "UTC";
  const minute = Math.floor(now / 60_000);
  const { sessions, open, nextChange } = useMemo(() => {
    const t = minute * 60_000;
    return { sessions: C.sessionsAt(t), open: C.fxMarketOpen(t), nextChange: C.nextMarketChange(t).at };
  }, [minute]);
  const local = parts(now, tz);
  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2 px-5 py-3">
          <span className={cx("size-2.5 rounded-full", open ? "bg-[var(--ok)] shadow-[0_0_10px_var(--ok)]" : "bg-[var(--warn)]")} aria-hidden />
          <h2 className="font-serif text-[19px] tracking-wide">The forex market is {open ? "open" : "closed"}</h2>
          {nextChange && <span className="num text-[13px] text-muted">{open ? "closes" : "reopens"} {dtf("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(nextChange))} · in {countdown(nextChange - now)}</span>}
          <span className="num ml-auto text-[13px] text-muted">Your time {local.date} {two(local.h)}:{two(local.m)}:{two(local.s)} · {tz}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 px-4 py-6 lg:grid-cols-4">
          {sessions.map((s) => {
            const p = parts(now, s.tz);
            const until = s.open_now && s.current ? `closes in ${countdown(s.current.end - now)}` : s.next ? `opens in ${countdown(s.next.start - now)}` : "closed";
            return (
              <div key={s.name} className="flex flex-col items-center text-center">
                <Clock h={p.h} m={p.m} s={p.s} open={s.open_now} />
                <h3 className="mt-2 font-serif text-[18px] tracking-wide">{s.name}</h3>
                <p className="num text-[15px] font-semibold">{two(p.h)}:{two(p.m)}:{two(p.s)}</p>
                <p className="text-[12px] text-faint">{p.date} · {s.tz}</p>
                <p className={cx("mt-1.5 inline-flex flex-wrap items-center justify-center gap-x-1.5 rounded-2xl border px-2.5 py-0.5 text-[12px] max-sm:text-[11px]", s.open_now ? "border-[color-mix(in_srgb,var(--ok)_45%,transparent)] text-ok" : "border-line text-muted")}>
                  <span className={cx("size-1.5 rounded-full", s.open_now ? "bg-[var(--ok)]" : "bg-[var(--faint)]")} aria-hidden />{s.open_now ? "Open" : "Closed"} · <span className="num">{until}</span>
                </p>
              </div>
            );
          })}
        </div>
      </section>
      <Converter now={now} />
    </div>
  );
}
