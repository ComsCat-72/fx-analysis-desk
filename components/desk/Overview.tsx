"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Clock, Compass, RefreshCw, Sunrise } from "lucide-react";
import { pickVersion } from "./App";
import { api, type Week } from "./api";
import { Badge, Button, DirectionTag, Stat } from "./ui";

/** Summary strip: where the week stands, how fresh the data is, and what is scheduled next. Descriptive only. */
export function Overview({ instrument, week, day, weekKey }: { instrument: string; week: Week | undefined; day: string; weekKey: string }) {
  const qc = useQueryClient();
  const f = useQuery({ queryKey: ["fresh", instrument], queryFn: () => api.freshness(instrument), refetchInterval: 60_000 });
  const w = useQuery({ queryKey: ["warnings", instrument], queryFn: () => api.warnings(instrument), refetchInterval: 60_000 });
  const cal = useQuery({ queryKey: ["cal", instrument, weekKey], queryFn: () => api.calendar(instrument, weekKey) });
  const refresh = useMutation({ mutationFn: () => api.refresh(instrument), onSuccess: () => qc.invalidateQueries() });

  const wa = pickVersion(week?.weekly_analysis.filter((v) => v.status === "published"));
  const today = week?.days.find((d) => d.date === day);
  const da = pickVersion(today?.daily_analysis);
  const next = (cal.data ?? []).find((e) => e.impact === "High" && e.state === "scheduled");
  const conflicts = (w.data ?? []).filter((x) => x.code === "source_conflict").length;
  const other = (w.data ?? []).filter((x) => x.code !== "source_conflict" && x.severity !== "info").length;
  const fresh = f.data;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Weekly bias" icon={<Compass className="size-3.5" />}
          foot={wa ? `Published ${wa.published_display}` : "No weekly analysis published for this week"}>
          {wa ? <DirectionTag direction={wa.direction} /> : <span className="text-muted">Not published</span>}
        </Stat>
        <Stat label={`Daily outlook · ${today?.day ?? day}`} icon={<Sunrise className="size-3.5" />}
          foot={da ? (da.status === "published" ? `Published ${da.published_display}` : `Draft · data cutoff ${da.data_cutoff_display}`) : "No daily analysis for this day"}>
          {da ? <span className="flex items-center gap-2"><DirectionTag direction={da.direction} />{da.status !== "published" && <Badge tone="warn">draft</Badge>}</span> : <span className="text-muted">Not generated</span>}
        </Stat>
        <Stat label="Data freshness" icon={<Clock className="size-3.5" />} tone={!fresh ? undefined : fresh.is_fixture ? "fixture" : fresh.status === "ok" ? undefined : fresh.status === "stale" ? "warn" : "danger"}
          foot={fresh?.last_h1_close ? `Last 1H close ${fresh.last_h1_close}` : fresh?.message}>
          {!fresh ? <span className="text-muted">Checking…</span> : (
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone={fresh.status === "ok" ? "ok" : fresh.status === "stale" ? "warn" : "danger"}>{fresh.status === "ok" ? "Fresh" : fresh.status === "stale" ? "Stale" : "Missing"}</Badge>
              <Badge tone={fresh.market_open ? "accent" : "neutral"}>{fresh.market_open ? "Market open" : "Market closed"}</Badge>
              {fresh.is_fixture && <Badge tone="fixture">Fixture prices</Badge>}
              <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" busy={refresh.isPending} onClick={() => refresh.mutate()}
                title="Fetch the calendar, central-bank and headline feeds, and check the price source">
                {!refresh.isPending && <RefreshCw className="size-3.5" aria-hidden />}<span className="sr-only sm:not-sr-only">Fetch</span>
              </Button>
            </span>
          )}
        </Stat>
        <Stat label="Next high-impact release" icon={<CalendarClock className="size-3.5" />} tone={conflicts ? "danger" : undefined}
          foot={conflicts ? <span className="inline-flex items-center gap-1 text-danger"><AlertTriangle className="size-3" />{conflicts} source conflict{conflicts > 1 ? "s" : ""}: interpretation withheld</span>
            : other ? <span className="text-warn">{other} data warning{other > 1 ? "s" : ""}: see the evidence panel</span>
            : next ? `${next.time_eat} ${next.time_label} · consensus ${next.consensus ?? "n/a"}` : "Nothing scheduled in the stored calendar"}>
          {next ? <span className="flex items-center gap-1.5"><span className="num text-[12px] font-semibold text-accent">{next.currency}</span><span className="truncate">{next.title}</span></span>
            : <span className="text-muted">None this week</span>}
        </Stat>
      </div>
      {refresh.data && refresh.data.problems.length > 0 && (
        <p className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-warn-soft px-3 py-2 text-[12.5px] text-warn" role="status">
          Some sources could not be reached: {refresh.data.problems.join("; ")}</p>
      )}
      {refresh.error && <p className="text-[12.5px] text-danger">{String(refresh.error)}</p>}
    </div>
  );
}
