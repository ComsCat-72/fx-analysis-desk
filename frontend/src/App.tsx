import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, FlaskConical, KeyRound, Lock, Moon, Settings2, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, getToken, setToken, type Kind, type VersionSummary, type Week } from "./api";
import { ReportPane } from "./components/ReportPane";
import { SettingsDrawer } from "./components/Settings";
import { CalendarPanel, EvaluationPanel, EvidencePanel, FreshnessBar, LevelsPanel, ScreenshotPanel } from "./components/SidePanels";
import { Timeline } from "./components/Timeline";
import { Badge, Button, Spinner, cx, inputCls } from "./ui";

export const iso = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(s: string, n: number) { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
export function mondayOf(s: string) { const d = new Date(s + "T12:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; return addDays(s, -wd); }
function todayIn(tz: string) { return new Date().toLocaleDateString("en-CA", { timeZone: tz }); }

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

export function slotVersions(week: Week | undefined, kind: Kind, day: string, reviewDay: string | null): { versions: VersionSummary[]; period: string } {
  if (!week) return { versions: [], period: day };
  if (kind === "weekly_analysis") return { versions: week.weekly_analysis, period: week.week_key };
  if (kind === "weekly_review") return { versions: week.weekly_review, period: week.week_key };
  if (kind === "daily_analysis") return { versions: week.days.find((d) => d.date === day)?.daily_analysis ?? [], period: day };
  // Previous-day review: an explicitly chosen session, else the trading day before the selected day.
  const idx = week.days.findIndex((d) => d.date === day);
  const target = reviewDay ?? (idx > 0 ? week.days[idx - 1].date : week.days[0]?.date ?? day);
  return { versions: week.days.find((d) => d.date === target)?.daily_review ?? [], period: target };
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

export default function App() {
  const qc = useQueryClient();
  const [needToken, setNeedToken] = useState(false);
  useEffect(() => {
    const h = () => setNeedToken(true);
    window.addEventListener("fx:auth-required", h);
    return () => window.removeEventListener("fx:auth-required", h);
  }, []);
  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config });
  const tz = cfg.data?.display.timezone ?? "Africa/Kampala";
  const [instrument, setInstrument] = useState<string>(() => localStorage.getItem("fx.instrument") ?? "GBP_USD");
  const [weekKey, setWeekKey] = useState(() => mondayOf(todayIn("Africa/Kampala")));
  const [day, setDay] = useState(() => todayIn("Africa/Kampala"));
  const [tab, setTab] = useState<Kind>("daily_analysis");
  const [reviewDay, setReviewDay] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [focusCite, setFocusCite] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem("fx.theme") as "dark" | "light") ?? "dark");

  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("fx.theme", theme); } catch { /* storage unavailable */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem("fx.instrument", instrument); } catch { /* storage unavailable */ } }, [instrument]);

  const week = useQuery({ queryKey: ["week", instrument, weekKey], queryFn: () => api.week(instrument, weekKey) });
  const days = week.data?.days.map((d) => d.date) ?? [];
  const selDay = days.includes(day) ? day : days.find((d) => d === todayIn(tz)) ?? days[0] ?? weekKey;
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
  if (cfg.error) return <div className="p-6 text-danger">Cannot reach the API: {String(cfg.error)}</div>;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1760px] flex-col gap-3 px-4 pb-6 pt-3 sm:px-5">
      <header className="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 17l5-6 4 3 5-7 4 4" /><path d="M3 21h18" /></svg>
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">FX Analysis Desk</div>
            <div className="text-[11.5px] text-faint">Analysis and reporting · not trading advice</div>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="sr-only" htmlFor="inst">Instrument</label>
          <select id="inst" value={instrument} onChange={(e) => { setInstrument(e.target.value); setVersionId(null); }}
            className={cx(inputCls, "num min-w-0 flex-1 cursor-pointer font-medium sm:w-44 sm:flex-none")}>
            {cfg.data!.instruments.map((i) => <option key={i.code} value={i.code}>{i.display}</option>)}
          </select>
          <div className="flex items-center rounded-lg border border-line bg-surface-2">
            <button className="grid size-9 cursor-pointer place-items-center text-muted hover:text-fg" onClick={() => shiftWeek(-1)} aria-label="Previous week"><ChevronLeft className="size-4" /></button>
            <label className="flex items-center gap-1.5 px-1 text-sm">
              <CalendarDays className="size-4 text-muted" aria-hidden />
              <span className="sr-only">Week of</span>
              <input type="date" value={weekKey} onChange={(e) => e.target.value && (setWeekKey(mondayOf(e.target.value)), setDay(mondayOf(e.target.value)), setVersionId(null))}
                className="num w-[8.6rem] cursor-pointer bg-transparent text-fg focus:outline-none" />
            </label>
            <button className="grid size-9 cursor-pointer place-items-center text-muted hover:text-fg" onClick={() => shiftWeek(1)} aria-label="Next week"><ChevronRight className="size-4" /></button>
          </div>
        </div>
        {inst?.label && <span className="hidden text-[12px] text-faint xl:inline">{inst.label}</span>}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {cfg.data!.app_env !== "production" && <Badge tone="fixture" title="Development environment"><FlaskConical className="size-3" />Development</Badge>}
          <Badge tone={cfg.data!.publication_mode === "automatic" ? "warn" : "neutral"}>
            {cfg.data!.publication_mode === "automatic" ? "Auto-publish ON" : "Manual publication"}
          </Badge>
          <span className="hidden text-[12px] text-muted sm:inline">Times in {cfg.data!.display.timezone_label} ({tz})</span>
          <Button variant="ghost" size="sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}<span className="sr-only">Toggle theme</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setNeedToken(true)} title="Admin token"><KeyRound className="size-4" /><span className="sr-only">Admin token</span></Button>
          <Button size="sm" onClick={() => setSettings(true)}><Settings2 className="size-4" aria-hidden />Configure</Button>
        </div>
      </header>

      <FreshnessBar instrument={instrument} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[270px_minmax(0,1fr)_420px]">
        <div className="order-2 flex flex-col gap-3 lg:order-none">
          {week.isLoading ? <Spinner /> : <Timeline week={week.data!} tab={tab} day={selDay} reviewDay={slot.period} onSelect={select} />}
        </div>
        <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-none">
          <ReportPane key={`${instrument}-${tab}-${slot.period}`} instrument={instrument} tab={tab} onTab={(k) => select(k)}
            period={slot.period} versions={slot.versions} versionId={current} onVersion={setVersionId}
            onCite={setFocusCite} credentials={cfg.data!.credentials} defaultWriter={cfg.data!.writer} weekKey={weekKey} />
          <div className="grid gap-3 lg:grid-cols-2 2xl:hidden">
            <EvidencePanel versionId={current} focus={focusCite} />
            <CalendarPanel instrument={instrument} weekKey={weekKey} />
          </div>
        </div>
        <aside className="order-3 flex min-w-0 flex-col gap-3 lg:order-none lg:col-span-2 2xl:col-span-1">
          <div className="hidden flex-col gap-3 2xl:flex">
            <EvidencePanel versionId={current} focus={focusCite} />
            <CalendarPanel instrument={instrument} weekKey={weekKey} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-1">
            <LevelsPanel instrument={instrument} decimals={inst?.decimals ?? 5} />
            <EvaluationPanel instrument={instrument} />
          </div>
          <ScreenshotPanel instrument={instrument} />
        </aside>
      </div>
      {tokenDialog}
      <SettingsDrawer open={settings} onClose={() => setSettings(false)} config={cfg.data!} instrument={instrument} />
    </div>
  );
}
