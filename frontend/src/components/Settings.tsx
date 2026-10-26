import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Database, KeyRound, Newspaper, Timer, X, XCircle } from "lucide-react";
import { useState } from "react";
import { api, type AppConfig } from "../api";
import { Badge, Button, Field, cx, inputCls } from "../ui";

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 border-b border-line px-5 py-4">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.07em] text-muted">{icon}{title}</h3>
      {children}
    </section>
  );
}

export function SettingsDrawer({ open, onClose, config, instrument }: { open: boolean; onClose: () => void; config: AppConfig; instrument: string }) {
  const qc = useQueryClient();
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: api.jobs, enabled: open });
  const [confirmAuto, setConfirmAuto] = useState(false);
  const mode = useMutation({ mutationFn: (m: string) => api.setMode(m, confirmAuto), onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] }) });
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState({ start: new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), end: today });
  const ingest = useMutation({ mutationFn: () => api.ingest(instrument, range.start, range.end), onSuccess: () => qc.invalidateQueries() });
  const [news, setNews] = useState({ source_name: "", title: "", url: "", published_at: "", currencies: "" });
  const addNews = useMutation({
    mutationFn: () => api.addNews({ ...news, published_at: new Date(news.published_at).toISOString(), currencies: news.currencies.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) }),
    onSuccess: () => setNews({ source_name: "", title: "", url: "", published_at: "", currencies: "" }),
  });
  const cred = (k: string, label: string, needed: string) => (
    <li className="flex items-center gap-2 text-[13px]">
      {config.credentials[k] ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-faint" />}
      <span>{label}</span><span className="ml-auto text-[12px] text-faint">{config.credentials[k] ? "configured" : needed}</span>
    </li>
  );
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-30 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside role="dialog" aria-modal aria-label="Configuration" className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[460px] flex-col border-l border-line bg-surface"
            initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.22, ease: "easeOut" }}>
            <header className="flex items-center border-b border-line px-5 py-3.5">
              <h2 className="font-semibold">Configure providers and schedules</h2>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}><X className="size-4" /><span className="sr-only">Close</span></Button>
            </header>
            <div className="flex-1 overflow-y-auto">
              <Section title="Publication mode" icon={<Timer className="size-4" />}>
                <div className="flex gap-2">
                  {(["manual", "automatic"] as const).map((m) => (
                    <button key={m} onClick={() => mode.mutate(m)} className={cx("flex-1 cursor-pointer rounded-lg border px-3 py-2 text-left text-[13px]",
                      config.publication_mode === m ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-3")}>
                      <div className="font-medium">{m === "manual" ? "Drafts, manual publication" : "Automatic publication"}</div>
                      <div className="text-[12px] text-faint">{m === "manual" ? "Scheduled jobs create drafts only." : "Drafts that pass every check are published."}</div>
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" checked={confirmAuto} onChange={(e) => setConfirmAuto(e.target.checked)} />I explicitly enable automatic publication</label>
                {mode.error && <p className="text-[12px] text-danger">{String(mode.error)}</p>}
              </Section>
              <Section title="Credentials" icon={<KeyRound className="size-4" />}>
                <ul className="space-y-1.5">
                  {cred("oanda", "OANDA prices (spot mid)", "set OANDA_API_TOKEN")}
                  {cred("oanda_account", "OANDA live quotes", "set OANDA_ACCOUNT_ID")}
                  {cred("anthropic", "Claude report writer and review", "set ANTHROPIC_API_KEY")}
                  {cred("fred", "FRED bond yields", "set FRED_API_KEY")}
                </ul>
                <p className="text-[12px] text-faint">Secrets live in <code>.env</code>, never in the database or UI. Provider choice is in <code>config/app.yaml</code>.</p>
                <div className="flex flex-wrap gap-1.5 text-[12px]">
                  <Badge>Prices: {String(config.providers.prices)}</Badge>
                  <Badge>Calendar: {String((config.providers.calendar as { primary: string }).primary)}</Badge>
                  <Badge>News: {String((config.providers.news as { primary: string }).primary)}</Badge>
                </div>
              </Section>
              <Section title={`Ingest prices · ${instrument}`} icon={<Database className="size-4" />}>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="From"><input type="date" className={inputCls} value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} /></Field>
                  <Field label="To"><input type="date" className={inputCls} value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} /></Field>
                </div>
                {ingest.error && <p className="text-[12px] text-danger">{String(ingest.error)}</p>}
                {ingest.data != null && <p className="text-[12px] text-ok">Stored: {JSON.stringify(ingest.data)}</p>}
                <Button size="sm" busy={ingest.isPending} onClick={() => ingest.mutate()}>Fetch 1H candles and rebuild daily/weekly</Button>
              </Section>
              <Section title="Add a headline (manual source)" icon={<Newspaper className="size-4" />}>
                <p className="text-[12px] text-faint">Reuters and WSJ need a licence for automated access. Enter headlines you have read, with a link; they are labelled user-entered.</p>
                <form className="grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); addNews.mutate(); }}>
                  <Field label="Source"><input className={inputCls} required value={news.source_name} onChange={(e) => setNews({ ...news, source_name: e.target.value })} placeholder="Reuters" /></Field>
                  <Field label="Published (your local time)"><input type="datetime-local" required className={inputCls} value={news.published_at} onChange={(e) => setNews({ ...news, published_at: e.target.value })} /></Field>
                  <div className="col-span-2"><Field label="Headline"><input className={inputCls} required value={news.title} onChange={(e) => setNews({ ...news, title: e.target.value })} /></Field></div>
                  <Field label="URL"><input className={inputCls} value={news.url} onChange={(e) => setNews({ ...news, url: e.target.value })} /></Field>
                  <Field label="Currencies"><input className={inputCls} value={news.currencies} onChange={(e) => setNews({ ...news, currencies: e.target.value })} placeholder="GBP, USD" /></Field>
                  {addNews.error && <p className="col-span-2 text-[12px] text-danger">{String(addNews.error)}</p>}
                  {addNews.isSuccess && <p className="col-span-2 text-[12px] text-ok">Headline stored.</p>}
                  <div className="col-span-2"><Button size="sm" type="submit" busy={addNews.isPending}>Save headline</Button></div>
                </form>
              </Section>
              <Section title="Schedules (EAT)" icon={<Timer className="size-4" />}>
                <ul className="space-y-1 text-[13px]">
                  {["weekly_analysis", "daily_analysis", "daily_review", "weekly_review"].map((k) => (
                    <li key={k} className="flex justify-between"><span className="text-muted">{k.replace("_", " ")}</span><code className="num text-faint">{String(config.schedules[k])}</code></li>
                  ))}
                </ul>
                <h4 className="pt-2 text-[12px] font-semibold uppercase tracking-wider text-faint">Recent jobs</h4>
                <ul className="space-y-1 text-[12.5px]">
                  {(jobs.data ?? []).slice(0, 10).map((j, i) => (
                    <li key={i} className="flex items-center gap-2"><Badge tone={j.status === "succeeded" ? "ok" : j.status === "failed" ? "danger" : "neutral"}>{j.status}</Badge>
                      <span>{j.job.replace("_", " ")} · {j.instrument} · {j.slot}</span>{j.error && <span className="truncate text-danger" title={j.error}>{j.error}</span>}</li>
                  ))}
                  {jobs.data?.length === 0 && <li className="text-faint">No scheduled runs yet.</li>}
                </ul>
              </Section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
