"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Activity, Calculator, CalendarRange, Clock3, Landmark, Newspaper, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./ui";

const PAGES: { title: string; icon: ReactNode; text: string; source: string }[] = [
  { title: "Calendar", icon: <CalendarRange className="size-4" />, source: "Forex Factory export · FXStreet and biquote.io actuals",
    text: "This week's economic releases in your timezone. Right after a release the row shows “awaiting” and the actual appears as soon as a source publishes it (checked every 20 seconds)." },
  { title: "Markets", icon: <Activity className="size-4" />, source: "Yahoo Finance · CFTC",
    text: "Currency strength today and this week, the correlation between pairs over 20 and 60 days, and how large speculators are positioned in the weekly COT report." },
  { title: "Central banks", icon: <Landmark className="size-4" />, source: "biquote.io · calendar · the banks' own feeds",
    text: "Each bank's policy rate, its last change and next decision, the rate differential per pair, and the latest statements and speeches." },
  { title: "News", icon: <Newspaper className="size-4" />, source: "Reuters and WSJ free feeds",
    text: "Market headlines (title and link), filterable by currency." },
  { title: "Calculators", icon: <Calculator className="size-4" />, source: "BabyPips formulas · Yahoo Finance rates",
    text: "Position size, pip value, margin, profit and loss, risk/reward, pivot points and more." },
  { title: "Market hours", icon: <Clock3 className="size-4" />, source: "Session times",
    text: "Live clocks for Sydney, Tokyo, London and New York, when each session opens and closes, and a time-zone converter." },
];

export function Guide({ open, onClose }: { open: boolean; onClose: () => void }) {
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
                <p className="text-[13px] text-muted">Six pages, all built on free public data. Every time is shown in your browser's timezone.</p>
              </div>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}><X className="size-4" /><span className="sr-only">Close</span></Button>
            </header>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {PAGES.map((p) => (
                <section key={p.title} className="rounded-lg border border-line bg-surface-2 p-3">
                  <h3 className="flex items-center gap-2 font-semibold"><span className="text-accent" aria-hidden>{p.icon}</span>{p.title}</h3>
                  <p className="mt-1 text-[13px] text-muted">{p.text}</p>
                  <p className="mt-1.5 text-[11.5px] text-faint">{p.source}</p>
                </section>
              ))}
            </div>
            <p className="mx-5 mb-4 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
              The desk shows data and what it means. It never recommends buying, selling or positioning.
            </p>
            <footer className="flex justify-end border-t border-line px-5 py-3">
              <Button variant="primary" onClick={onClose}>Got it</Button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
