"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, CalendarRange, CheckCircle2, FileSearch, GitBranchPlus, Layers, Lock, Newspaper, PencilLine, ShieldCheck, Sparkles, Sunrise, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./ui";

const CYCLE: { when: string; title: string; icon: ReactNode; text: string }[] = [
  { when: "Sunday", title: "Weekly analysis", icon: <CalendarRange className="size-4" />,
    text: "Sets the working view for the week: the bias, both economies, the week's key releases and the price areas that would change the picture." },
  { when: "Each weekday morning", title: "Review of yesterday", icon: <FileSearch className="size-4" />,
    text: "Compares yesterday's published daily analysis with what the market actually did. It never rewrites the original." },
  { when: "Each weekday morning", title: "Daily analysis", icon: <Sunrise className="size-4" />,
    text: "Explains today's context inside the weekly view: what Monday established, what changed since, and what would strengthen or weaken it." },
  { when: "Saturday", title: "Weekly review", icon: <CheckCircle2 className="size-4" />,
    text: "Looks back at the whole week: the weekly view against the actual week, day by day, and one lesson from the evidence." },
];

const LIFE: { title: string; icon: ReactNode; text: string }[] = [
  { title: "Generate draft", icon: <Sparkles className="size-4" />, text: "Builds the report from the latest prices, calendar, central-bank items and headlines." },
  { title: "Checks", icon: <ShieldCheck className="size-4" />, text: "Every draft is checked for advice wording, unsupported numbers and hindsight. Blocking findings must be fixed first." },
  { title: "Publish", icon: <Lock className="size-4" />, text: "The report is locked for good. Later reports and reviews refer to exactly this version." },
  { title: "Correct", icon: <GitBranchPlus className="size-4" />, text: "Mistakes become a new version with a change note; the original stays visible." },
];

export function Guide({ open, onClose, schedules, autoPublish }: { open: boolean; onClose: () => void; schedules: string[]; autoPublish: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/55 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          role="dialog" aria-modal aria-labelledby="guide-title" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
          <motion.div className="panel my-6 w-full max-w-3xl" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }} onClick={(e) => e.stopPropagation()}>
            <header className="flex items-start gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 id="guide-title" className="text-lg font-semibold">How the desk works</h2>
                <p className="text-[13px] text-muted">Four connected reports each week, per instrument. Each one builds on the ones before it.</p>
              </div>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}><X className="size-4" /><span className="sr-only">Close</span></Button>
            </header>

            <div className="space-y-6 px-5 py-5">
              <section>
                <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">1 · The weekly cycle</h3>
                <ol className="relative space-y-3 border-l border-line pl-5">
                  {CYCLE.map((s) => (
                    <li key={s.title} className="relative">
                      <span className="absolute -left-[31px] grid size-5 place-items-center rounded-full border border-line bg-surface-2 text-accent" aria-hidden>
                        <span className="size-1.5 rounded-full bg-accent" />
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-accent" aria-hidden>{s.icon}</span>
                        <span className="font-medium">{s.title}</span>
                        <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11.5px] text-muted">{s.when}</span>
                      </div>
                      <p className="mt-0.5 text-[13px] text-muted">{s.text}</p>
                    </li>
                  ))}
                </ol>
                <p className="mt-3 text-[12.5px] text-faint">
                  An analysis can only be written before or during its own period, and a review only after its period has closed.
                  That way no report is written with hindsight. Past days show as <em>Closed</em> and future ones as <em>Opens …</em>.
                </p>
              </section>

              <section>
                <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">2 · The life of one report</h3>
                <ol className="grid gap-2 sm:grid-cols-4">
                  {LIFE.map((s, i) => (
                    <li key={s.title} className="rounded-xl border border-line bg-surface-2 p-3">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium"><span className="num text-faint">{i + 1}</span><span className="text-accent" aria-hidden>{s.icon}</span>{s.title}</div>
                      <p className="mt-1 text-[12.5px] leading-snug text-muted">{s.text}</p>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-line p-3">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-medium"><CalendarClock className="size-4 text-accent" aria-hidden />Automatic or by hand</h3>
                  <p className="mt-1 text-[12.5px] text-muted">
                    {autoPublish
                      ? "Auto-publish is on: the scheduled runs create each report and publish it when every check passes. Anything with a blocking finding waits as a draft for you."
                      : "Manual publication is on: the scheduled runs create drafts, and you publish them."}
                    {" "}You can also generate any open report yourself. Switch modes in Configure.
                  </p>
                  {schedules.length > 0 && <ul className="mt-1.5 space-y-0.5 text-[12px] text-faint">{schedules.map((s) => <li key={s}>{s}</li>)}</ul>}
                </div>
                <div className="rounded-xl border border-line p-3">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-medium"><PencilLine className="size-4 text-accent" aria-hidden />What you can add</h3>
                  <ul className="mt-1 space-y-1 text-[12.5px] text-muted">
                    <li className="flex gap-1.5"><CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span>Actual results in the <strong>Calendar</strong> tab (the free calendar has none)</span></li>
                    <li className="flex gap-1.5"><Layers className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span>Your own support and resistance areas in the <strong>Levels</strong> tab</span></li>
                    <li className="flex gap-1.5"><Newspaper className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span>Headlines you have read, in <strong>Configure</strong></span></li>
                  </ul>
                </div>
              </section>

              <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
                Start here: pick an instrument, open this week, and generate the <strong>weekly analysis</strong>. Then publish it. Today's daily analysis will build on it.
                Reports explain the market. They never recommend buying, selling or positioning.
              </p>
            </div>
            <footer className="flex justify-end border-t border-line px-5 py-3">
              <Button variant="primary" onClick={onClose}>Got it</Button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
