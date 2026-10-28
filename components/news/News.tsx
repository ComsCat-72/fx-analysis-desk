"use client";

import { useQuery } from "@tanstack/react-query";
import { Newspaper } from "lucide-react";
import { useState } from "react";
import { api, friendlyError } from "../desk/api";
import { Badge, Empty, Panel, Spinner, cx } from "../desk/ui";

const FILTERS = ["All", "USD", "EUR", "GBP", "AUD", "NZD", "CHF", "XAU", "NAS100"];

export function News() {
  const [cur, setCur] = useState("All");
  const q = useQuery({ queryKey: ["headlines", cur], queryFn: () => api.headlines(cur === "All" ? undefined : cur),
    refetchInterval: (x) => (x.state.data?.refreshing ? 15_000 : 2 * 60_000), refetchIntervalInBackground: false });
  return (
    <Panel title="Headlines" icon={<Newspaper className="size-4" />} actions={
      <div className="flex flex-wrap gap-1" role="group" aria-label="Currency">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setCur(f)} aria-pressed={cur === f}
            className={cx("cursor-pointer rounded-md px-2 py-1 text-[12.5px] font-medium", cur === f ? "bg-accent-soft text-fg" : "text-muted hover:bg-surface-3 hover:text-fg")}>{f}</button>
        ))}
      </div>
    }>
      {q.isLoading ? <Spinner label="Loading headlines" /> : q.error || !q.data ? <p className="text-sm text-danger">{friendlyError(q.error)}</p> : (
        <>
          {!q.data.items.length ? <Empty>{q.data.refreshing ? "Fetching the feeds…" : "No headlines for this filter yet."}</Empty> : (
            <ul className="divide-y divide-line/60">
              {q.data.items.map((h) => (
                <li key={h.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-faint">
                    <span className="num">{h.at_display}</span><Badge tone="accent">{h.source}</Badge>{h.currencies.map((c) => <Badge key={c}>{c}</Badge>)}
                  </div>
                  {h.url ? <a className="mt-0.5 block text-[13.5px] hover:underline" href={h.url} target="_blank" rel="noreferrer">{h.title}</a> : <p className="mt-0.5 text-[13.5px]">{h.title}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="break-words pt-2 text-[12px] text-faint">
            Reuters (through Google News) and WSJ free RSS feeds: title, link and time only; article text is not fetched. Tagged by keywords in the title.
            {q.data.refreshed_display && <> Checked {q.data.refreshed_display}, every few minutes while this page is open.</>}
            {q.data.errors.length > 0 && <span className="text-warn"> Unavailable: {q.data.errors.join("; ")}.</span>}
          </p>
        </>
      )}
    </Panel>
  );
}
