import { CheckCircle2, CircleDashed, FileClock, GitCommitVertical, History, PencilLine } from "lucide-react";
import type { Kind, VersionSummary, Week } from "../api";
import { pickVersion } from "../App";
import { Badge, DirectionTag, Panel, cx } from "../ui";

function Status({ v }: { v: VersionSummary | undefined }) {
  if (!v) return <CircleDashed className="size-4 text-faint" aria-label="Not generated" />;
  if (v.status === "published") return <CheckCircle2 className="size-4 text-ok" aria-label="Published" />;
  return <PencilLine className="size-4 text-warn" aria-label="Draft" />;
}

function Row({ label, sub, versions, active, onClick, showDir }: {
  label: string; sub?: string; versions: VersionSummary[]; active: boolean; onClick: () => void; showDir?: boolean;
}) {
  const v = pickVersion(versions);
  const nPub = versions.filter((x) => x.status === "published").length;
  return (
    <button onClick={onClick} aria-current={active}
      className={cx("group flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors duration-150",
        active ? "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-accent-soft" : "border-transparent hover:bg-surface-3")}>
      <Status v={v} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium">{label}</span>
        <span className="block truncate text-[11.5px] text-faint">
          {v ? (v.status === "published" ? `Published ${v.published_display?.split(" ").slice(1, 3).join(" ")} · ${v.published_display?.split(" ")[4]}` : `Draft v${v.version}`) : sub ?? "Not generated"}
        </span>
      </span>
      {showDir && v?.direction && <DirectionTag direction={v.direction} compact />}
      {nPub > 1 && <Badge tone="accent" title="Published versions">v{nPub}</Badge>}
      {v?.data_mode === "fixture" && <Badge tone="fixture" title="Built on development fixtures">FX</Badge>}
    </button>
  );
}

export function Timeline({ week, tab, day, reviewDay, onSelect }: {
  week: Week; tab: Kind; day: string; reviewDay: string; onSelect: (k: Kind, d?: string, review?: string) => void;
}) {
  const fmt = (s: string) => new Date(s + "T12:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  return (
    <>
      <Panel title="This week" icon={<FileClock className="size-4" />} bodyClass="p-2">
        <div className="space-y-0.5">
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Before the week</div>
          <Row label="Weekly analysis" sub={`Week of ${fmt(week.week_key)}`} versions={week.weekly_analysis} showDir
            active={tab === "weekly_analysis"} onClick={() => onSelect("weekly_analysis")} />
          {week.days.map((d) => (
            <div key={d.date} className="relative">
              <div className="flex items-center gap-2 px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                <span>{d.day}</span><span className="num font-normal normal-case tracking-normal">{fmt(d.date)}</span>
              </div>
              <Row label="Daily analysis" versions={d.daily_analysis} showDir
                active={tab === "daily_analysis" && day === d.date} onClick={() => onSelect("daily_analysis", d.date)} />
              <Row label="Session review" sub="Published next morning" versions={d.daily_review}
                active={tab === "daily_review" && reviewDay === d.date}
                onClick={() => onSelect("daily_review", undefined, d.date)} />
            </div>
          ))}
          <div className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">After the week</div>
          <Row label="Weekly review" versions={week.weekly_review} active={tab === "weekly_review"} onClick={() => onSelect("weekly_review")} />
        </div>
      </Panel>
      <Panel title="Outlook change log" icon={<History className="size-4" />}>
        {week.change_log.length === 0 ? <p className="text-sm text-muted">No outlook changes recorded this week.</p> : (
          <ol className="space-y-3">
            {week.change_log.map((c, i) => (
              <li key={i} className="flex gap-2 text-[13px]">
                <GitCommitVertical className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                <div className="min-w-0">
                  <div className="num text-[11.5px] text-faint">{c.at}</div>
                  <div><span className="text-muted line-through decoration-faint">{c.from}</span> → <span className="font-medium">{c.to}</span></div>
                  <p className="mt-0.5 line-clamp-3 text-[12.5px] text-muted">{c.evidence}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </>
  );
}
