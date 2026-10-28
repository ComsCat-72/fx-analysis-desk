"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Calculator, CalendarRange, Clock3, CircleHelp, FlaskConical, Globe2, KeyRound, Landmark, Lock, Moon, Newspaper, Settings2, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import { Guide } from "./Guide";
import { useNow } from "./api";
import { CalendarView } from "./CalendarView";
import { Calculators } from "../calc/Calculators";
import { MarketHours } from "../hours/MarketHours";
import { SettingsDrawer } from "./Settings";
import { Markets } from "../markets/Markets";
import { CentralBanks } from "../banks/CentralBanks";
import { News } from "../news/News";
import { Badge, Button, Spinner, cx, inputCls } from "./ui";

function todayIn(tz: string) {
  // formatToParts: "en-CA" does not give YYYY-MM-DD in every browser.
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
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

type View = "calendar" | "markets" | "banks" | "news" | "calculators" | "hours";
const VIEWS: { id: View; label: string; icon: typeof Calculator }[] = [
  { id: "calendar", label: "Calendar", icon: CalendarRange }, { id: "markets", label: "Markets", icon: Activity }, { id: "banks", label: "Central banks", icon: Landmark },
  { id: "news", label: "News", icon: Newspaper }, { id: "calculators", label: "Calculators", icon: Calculator }, { id: "hours", label: "Market hours", icon: Clock3 },
];
/** The current page lives in the URL hash so links and the back button work. The calendar is the home page. */
function useView(): [View, (v: View) => void] {
  const read = (): View => { const h = typeof window === "undefined" ? "" : window.location.hash.slice(1); return VIEWS.some((v) => v.id === h) ? h as View : "calendar"; };
  const [view, setView] = useState<View>("calendar");
  useEffect(() => { setView(read()); const h = () => setView(read()); window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, []);
  return [view, (v) => { window.location.hash = v === "calendar" ? "" : v; setView(v); }];
}

export default function App() {
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
  const [settings, setSettings] = useState(false);
  const [guide, setGuide] = useState(false);
  useEffect(() => { try { if (!localStorage.getItem("fx.guideSeen2")) setGuide(true); } catch { /* storage unavailable */ } }, []);
  const closeGuide = () => { setGuide(false); try { localStorage.setItem("fx.guideSeen2", "1"); } catch { /* storage unavailable */ } };
  const [theme, setTheme] = useState<"dark" | "light">(() => { try { return (localStorage.getItem("fx.theme") as "dark" | "light") ?? "dark"; } catch { return "dark"; } });

  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("fx.theme", theme); } catch { /* storage unavailable */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem("fx.instrument", instrument); } catch { /* storage unavailable */ } }, [instrument]);
  const inst = cfg.data?.instruments.find((i) => i.code === instrument);

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

  return (
    <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col gap-3 px-4 pb-8 pt-3 sm:px-5">
      <header className="panel topbar flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="brand-mark grid size-9 place-items-center rounded-xl text-white" aria-hidden>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-6 4 3 5-7 4 4" /><path d="M3 21h18" /></svg>
          </div>
          <div className="leading-tight">
            <h1 className="text-[15.5px] font-semibold tracking-tight">FX Analysis Desk</h1>
            <p className="text-[11.5px] text-faint">Market data and tools · not trading advice</p>
          </div>
        </div>
        <nav className="flex min-w-0 max-w-full overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5" aria-label="Pages">
          {VIEWS.map((v) => (
            <button key={v.id} onClick={() => setView(v.id)} aria-current={view === v.id ? "page" : undefined}
              title={v.label} className={cx("inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors max-lg:px-2.5",
                view === v.id ? "bg-accent-soft text-fg" : "text-muted hover:text-fg")}>
              <v.icon className="size-4" aria-hidden /><span className="max-lg:sr-only">{v.label}</span>
            </button>
          ))}
        </nav>
        {view === "calendar" && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <label className="sr-only" htmlFor="inst">Instrument</label>
            <select id="inst" value={instrument} onChange={(e) => setInstrument(e.target.value)} title="Up next and the Filter's quick picks follow this instrument's currencies"
              className={cx(inputCls, "num h-10 min-w-0 flex-1 cursor-pointer text-[14px] font-semibold sm:w-44 sm:flex-none")}>
              {cfg.data!.instruments.map((i) => <option key={i.code} value={i.code}>{i.display}</option>)}
            </select>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
          {cfg.data!.app_env !== "production" && <Badge tone="fixture" title="Development environment"><FlaskConical className="size-3" />Development</Badge>}
          <LiveClock tz={tz} label={cfg.data!.display.timezone_label} />
          <Button variant="ghost" size="sm" onClick={() => setGuide(true)} title="How the desk works"><CircleHelp className="size-4" aria-hidden /><span className="hidden md:inline">How it works</span></Button>
          <Button variant="ghost" size="sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}<span className="sr-only">Toggle theme</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setNeedToken(true)} title="Admin token"><KeyRound className="size-4" /><span className="sr-only">Admin token</span></Button>
          <Button size="sm" onClick={() => setSettings(true)}><Settings2 className="size-4" aria-hidden />Configure</Button>
        </div>
      </header>

      {view === "calendar" && <CalendarView today={todayIn(tz)} instrumentCurrencies={inst ? [inst.base, inst.quote].filter((c) => /^[A-Z]{3}$/.test(c) && !["XAU", "NAS", "BAS"].includes(c)) : []} />}
      {view === "markets" && <Markets />}
      {view === "banks" && <CentralBanks />}
      {view === "news" && <News />}
      {view === "calculators" && <Calculators />}
      {view === "hours" && <MarketHours />}
      <footer className="pt-1 text-center text-[12px] text-faint">
        Market data and tools from free public sources. Nothing here recommends buying, selling or positioning in any market.
      </footer>
      {tokenDialog}
      <Guide open={guide} onClose={closeGuide} />
      <SettingsDrawer open={settings} onClose={() => setSettings(false)} config={cfg.data!} />
    </div>
  );
}
