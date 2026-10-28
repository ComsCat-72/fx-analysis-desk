"use client";

import * as C from "@/lib/calc/forex";
import { browserZone, useNow } from "../desk/api";
import { cx } from "../desk/ui";

const two = (n: number) => String(n).padStart(2, "0");
function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${two(m)}m` : `${h}h ${two(m)}m ${two(s % 60)}s`;
}
/** Wall-clock parts of an instant in a zone. */
function parts(t: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short", day: "numeric", month: "short" })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { h: Number(p.hour), m: Number(p.minute), s: Number(p.second), date: `${p.weekday} ${p.day} ${p.month}` };
}
const fmt = (t: number, tz?: string) => new Date(t).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Classic analogue face: hour, minute and sweeping second hand. */
function Clock({ h, m, s, open }: { h: number; m: number; s: number; open: boolean }) {
  const hand = (deg: number, len: number, w: number, cls: string) => (
    <line x1="50" y1="50" x2={50 + len * Math.sin((deg * Math.PI) / 180)} y2={50 - len * Math.cos((deg * Math.PI) / 180)} strokeWidth={w} strokeLinecap="round" className={cls} />
  );
  return (
    <svg viewBox="0 0 100 100" className="size-36 sm:size-40" role="img" aria-label={`${two(h)}:${two(m)}`}>
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

export function MarketHours() {
  const now = useNow(1000);
  const tz = browserZone() || "UTC";
  const sessions = C.sessionsAt(now);
  const open = C.fxMarketOpen(now);
  // The viewer's local day as the 24-hour board.
  const local = parts(now, tz);
  const dayStart = now - ((local.h * 60 + local.m) * 60 + local.s) * 1000 - (now % 1000);
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - dayStart) / 86400_000) * 100));
  const nowPct = pct(now);
  // Weekly open/close: Sunday 17:00 to Friday 17:00 New York.
  const nextChange = (() => {
    for (let t = now + 60_000, i = 0; i < 8 * 24 * 60; i++, t += 60_000) if (C.fxMarketOpen(t) !== open) return t - (t % 60_000);
    return null;
  })();
  const overlaps = [["Tokyo", "London"], ["London", "New York"], ["Sydney", "Tokyo"]].flatMap(([a, b]) => {
    const A = sessions.find((s) => s.name === a)!, B = sessions.find((s) => s.name === b)!;
    return A.windows.flatMap((x) => B.windows.map((y) => ({ name: `${a} – ${b}`, start: Math.max(x.start, y.start), end: Math.min(x.end, y.end) }))).filter((o) => o.end > o.start && o.end > dayStart && o.start < dayStart + 86400_000);
  });

  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2 px-5 py-3">
          <span className={cx("size-2.5 rounded-full", open ? "bg-[var(--ok)] shadow-[0_0_10px_var(--ok)]" : "bg-[var(--warn)]")} aria-hidden />
          <h2 className="font-serif text-[19px] tracking-wide">The forex market is {open ? "open" : "closed"}</h2>
          {nextChange && <span className="num text-[13px] text-muted">{open ? "closes" : "reopens"} {new Date(nextChange).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} · in {countdown(nextChange - now)}</span>}
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
                <p className={cx("mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px]", s.open_now ? "border-[color-mix(in_srgb,var(--ok)_45%,transparent)] text-ok" : "border-line text-muted")}>
                  <span className={cx("size-1.5 rounded-full", s.open_now ? "bg-[var(--ok)]" : "bg-[var(--faint)]")} aria-hidden />{s.open_now ? "Open" : "Closed"} · <span className="num">{until}</span>
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="mb-1 font-serif text-[17px] tracking-wide">Today's sessions in your time</h2>
        <p className="mb-4 text-[12.5px] text-muted">{local.date} · {tz}. Shaded bands mark overlaps, when two centres trade at once. The red line is now.</p>
        <div className="relative">
          <div className="relative ml-24 mb-1 h-4 text-[10.5px] text-faint">
            {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => <span key={h} className="num absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>{two(h)}:00</span>)}
          </div>
          {sessions.map((s) => (
            <div key={s.name} className="flex items-center gap-3 py-1.5">
              <span className="w-21 shrink-0 font-serif text-[14px]">{s.name}</span>
              <div className="relative h-7 flex-1 rounded-md border border-line bg-surface-2">
                {[3, 6, 9, 12, 15, 18, 21].map((h) => <span key={h} className="absolute inset-y-0 w-px bg-[var(--border)]" style={{ left: `${(h / 24) * 100}%` }} aria-hidden />)}
                {s.windows.map((w, i) => {
                  const a = pct(w.start), b = pct(w.end);
                  const live = s.open_now && w.start === s.current?.start;
                  return b > a && (
                    <span key={i} className={cx("absolute inset-y-1 flex items-center overflow-hidden rounded px-1.5 text-[10.5px] font-medium", live ? "bg-accent text-white" : "bg-accent/30 text-fg")} style={{ left: `${a}%`, width: `${b - a}%` }}>
                      <span className="num truncate">{fmt(w.start)}–{fmt(w.end)}</span>
                    </span>
                  );
                })}
                <span className="absolute -inset-y-1 w-0.5 rounded bg-[var(--danger)]" style={{ left: `${nowPct}%` }} aria-hidden />
              </div>
            </div>
          ))}
          <div className="flex items-center gap-3 py-1.5">
            <span className="w-21 shrink-0 font-serif text-[14px] text-muted">Overlaps</span>
            <div className="relative h-7 flex-1 rounded-md border border-dashed border-line">
              {overlaps.map((o, i) => (
                <span key={i} title={`${o.name}: ${fmt(o.start)}–${fmt(o.end)}`} className="absolute inset-y-1 overflow-hidden rounded bg-[color-mix(in_srgb,var(--warn)_35%,transparent)] px-1.5 text-[10.5px] text-fg"
                  style={{ left: `${pct(o.start)}%`, width: `${pct(o.end) - pct(o.start)}%` }}><span className="truncate">{o.name}</span></span>
              ))}
              <span className="absolute -inset-y-1 w-0.5 rounded bg-[var(--danger)]" style={{ left: `${nowPct}%` }} aria-hidden />
            </div>
          </div>
        </div>
      </section>

      <section className="panel overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-faint">
            <tr><th className="px-4 py-2.5">Centre</th><th className="px-4 py-2.5">Local hours</th><th className="px-4 py-2.5">In your time</th><th className="px-4 py-2.5">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {sessions.map((s) => {
              const w = s.current ?? s.next;
              return (
                <tr key={s.name}>
                  <td className="px-4 py-2.5 font-serif text-[14px]">{s.name}</td>
                  <td className="num px-4 py-2.5">{s.open}–{s.close} <span className="text-faint">({s.tz})</span></td>
                  <td className="num px-4 py-2.5">{w ? `${fmt(w.start)}–${fmt(w.end)}` : "—"}</td>
                  <td className={cx("px-4 py-2.5", s.open_now ? "text-ok" : "text-muted")}>{s.open_now ? "Open" : "Closed"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-line px-4 py-2 text-[12px] text-faint">Session hours are each centre's usual business hours and follow its own daylight-saving rules. The forex market as a whole trades from Sunday 17:00 to Friday 17:00 New York time.</p>
      </section>
    </div>
  );
}
