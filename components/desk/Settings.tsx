"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Globe2, KeyRound, X, XCircle } from "lucide-react";
import { useState } from "react";
import { api, type AppConfig } from "./api";
import { Badge, Button, cx, inputCls } from "./ui";

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 border-b border-line px-5 py-4">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.07em] text-muted">{icon}{title}</h3>
      {children}
    </section>
  );
}

export function SettingsDrawer({ open, onClose, config }: { open: boolean; onClose: () => void; config: AppConfig }) {
  const qc = useQueryClient();
  const save = useMutation({ mutationFn: api.saveSettings, onSuccess: () => qc.invalidateQueries() });
  const [tzOther, setTzOther] = useState("");
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
              <Section title="Credentials and sources" icon={<KeyRound className="size-4" />}>
                <ul className="space-y-1.5">
                  {cred("blob", "Vercel Blob storage", "connect a Blob store")}
                  {cred("admin_token", "Admin token for changes", "set ADMIN_TOKEN")}
                  {cred("cron_secret", "Cron secret for the daily refresh", "set CRON_SECRET")}
                  <li className="flex items-center gap-2 text-[13px]"><CheckCircle2 className="size-4 text-ok" /><span>All data sources</span><span className="ml-auto text-[12px] text-faint">free, no keys needed</span></li>
                </ul>
                <p className="text-[12px] text-faint">Secrets live in Vercel environment variables, never in storage or the UI. Instruments and feeds are in <code>lib/config.ts</code>.</p>
                <div className="flex flex-wrap gap-1.5 text-[12px]">
                  {Object.entries(config.providers).map(([k, v]) => <Badge key={k}>{k.replace("_", " ")}: {Array.isArray(v) ? v.join(", ") : String(v)}</Badge>)}
                </div>
              </Section>
              <Section title="Fallback timezone" icon={<Globe2 className="size-4" />}>
                <p className="text-[12px] text-faint">Every page shows times in your browser's timezone ({config.display.timezone_label}, {config.display.timezone}). This zone is used only when a request carries none, such as the daily refresh.</p>
                <div className="flex flex-wrap gap-1.5">
                  {config.display.choices.map((c) => (
                    <button key={c.tz} onClick={() => save.mutate({ display_timezone: c.tz })}
                      className={cx("cursor-pointer rounded-lg border px-2.5 py-1.5 text-[12.5px]", config.display.default_timezone === c.tz ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:bg-surface-3")}>
                      {c.tz.replace("_", " ")} <span className="text-faint">· {c.label}</span>
                    </button>
                  ))}
                </div>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (tzOther.trim()) save.mutate({ display_timezone: tzOther.trim() }); }}>
                  <input className={cx(inputCls, "flex-1")} placeholder="Other IANA zone, e.g. Africa/Dar_es_Salaam" value={tzOther} onChange={(e) => setTzOther(e.target.value)} aria-label="Other timezone" />
                  <Button size="sm" type="submit" busy={save.isPending}>Use</Button>
                </form>
                {save.error && <p className="text-[12px] text-danger">{String(save.error)}</p>}
              </Section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
