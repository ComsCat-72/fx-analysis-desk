"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { AlertOctagon, AlertTriangle, CheckCircle2, Copy, FileDown, FileText, GitBranchPlus, Info, Lock, PencilLine, Send, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ApiError, api, friendlyError, withToken, type Finding, type Kind, type ReportDetail, type SlotState, type VersionSummary } from "./api";
import { TABS } from "./App";
import { Badge, Button, DirectionTag, Empty, FadeIn, Field, Spinner, cx, inputCls } from "./ui";

/** Replace [F1] / [F1, L2] citations with inline code markers the renderer turns into buttons. */
function withCiteMarkers(md: string) {
  return md.replace(/\[((?:[FLEP]\d+)(?:\s*,\s*[FLEP]\d+)*)\](?!\()/g, (_, ids: string) =>
    ids.split(",").map((i) => "`cite:" + i.trim() + "`").join(" ")); // a space keeps adjacent code spans apart
}

function ReportBody({ md, onCite }: { md: string; onCite: (id: string) => void }) {
  const src = useMemo(() => withCiteMarkers(md), [md]);
  return (
    <article className="report">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        code({ children }) {
          const t = String(children);
          if (t.startsWith("cite:")) {
            const id = t.slice(5);
            return <button className="cite" onClick={() => onCite(id)} aria-label={`Show evidence ${id}`}>{id}</button>;
          }
          return <code>{children}</code>;
        },
        table({ children }) { return <div className="report-table"><table>{children}</table></div>; },
        a({ href, children }) { return <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{children}</a>; },
      }}>{src}</ReactMarkdown>
    </article>
  );
}

const SEV = {
  blocking: { tone: "danger" as const, icon: AlertOctagon, label: "Blocking" },
  warning: { tone: "warn" as const, icon: AlertTriangle, label: "Warning" },
  info: { tone: "neutral" as const, icon: Info, label: "Info" },
};

function Checks({ findings }: { findings: Finding[] }) {
  const sorted = [...findings].sort((a, b) => ["blocking", "warning", "info"].indexOf(a.severity) - ["blocking", "warning", "info"].indexOf(b.severity));
  if (!sorted.length) return <div className="flex items-center gap-2 text-sm text-ok"><CheckCircle2 className="size-4" />All checks passed.</div>;
  return (
    <ul className="space-y-2">
      {sorted.map((f, i) => {
        const s = SEV[f.severity];
        const Icon = s.icon;
        return (
          <li key={i} className="rounded-lg border border-line bg-surface-2 p-2.5 text-[13px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <Icon className={cx("size-4", f.severity === "blocking" ? "text-danger" : f.severity === "warning" ? "text-warn" : "text-muted")} aria-hidden />
              <Badge tone={s.tone}>{s.label}</Badge>
              <Badge>{f.check}</Badge>
              <span className="text-faint">{f.category.replaceAll("_", " ")}</span>
              {f.section && <span className="ml-auto text-[11.5px] text-faint">in {f.section.replaceAll("_", " ")}</span>}
            </div>
            <p className="mt-1">{f.message}</p>
            {f.excerpt && <p className="mt-1 rounded bg-surface-3 px-2 py-1 font-mono text-[12px] text-muted">“{f.excerpt}”</p>}
            {f.suggestion && <p className="mt-1 text-[12.5px] text-accent">Suggestion: {f.suggestion}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function Editor({ report, onClose }: { report: ReportDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState<Record<string, string>>(report.sections.text);
  const save = useMutation({
    mutationFn: () => api.editDraft(report.id, text),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report", report.id] }); onClose(); },
  });
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal aria-label="Edit draft">
      <motion.div initial={{ y: 12 }} animate={{ y: 0 }} className="panel flex max-h-[90vh] w-full max-w-3xl flex-col">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <PencilLine className="size-4 text-muted" /><h2 className="font-semibold">Edit draft sections</h2>
          <span className="text-[12px] text-faint">Checks re-run on save. Cite facts as [F1], [L2], [E3].</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}><X className="size-4" /><span className="sr-only">Close</span></Button>
        </header>
        <div className="space-y-3 overflow-y-auto p-4">
          {Object.keys(text).map((k) => (
            <Field key={k} label={report.sections.headings[k] ?? k}>
              <textarea value={text[k]} rows={4} onChange={(e) => setText({ ...text, [k]: e.target.value })}
                className="rounded-lg border border-line bg-surface-2 p-2.5 text-sm leading-relaxed text-fg focus:border-accent focus:outline-none" />
            </Field>
          ))}
        </div>
        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          {save.error && <span className="mr-auto text-sm text-danger">{String(save.error)}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>Save and re-check</Button>
        </footer>
      </motion.div>
    </motion.div>
  );
}

const ABOUT: Record<Kind, { title: string; what: string; next: string }> = {
  weekly_analysis: { title: "Weekly analysis", what: "Sets the working view for the week: the bias, both economies, the key releases and the price areas that would change the picture.",
    next: "Every daily analysis this week builds on it, and the weekly review on Saturday assesses it." },
  daily_analysis: { title: "Daily analysis", what: "Explains this day's context inside the weekly view, and what would strengthen or weaken it.",
    next: "The review the next morning compares it with what the market actually did." },
  daily_review: { title: "Session review", what: "Compares the published daily analysis for this session with what the market actually did.",
    next: "Its conclusion feeds the next daily analysis and the weekly review." },
  weekly_review: { title: "Weekly review", what: "Assesses the whole week: the weekly view against the actual week, day by day, plus one lesson from the evidence.",
    next: "Next week's weekly analysis starts from it." },
};

/** What this slot is, whether it can be written now, and where to go instead. */
function SlotCard({ tab, period, dayName, slot, hasWeekly, onGo }: {
  tab: Kind; period: string; dayName: string | null; slot?: SlotState; hasWeekly: boolean; onGo: (k: Kind, d?: string, review?: string) => void;
}) {
  const a = ABOUT[tab];
  const when = tab.startsWith("weekly") ? `week of ${period}` : `${dayName ?? ""} ${period}`.trim();
  const alt: { label: string; go: () => void } | null = slot?.state !== "closed" ? null
    : tab === "daily_analysis" ? { label: `Open the review of ${dayName ?? period}`, go: () => onGo("daily_review", undefined, period) }
    : tab === "weekly_analysis" ? { label: "Open the weekly review", go: () => onGo("weekly_review") } : null;
  const tone = !slot ? "border-line" : slot.state === "open" ? "border-[color-mix(in_srgb,var(--ok)_40%,transparent)]" : slot.state === "not_yet" ? "border-line" : "border-[color-mix(in_srgb,var(--warn)_40%,transparent)]";
  return (
    <div className={cx("max-w-2xl space-y-3 rounded-xl border bg-surface-2 p-5", tone)}>
      <div>
        <h3 className="text-[16px] font-semibold">{a.title} <span className="font-normal text-muted">· {when}</span></h3>
        <p className="mt-1 text-[13.5px] text-muted">{a.what} {a.next}</p>
      </div>
      {slot && (
        <div className={cx("flex items-start gap-2 text-[13.5px]", slot.state === "open" ? "text-ok" : slot.state === "closed" ? "text-warn" : "text-muted")}>
          {slot.state === "open" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : slot.state === "closed" ? <Lock className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span>{slot.state === "closed" ? <><strong>Closed.</strong> {slot.reason}</> : slot.state === "not_yet" ? <><strong>Not yet.</strong> {slot.reason}</> : <><strong>Ready.</strong> {slot.reason.replace(/^Ready: /, "")} Click <em>Generate draft</em> above.</>}</span>
        </div>
      )}
      {slot?.state === "open" && tab === "daily_analysis" && !hasWeekly && (
        <p className="text-[12.5px] text-faint">No weekly analysis is published for this week yet. The daily analysis will say so; publishing the weekly analysis first gives it a reference.
          {" "}<button className="cursor-pointer text-accent underline" onClick={() => onGo("weekly_analysis")}>Open the weekly analysis</button></p>
      )}
      {alt && <Button size="sm" onClick={alt.go}>{alt.label}</Button>}
    </div>
  );
}

export function ReportPane({ instrument, tab, onTab, period, versions, versionId, onVersion, onCite, credentials, defaultWriter, weekKey, slot, onGo, hasWeekly, dayName }: {
  instrument: string; tab: Kind; onTab: (k: Kind) => void; period: string; versions: VersionSummary[]; versionId: string | null;
  onVersion: (id: string) => void; onCite: (id: string) => void; credentials: Record<string, boolean>; defaultWriter: string; weekKey: string;
  slot?: SlotState; onGo: (k: Kind, d?: string, review?: string) => void; hasWeekly: boolean; dayName: string | null;
}) {
  const qc = useQueryClient();
  const report = useQuery({ queryKey: ["report", versionId], queryFn: () => api.report(versionId!), enabled: versionId != null });
  const [writer, setWriter] = useState(credentials.anthropic ? defaultWriter : "template");
  const [note, setNote] = useState("");
  const [partial, setPartial] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showChecks, setShowChecks] = useState(true);
  const refresh = (id?: string) => {
    qc.invalidateQueries({ queryKey: ["week", instrument, weekKey] });
    qc.invalidateQueries({ queryKey: ["evaluations", instrument] });
    if (id) { qc.invalidateQueries({ queryKey: ["report", id] }); onVersion(id); }
  };
  const draft = useMutation({ mutationFn: () => api.draft(instrument, tab, period, writer),
    onSuccess: (r) => { refresh(r.id); qc.invalidateQueries({ queryKey: ["fresh", instrument] }); qc.invalidateQueries({ queryKey: ["cal"] }); } });
  const publish = useMutation({ mutationFn: () => api.publish(versionId!, note || undefined, partial), onSuccess: (r) => { setNote(""); refresh(r.id); } });
  const correct = useMutation({ mutationFn: (t: "correction" | "update") => api.correct(versionId!, t), onSuccess: (r) => refresh(r.id) });
  const r = report.data;
  const isDraft = r?.status === "draft";
  const pubError = publish.error instanceof ApiError ? (publish.error.detail as { message?: string; findings?: Finding[] }) : null;
  const err = draft.error ?? correct.error ?? (publish.error && !pubError?.findings ? publish.error : null);

  return (
    <section className="panel flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 pt-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.kind} role="tab" aria-selected={tab === t.kind} onClick={() => onTab(t.kind)}
            className={cx("relative cursor-pointer rounded-t-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
              tab === t.kind ? "text-fg" : "text-muted hover:text-fg")}>
            {t.label}
            {tab === t.kind && <motion.span layoutId="tab-ink" className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-accent" />}
          </button>
        ))}
        <span className="num ml-auto px-3 text-[12px] text-faint">{tab.includes("weekly") ? `Week of ${period}` : period}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <label className="flex items-center gap-1.5 text-[13px] text-muted">Writer
          <select value={writer} onChange={(e) => setWriter(e.target.value)} className={cx(inputCls, "h-8 cursor-pointer")}>
            <option value="claude" disabled={!credentials.anthropic}>Claude{credentials.anthropic ? " (paid)" : " (no API key)"}</option>
            <option value="template">Rule-based (free)</option>
          </select>
        </label>
        <Button size="sm" variant={versions.length ? "secondary" : "primary"} busy={draft.isPending} onClick={() => draft.mutate()}
          disabled={slot ? !slot.ok : false} title={slot && !slot.ok ? slot.reason : "Build a new draft from the latest data"}>
          <Sparkles className="size-4" aria-hidden />{draft.isPending ? (writer === "claude" ? "Researching and drafting (1–3 min)…" : "Drafting…") : "Generate draft"}
        </Button>
        {r && r.status === "published" && (
          <>
            <Button size="sm" busy={correct.isPending} onClick={() => correct.mutate("correction")} title="New version with the same data cutoff">
              <GitBranchPlus className="size-4" aria-hidden />Correct as new version
            </Button>
            <Button size="sm" variant="ghost" busy={correct.isPending} onClick={() => correct.mutate("update")} title="Timestamped intraday update with a new data cutoff">
              Timestamped update
            </Button>
          </>
        )}
        {r && (
          <div className="ml-auto flex items-center gap-1.5">
            <a href={withToken(`/api/reports/${encodeURIComponent(r.id)}/export.md`)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-[13px] hover:bg-surface-3"><FileText className="size-4" aria-hidden />Markdown</a>
            <a href={withToken(`/api/reports/${encodeURIComponent(r.id)}/export.pdf`)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-[13px] hover:bg-surface-3"><FileDown className="size-4" aria-hidden />PDF</a>
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(r.body_md)} title="Copy Markdown"><Copy className="size-4" /><span className="sr-only">Copy Markdown</span></Button>
          </div>
        )}
      </div>

      {versions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
          <span className="text-[12px] text-faint">Versions</span>
          {versions.map((v) => (
            <button key={v.id} onClick={() => onVersion(v.id)}
              className={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[12.5px] transition-colors",
                v.id === versionId ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:text-fg")}>
              {v.status === "published" ? <Lock className="size-3 text-ok" aria-hidden /> : <PencilLine className="size-3 text-warn" aria-hidden />}
              v{v.version}<span className="text-faint">{v.status === "discarded" ? "discarded" : v.version_type !== "original" ? v.version_type : ""}</span>
              <DirectionTag direction={v.direction} compact />
            </button>
          ))}
        </div>
      )}

      {err && <div className="mx-4 mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-danger-soft px-3 py-2 text-sm text-danger">{friendlyError(err)}</div>}

      <div className="grid min-h-[420px] flex-1 grid-cols-1 min-[1900px]:grid-cols-[minmax(0,1fr)_320px] lg:max-[1535px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 overflow-x-hidden p-5">
          {versionId == null ? (
            <SlotCard tab={tab} period={period} dayName={dayName} slot={slot} hasWeekly={hasWeekly} onGo={onGo} />
          ) : report.error ? (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-danger-soft p-3 text-sm text-danger" role="alert">
              Could not load this report: {friendlyError(report.error)}
              {" "}If this keeps happening, check that a Vercel Blob store is connected to the project (see the warning above).
            </div>
          ) : report.isLoading || !r ? <Spinner label="Loading report" /> : (
            <FadeIn k={r.id}>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]">
                {r.status === "published" ? <Badge tone="ok"><Lock className="size-3" />Published {r.published_display}</Badge> : <Badge tone="warn"><PencilLine className="size-3" />Draft · preview</Badge>}
                {r.data_mode === "fixture" && <Badge tone="fixture">Development fixture data</Badge>}
                {r.partial && <Badge tone="warn">Partial report</Badge>}
                <span className="text-faint">Data cutoff {r.data_cutoff_display} · writer {r.writer}</span>
                {r.content_hash && <span className="num text-faint" title="SHA-256 of the published text">#{r.content_hash.slice(0, 10)}</span>}
              </div>
              <ReportBody md={r.body_md} onCite={onCite} />
            </FadeIn>
          )}
        </div>
        {r && (
          <aside className="order-first border-b border-line p-4 lg:max-[1535px]:order-none lg:max-[1535px]:border-b-0 lg:max-[1535px]:border-l min-[1900px]:order-none min-[1900px]:border-b-0 min-[1900px]:border-l">
            <button className="flex w-full cursor-pointer items-center gap-2 text-left" onClick={() => setShowChecks(!showChecks)} aria-expanded={showChecks}>
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.07em] text-muted">Pre-publication checks</h3>
              <span className="ml-auto flex gap-1">
                <Badge tone={r.checks.blocking ? "danger" : "ok"}>{r.checks.blocking} blocking</Badge>
                <Badge tone={r.checks.warnings ? "warn" : "neutral"}>{r.checks.warnings} warnings</Badge>
              </span>
            </button>
            <AnimatePresence initial={false}>
              {showChecks && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-3"><Checks findings={pubError?.findings ?? r.checks.findings} /></div>
                </motion.div>
              )}
            </AnimatePresence>
            {isDraft && (
              <div className="mt-4 space-y-3 border-t border-line pt-4">
                <Button size="sm" className="w-full" onClick={() => setEditing(true)}><PencilLine className="size-4" />Edit sections</Button>
                {r.version_type !== "original" && (
                  <Field label="Change note (required for corrections)">
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="rounded-lg border border-line bg-surface-2 p-2 text-sm focus:border-accent focus:outline-none" placeholder="What changed and why" />
                  </Field>
                )}
                {r.facts.missing?.length > 0 && (
                  <label className="flex items-start gap-2 text-[13px] text-muted">
                    <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} className="mt-1" />
                    Publish as a clearly labelled partial report (only if enabled in configuration)
                  </label>
                )}
                {pubError?.message && <p className="text-[13px] text-danger">{pubError.message}</p>}
                <Button variant="primary" className="w-full" busy={publish.isPending} onClick={() => publish.mutate()}
                  disabled={r.checks.blocking > 0 && !partial} title={r.checks.blocking ? "Resolve blocking findings first" : "Publish (immutable)"}>
                  <Send className="size-4" />Publish
                </Button>
                <p className="text-[12px] text-faint">Published reports are immutable. Later changes create a new version with a change note.</p>
              </div>
            )}
          </aside>
        )}
      </div>
      <AnimatePresence>{editing && r && <Editor report={r} onClose={() => setEditing(false)} />}</AnimatePresence>
    </section>
  );
}
