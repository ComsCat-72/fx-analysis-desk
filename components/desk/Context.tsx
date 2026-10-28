"use client";

import { Activity, BookOpenCheck, CalendarClock, ImageUp, Layers } from "lucide-react";
import { CalendarPanel, EvaluationPanel, EvidencePanel, LevelsPanel, ScreenshotPanel } from "./SidePanels";
import { BarePanel, Tabs } from "./ui";

export type ContextTab = "evidence" | "calendar" | "levels" | "evaluation" | "screenshot";

const TABS: { id: ContextTab; label: React.ReactNode }[] = [
  { id: "evidence", label: <><BookOpenCheck className="size-3.5" aria-hidden />Evidence</> },
  { id: "calendar", label: <><CalendarClock className="size-3.5" aria-hidden />Calendar</> },
  { id: "levels", label: <><Layers className="size-3.5" aria-hidden />Levels</> },
  { id: "evaluation", label: <><Activity className="size-3.5" aria-hidden />Evaluation</> },
  { id: "screenshot", label: <><ImageUp className="size-3.5" aria-hidden />Chart</> },
];

/** Everything around the report in one tabbed panel: sources, calendar, reference levels, evaluation history, screenshots. */
export function ContextPanel({ tab, onTab, instrument, weekKey, versionId, focus, decimals, canExtract }: {
  tab: ContextTab; onTab: (t: ContextTab) => void; instrument: string; weekKey: string; versionId: string | null; focus: string | null;
  decimals: number; canExtract: boolean;
}) {
  return (
    <section className="panel flex min-w-0 flex-col" aria-label="Report context">
      <Tabs tabs={TABS} value={tab} onChange={onTab} label="context" className="border-b border-line px-1.5 pt-1" />
      <div role="tabpanel" aria-labelledby={`tab-context-${tab}`} className="min-w-0">
        <BarePanel.Provider value={true}>
          {tab === "evidence" && <EvidencePanel versionId={versionId} focus={focus} />}
          {tab === "calendar" && <CalendarPanel instrument={instrument} weekKey={weekKey} />}
          {tab === "levels" && <LevelsPanel instrument={instrument} decimals={decimals} />}
          {tab === "evaluation" && <EvaluationPanel instrument={instrument} />}
          {tab === "screenshot" && <ScreenshotPanel instrument={instrument} canExtract={canExtract} />}
        </BarePanel.Provider>
      </div>
    </section>
  );
}
