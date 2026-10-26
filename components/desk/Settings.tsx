"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { BookA, CheckCircle2, Database, KeyRound, Newspaper, Timer, X, XCircle } from "lucide-react";
import { useState } from "react";
import { api, type AppConfig, type Kind } from "./api";
import { Badge, Button, Field, cx, inputCls } from "./ui";

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
  const [job, setJob] = useState<Kind>("daily_analysis");
  const run = useMutation({ mutationFn: () => api.runJob(job, instrument, true), onSuccess: () => qc.invalidateQueries() });
  const terms = useQuery({ queryKey: ["terms"], queryFn: api.terminology, enabled: open });
  const [term, setTerm] = useState({ kind: "prohibited", term: "", suggest: "" });
  const addTerm = useMutation({ mutationFn: () => api.addTerm({ kind: term.kind, term: term.term.trim(), suggest: term.suggest || null, definition: term.suggest || null, enabled: true }),
    onSuccess: () => { setTerm({ ...term, term: "", suggest: "" }); qc.invalidateQueries({ queryKey: ["terms"] }); } });
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
              <h2 className="font-semibold">Configure</h2>
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
              <Section title="Credentials and sources" icon={<KeyRound className="size-4" />}>
                <ul className="space-y-1.5">
                  {cred("anthropic", "Claude writer, research and review", "set ANTHROPIC_API_KEY")}
                  {cred("blob", "Vercel Blob storage", "connect a Blob store")}
                  {cred("admin_token", "Admin token for changes", "set ADMIN_TOKEN")}
                  {cred("cron_secret", "Cron secret for the schedule", "set CRON_SECRET")}
                  <li className="flex items-center gap-2 text-[13px]"><CheckCircle2 className="size-4 text-ok" /><span>Yahoo Finance prices</span><span className="ml-auto text-[12px] text-faint">no key needed</span></li>
                </ul>
                <p className="text-[12px] text-faint">Secrets live in Vercel environment variables, never in storage or the UI. Instruments, models and rules are in <code>lib/config.ts</code>.</p>
                <div className="flex flex-wrap gap-1.5 text-[12px]">
                  {Object.entries(config.providers).map(([k, v]) => <Badge key={k}>{k.replace("_", " ")}: {Array.isArray(v) ? v.join(", ") : String(v)}</Badge>)}
                </div>
              </Section>
              <Section title={`Run a job now · ${instrument}`} icon={<Database className="size-4" />}>
                <p className="text-[12px] text-faint">Runs a scheduled job immediately for its current slot (for example the previous session for a review), then publishes or keeps a draft according to the publication mode.</p>
                <div className="flex gap-2">
                  <select className={cx(inputCls, "flex-1")} value={job} onChange={(e) => setJob(e.target.value as Kind)}>
                    {(["weekly_analysis", "daily_analysis", "daily_review", "weekly_review"] as Kind[]).map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
                  </select>
                  <Button size="sm" busy={run.isPending} onClick={() => run.mutate()}>Run now</Button>
                </div>
                {run.error && <p className="text-[12px] text-danger">{String(run.error)}</p>}
                {run.data != null && <p className="text-[12px] text-ok">{["status", "slot", "reason", "error"].filter((k) => run.data[k]).map((k) => `${k}: ${String(run.data[k])}`).join(" · ")}</p>}
              </Section>
              <Section title="Terminology" icon={<BookA className="size-4" />}>
                <p className="text-[12px] text-faint">Prohibited terms block publication. Approving a term removes it from the prohibited list. Only you add terms; nothing is adopted from sources.</p>
                <form className="grid grid-cols-[auto_1fr] gap-2" onSubmit={(e) => { e.preventDefault(); addTerm.mutate(); }}>
                  <select className={inputCls} value={term.kind} onChange={(e) => setTerm({ ...term, kind: e.target.value })}>
                    <option value="prohibited">Prohibit</option><option value="approved">Approve</option>
                  </select>
                  <input className={inputCls} required placeholder="term" value={term.term} onChange={(e) => setTerm({ ...term, term: e.target.value })} />
                  <input className={cx(inputCls, "col-span-2")} placeholder={term.kind === "prohibited" ? "plain-language replacement" : "definition"} value={term.suggest} onChange={(e) => setTerm({ ...term, suggest: e.target.value })} />
                  {addTerm.error && <p className="col-span-2 text-[12px] text-danger">{String(addTerm.error)}</p>}
                  <div className="col-span-2"><Button size="sm" type="submit" busy={addTerm.isPending}>Save term</Button></div>
                </form>
                {terms.data && <p className="text-[12px] text-faint">{terms.data.prohibited.length} prohibited · {terms.data.approved.length} approved · blocked abbreviations: {Object.entries(terms.data.abbreviations).filter(([, v]) => !v.enabled).map(([k]) => k).join(", ")}</p>}
              </Section>
              <Section title="Add a headline (manual source)" icon={<Newspaper className="size-4" />}>
                <p className="text-[12px] text-faint">Claude also searches the web before each report and cites what it finds. Add headlines you have read yourself here, with a link; they are labelled user-entered.</p>
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
                  {Object.entries(config.schedules).map(([k, v]) => (
                    <li key={k} className="flex flex-col"><span className="text-muted">{k}</span><code className="num text-[12px] text-faint">{String(v)}</code></li>
                  ))}
                </ul>
                <h4 className="pt-2 text-[12px] font-semibold uppercase tracking-wider text-faint">Recent jobs</h4>
                <ul className="space-y-1 text-[12.5px]">
                  {(jobs.data ?? []).slice(0, 10).map((j, i) => (
                    <li key={i} className="flex items-center gap-2"><Badge tone={j.status === "succeeded" ? "ok" : j.status === "failed" ? "danger" : "neutral"}>{j.status}</Badge>
                      <span>{j.job.replace("_", " ")} · {j.instrument} · {j.slot}{j.detail ? ` · ${j.detail}` : ""}</span>{j.error && <span className="truncate text-danger" title={j.error}>{j.error}</span>}</li>
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
