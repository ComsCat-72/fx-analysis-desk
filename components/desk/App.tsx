"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, CalendarDays, CalendarRange, Clock3, ChevronLeft, ChevronRight, CircleHelp, LayoutDashboard, FlaskConical, Globe2, KeyRound, Lock, Moon, Settings2, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, getToken, setToken, type Kind, type SlotState, type VersionSummary, type Week } from "./api";
import { Guide } from "./Guide";
import { useNow } from "./api";
import { CalendarView } from "./CalendarView";
import { Calculators } from "../calc/Calculators";
import { MarketHours } from "../hours/MarketHours";
import { ReportPane } from "./ReportPane";
import { SettingsDrawer } from "./Settings";
import { ContextPanel, type ContextTab } from "./Context";
import { Overview } from "./Overview";
import { SystemAlerts } from "./SidePanels";
import { Timeline } from "./Timeline";
import { Badge, Button, Spinner, cx, inputCls } from "./ui";

export const iso = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(s: string, n: number) { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
export function mondayOf(s: string) { const d = new Date(s + "T12:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; return addDays(s, -wd); }
function todayIn(tz: string) {
  // formatToParts: "en-CA" does not give YYYY-MM-DD in every browser.
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export const TABS: { kind: Kind; label: string }[] = [
  { kind: "weekly_analysis", label: "Weekly analysis" },
  { kind: "daily_analysis", label: "Daily analysis" },
  { kind: "daily_review", label: "Previous-day review" },
  { kind: "weekly_review", label: "Weekly review" },
];

export function pickVersion(vs: VersionSummary[] | undefined): VersionSummary | undefined {
  if (!vs?.length) return undefined;
  const pub = vs.filter((v) => v.status === "published");
  const drafts = vs.filter((v) => v.status === "draft");
  return drafts.length && (!pub.length || drafts[drafts.length - 1].version > pub[pub.length - 1].version)
    ? drafts[drafts.length - 1] : pub[pub.length - 1] ?? vs[vs.length - 1];
}

export function slotVersions(week: Week | undefined, kind: Kind, day: string, reviewDay: string | null): { versions: VersionSummary[]; period: string; slot?: SlotState } {
  if (!week) return { versions: [], period: day };
  if (kind === "weekly_analysis") return { versions: week.weekly_analysis, period: week.week_key, slot: week.slots?.weekly_analysis };
  if (kind === "weekly_review") return { versions: week.weekly_review, period: week.week_key, slot: week.slots?.weekly_review };
  if (kind === "daily_analysis") { const d = week.days.find((x) => x.date === day); return { versions: d?.daily_analysis ?? [], period: day, slot: d?.slots?.daily_analysis }; }
  // Previous-day review: an explicitly chosen session, else the trading day before the selected day.
  const idx = week.days.findIndex((d) => d.date === day);
  const target = reviewDay ?? (idx > 0 ? week.days[idx - 1].date : week.days[0]?.date ?? day);
  const d = week.days.find((x) => x.date === target);
  return { versions: d?.daily_review ?? [], period: target, slot: d?.slots?.daily_review };
}

function TokenDialog({ onDone }: { onDone: () => void }) {
  const [t, setT] = useState(getToken());
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal aria-label="Admin token">
      <form className="panel w-full max-w-sm space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); setToken(t.trim()); onDone(); }}>
        <h2 className="flex items-center gap-2 font-semibold"><Lock className="size-4 text-accent" />Admin token required</h2>
        <p className="text-[13px] text-muted">This deployment is protected. Enter the ADMIN_TOKEN configured on the server. It is kept in this browser only.</p>
        <input autoFocus type="password" value={t} onChange={(e) => setT(e.target.value)} className={cx(inputCls, "w-full")} aria-label="Admin token" />
        <div className="flex justify-end"><Button variant="primary" type="submit">Unlock</Button></div>
      </form>
    </div>
  );
}

/** The browser's current time in its own zone, ticking every second. All times on the dashboard use this zone. */
function LiveClock({ tz, label }: { tz: string; label: string }) {
  const now = useNow(1000);
  const t = new Date(now).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const d = new Date(now).toLocaleDateString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
  return (
    <Badge title={`Your browser's time and timezone (${tz}). Every time on the dashboard is shown in it.`}>
      <Globe2 className="size-3" /><span className="num" suppressHydrationWarning>{d} {t}</span> {label}
    </Badge>
  );
}

/** True when the viewport is wide enough for the three-column layout (Tailwind's 2xl). */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1536px)");
    const h = () => setWide(m.matches);
    h(); m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, []);
  return wide;
}

type View = "desk" | "calendar" | "calculators" | "hours";
const VIEWS: { id: View; label: string; icon: typeof Calculator }[] = [
  { id: "desk", label: "Desk", icon: LayoutDashboard }, { id: "calendar", label: "Calendar", icon: CalendarRange }, { id: "calculators", label: "Calculators", icon: Calculator },
  { id: "hours", label: "Market hours", icon: Clock3 },
];
/** The current page lives in the URL hash so links and the back button work. */
function useView(): [View, (v: View) => void] {
  const read = (): View => { const h = typeof window === "undefined" ? "" : window.location.hash.slice(1); return h === "calendar" || h === "calculators" || h === "hours" ? h : "desk"; };
  const [view, setView] = useState<View>("desk");
  useEffect(() => { setView(read()); const h = () => setView(read()); window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, []);
  return [view, (v) => { window.location.hash = v === "desk" ? "" : v; setView(v); }];
}

export default function App() {
  const wide = useWide();
  const [view, setView] = useView();
  const qc = useQueryClient();
  const [needToken, setNeedToken] = useState(false);
  useEffect(() => {
    const h = () => setNeedToken(true);
    window.addEventListener("fx:auth-required", h);
    return () => window.removeEventListener("fx:auth-required", h);
  }, []);
  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config });
  const tz = cfg.data?.display.timezone ?? "Africa/Kampala";
  const [instrument, setInstrument] = useState<string>(() => { try { return localStorage.getItem("fx.instrument") ?? "GBP_USD"; } catch { return "GBP_USD"; } });
  const [weekKey, setWeekKey] = useState(() => mondayOf(todayIn(tz)));
  const [day, setDay] = useState(() => todayIn(tz));
  const [tab, setTab] = useState<Kind>("daily_analysis");
  const [reviewDay, setReviewDay] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [focusCite, setFocusCite] = useState<string | null>(null);
  const [ctxTab, setCtxTab] = useState<ContextTab>("evidence");
  const cite = (id: string) => { setFocusCite(id); setCtxTab("evidence"); };
  const [settings, setSettings] = useState(false);
  const [guide, setGuide] = useState(false);
  useEffect(() => { try { if (!localStorage.getItem("fx.guideSeen")) setGuide(true); } catch { /* storage unavailable */ } }, []);
  const closeGuide = () => { setGuide(false); try { localStorage.setItem("fx.guideSeen", "1"); } catch { /* storage unavailable */ } };
  const [theme, setTheme] = useState<"dark" | "light">(() => { try { return (localStorage.getItem("fx.theme") as "dark" | "light") ?? "dark"; } catch { return "dark"; } });

  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("fx.theme", theme); } catch { /* storage unavailable */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem("fx.instrument", instrument); } catch { /* storage unavailable */ } }, [instrument]);

  // Refetched every minute so slot states ("Opens…", "Closed", Next) follow the clock.
  const week = useQuery({ queryKey: ["week", instrument, weekKey], queryFn: () => api.week(instrument, weekKey), refetchInterval: 60_000 });
  const days = week.data?.days.map((d) => d.date) ?? [];
  // While the week is (re)loading keep the chosen day, so an action never targets a fallback slot.
  const selDay = !days.length || days.includes(day) ? day : days.find((d) => d === todayIn(tz)) ?? days[0];
  const slot = useMemo(() => slotVersions(week.data, tab, selDay, reviewDay), [week.data, tab, selDay, reviewDay]);
  const current = versionId ?? pickVersion(slot.versions)?.id ?? null;
  const inst = cfg.data?.instruments.find((i) => i.code === instrument);

  const select = (k: Kind, d?: string, review?: string) => {
    setTab(k); if (d) setDay(d); setReviewDay(review ?? null); setVersionId(null); setFocusCite(null);
  };
  const shiftWeek = (n: number) => { const w = addDays(weekKey, 7 * n); setWeekKey(w); setDay(w); setReviewDay(null); setVersionId(null); };

  const tokenDialog = needToken && <TokenDialog onDone={() => { setNeedToken(false); qc.invalidateQueries(); }} />;
  if (cfg.isLoading) return <>{tokenDialog}<Spinner label="Loading configuration" /></>;
  if (cfg.error && needToken) return <>{tokenDialog}</>;
  if (cfg.error) return (
    <div className="mx-auto max-w-3xl space-y-3 p-6">
      <h1 className="text-lg font-semibold text-danger">The API is not responding correctly</h1>
      <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface p-3 font-mono text-[13px] text-fg">{(cfg.error as Error).message || String(cfg.error)}</pre>
      <p className="text-sm text-muted">Open <a className="text-accent underline" href="/api/health">/api/health</a> for the server's start-up status. Nothing above contains secrets.</p>
    </div>
  );

  const context = (
    <ContextPanel tab={ctxTab} onTab={setCtxTab} instrument={instrument} weekKey={weekKey} versionId={current} focus={focusCite}
      decimals={inst?.decimals ?? 5} canExtract={!!cfg.data!.credentials.anthropic} />
  );
  return (
    <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col gap-3 px-4 pb-8 pt-3 sm:px-5">
      <header className="panel topbar flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="brand-mark grid size-9 place-items-center rounded-xl text-white" aria-hidden>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-6 4 3 5-7 4 4" /><path d="M3 21h18" /></svg>
          </div>
          <div className="leading-tight">
            <h1 className="text-[15.5px] font-semibold tracking-tight">FX Analysis Desk</h1>
            <p className="text-[11.5px] text-faint">Analysis and reporting · not trading advice</p>
          </div>
        </div>
        <nav className="flex rounded-lg border border-line bg-surface-2 p-0.5" aria-label="Pages">
          {VIEWS.map((v) => (
            <button key={v.id} onClick={() => setView(v.id)} aria-current={view === v.id ? "page" : undefined}
              title={v.label} className={cx("inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors max-sm:px-3.5",
                view === v.id ? "bg-accent-soft text-fg" : "text-muted hover:text-fg")}>
              <v.icon className="size-4" aria-hidden /><span className="max-sm:sr-only">{v.label}</span>
            </button>
          ))}
        </nav>
        <div className={cx("w-full flex-wrap items-center gap-2 sm:w-auto", view === "calculators" || view === "hours" ? "hidden" : "flex")}>
          <label className="sr-only" htmlFor="inst">Instrument</label>
          <select id="inst" value={instrument} onChange={(e) => { setInstrument(e.target.value); setVersionId(null); setFocusCite(null); }}
            className={cx(inputCls, "num h-10 min-w-0 flex-1 cursor-pointer text-[14px] font-semibold sm:w-44 sm:flex-none")}>
            {cfg.data!.instruments.map((i) => <option key={i.code} value={i.code}>{i.display}</option>)}
          </select>
          <div className={cx("h-10 items-center rounded-lg border border-line bg-surface-2", view === "desk" ? "flex" : "hidden")}>
            <button className="grid size-10 cursor-pointer place-items-center rounded-l-lg text-muted hover:bg-surface-3 hover:text-fg" onClick={() => shiftWeek(-1)} aria-label="Previous week"><ChevronLeft className="size-4" /></button>
            <label className="flex items-center gap-1.5 px-1 text-sm">
              <CalendarDays className="size-4 text-muted" aria-hidden />
              <span className="sr-only">Week of</span>
              <input type="date" value={weekKey} onChange={(e) => e.target.value && (setWeekKey(mondayOf(e.target.value)), setDay(mondayOf(e.target.value)), setVersionId(null))}
                className="num w-[8.6rem] cursor-pointer bg-transparent text-fg focus:outline-none" />
            </label>
            <button className="grid size-10 cursor-pointer place-items-center rounded-r-lg text-muted hover:bg-surface-3 hover:text-fg" onClick={() => shiftWeek(1)} aria-label="Next week"><ChevronRight className="size-4" /></button>
          </div>
        </div>
        {inst?.label && <span className="hidden max-w-[34ch] truncate text-[12px] text-faint 2xl:inline" title={inst.label}>{inst.label}</span>}
        <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
          {cfg.data!.app_env !== "production" && <Badge tone="fixture" title="Development environment"><FlaskConical className="size-3" />Development</Badge>}
          <Badge tone={cfg.data!.publication_mode === "automatic" ? "warn" : "neutral"} title="Change in Configure">
            {cfg.data!.publication_mode === "automatic" ? "Auto-publish on" : "Manual publication"}
          </Badge>
          <LiveClock tz={tz} label={cfg.data!.display.timezone_label} />
          <Button variant="ghost" size="sm" onClick={() => setGuide(true)} title="How the desk works"><CircleHelp className="size-4" aria-hidden /><span className="hidden md:inline">How it works</span></Button>
          <Button variant="ghost" size="sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}<span className="sr-only">Toggle theme</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setNeedToken(true)} title="Admin token"><KeyRound className="size-4" /><span className="sr-only">Admin token</span></Button>
          <Button size="sm" onClick={() => setSettings(true)}><Settings2 className="size-4" aria-hidden />Configure</Button>
        </div>
      </header>

      <SystemAlerts />
      {view === "calendar" && <CalendarView today={todayIn(tz)} instrumentCurrencies={inst ? [inst.base, inst.quote].filter((c) => /^[A-Z]{3}$/.test(c) && !["XAU", "NAS", "BAS"].includes(c)) : []} />}
      {view === "calculators" && <Calculators />}
      {view === "hours" && <MarketHours />}
      {view === "desk" && <>
      <Overview instrument={instrument} week={week.data} day={selDay} weekKey={weekKey} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[264px_minmax(0,1fr)] 2xl:grid-cols-[264px_minmax(0,1fr)_440px]">
        <div className="order-2 flex flex-col gap-3 lg:order-none">
          {week.isLoading ? <Spinner /> : week.data ? <Timeline week={week.data} tab={tab} day={selDay} reviewDay={slot.period} onSelect={select} />
            : <div className="panel p-4 text-sm text-danger">Could not load this week: {String((week.error as Error)?.message ?? "")}</div>}
        </div>
        <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-none">
          <ReportPane key={`${instrument}-${tab}-${slot.period}`} instrument={instrument} tab={tab} onTab={(k) => select(k)}
            period={slot.period} versions={slot.versions} versionId={current} onVersion={setVersionId} slot={slot.slot} onGo={select}
            hasWeekly={!!week.data?.weekly_analysis.some((v) => v.status === "published")} dayName={week.data?.days.find((d) => d.date === slot.period)?.day ?? null}
            onCite={cite} credentials={cfg.data!.credentials} defaultWriter={cfg.data!.writer} weekKey={weekKey} />
          {!wide && context}
        </div>
        {wide && <aside className="min-w-0"><div className="sticky top-3">{context}</div></aside>}
      </div>
      </>}
      <footer className="pt-1 text-center text-[12px] text-faint">
        Reports explain market behaviour from sourced evidence. They do not recommend buying, selling or positioning in any market.
      </footer>
      {tokenDialog}
      <Guide open={guide} onClose={closeGuide} schedules={Object.values(cfg.data!.schedules).map(String)} autoPublish={cfg.data!.publication_mode === "automatic"} />
      <SettingsDrawer open={settings} onClose={() => setSettings(false)} config={cfg.data!} instrument={instrument} />
    </div>
  );
}
