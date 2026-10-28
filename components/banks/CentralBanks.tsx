"use client";

import { useQuery } from "@tanstack/react-query";
import { Landmark, Newspaper, RefreshCw } from "lucide-react";
import { api, friendlyError } from "../desk/api";
import { Badge, Button, Empty, Panel, Spinner, cx } from "../desk/ui";

const rate = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);
const bp = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v)} bp`;

function Rates() {
  const q = useQuery({ queryKey: ["banks"], queryFn: api.banks, staleTime: 10 * 60_000 });
  if (q.isLoading) return <Spinner label="Loading rate decisions" />;
  if (q.error || !q.data) return (
    <div className="flex flex-wrap items-center gap-3 p-4 text-sm text-danger">{friendlyError(q.error)}<Button size="sm" onClick={() => q.refetch()}><RefreshCw className="size-4" />Retry</Button></div>
  );
  const d = q.data;
  return (
    <div className="space-y-4">
      {d.error && <p className="text-[13px] text-warn">{d.error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="text-left text-[11.5px] uppercase tracking-wider text-faint">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">Bank</th><th className="px-2 font-medium text-right">Rate</th><th className="px-2 font-medium">Last decision</th>
              <th className="px-2 font-medium">Last change</th><th className="px-2 font-medium">Next decision</th><th className="pl-2 font-medium">Recent decisions</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.id} className="border-b border-line/60 align-top">
                <td className="py-2 pr-3"><div className="font-medium">{r.name} <span className="num text-faint">{r.currency}</span></div><div className="text-[12px] text-faint">{r.rate_name}</div></td>
                <td className="num px-2 py-2 text-right text-[15px] font-semibold">{rate(r.rate)}</td>
                <td className="px-2 py-2">
                  {r.rate_display ?? <span className="text-faint">not recorded yet</span>}
                  {r.awaiting_display && <div className="text-[12px] text-warn">Decision of {r.awaiting_display}: figure not published by the source yet</div>}
                </td>
                <td className="px-2 py-2">{r.last_change ? <><span className={cx("num font-medium", r.last_change.bp > 0 ? "text-ok" : "text-danger")}>{bp(r.last_change.bp)}</span> <span className="text-faint">{r.last_change.display}</span></> : <span className="text-faint">no change in the last year</span>}</td>
                <td className="px-2 py-2">{r.next_display ?? <span className="text-faint">not scheduled yet</span>}</td>
                <td className="num pl-2 py-2 text-[12px] text-muted">{r.history.slice(0, 4).map((h) => <span key={h.display} className="mr-2 whitespace-nowrap" title={h.display}>{rate(h.rate)}</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="mb-2 text-[13px] font-semibold">Rate differential</h3>
        <div className="flex flex-wrap gap-2">
          {d.differentials.map((x) => (
            <div key={x.pair} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
              <div className="num text-[12px] text-muted">{x.pair}</div>
              <div className={cx("num text-[15px] font-semibold", x.diff == null ? "text-faint" : x.diff > 0 ? "text-ok" : x.diff < 0 ? "text-danger" : "")}>
                {x.diff == null ? "—" : `${x.diff > 0 ? "+" : x.diff < 0 ? "−" : ""}${Math.abs(x.diff).toFixed(2)} pp`}
              </div>
              <div className="text-[11.5px] text-faint">{x.base} rate minus {x.quote} rate</div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[12px] text-faint">
        Decisions from the <a className="underline" href="https://biquote.io" target="_blank" rel="noreferrer">biquote.io</a> free economic calendar; a decision released in the last
        weeks is taken from the calendar's actual (<a className="underline" href="https://www.fxstreet.com/economic-calendar" target="_blank" rel="noreferrer">FXStreet</a>) when biquote has
        not filled it yet. Nothing is estimated.{d.fetched_display && <> Decisions fetched {d.fetched_display}.</>}
      </p>
    </div>
  );
}

function Statements() {
  const q = useQuery({ queryKey: ["policy"], queryFn: api.policy, refetchInterval: (x) => (x.state.data?.refreshing ? 15_000 : 10 * 60_000), refetchIntervalInBackground: false });
  if (q.isLoading) return <Spinner label="Loading statements" />;
  if (q.error || !q.data) return <p className="text-sm text-danger">{friendlyError(q.error)}</p>;
  if (!q.data.items.length) return <Empty>{q.data.refreshing ? "Fetching the central banks' feeds…" : "No statements stored yet."}</Empty>;
  return (
    <>
      <ul className="divide-y divide-line/60">
        {q.data.items.map((i, n) => (
          <li key={n} className="py-2">
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-faint">
              <span className="num">{i.at_display}</span><Badge>{i.bank.toUpperCase()}</Badge><Badge tone={i.kind === "decision" ? "accent" : "neutral"}>{i.kind}</Badge>
            </div>
            {i.url ? <a className="mt-0.5 block text-[13px] hover:underline" href={i.url} target="_blank" rel="noreferrer">{i.title}</a> : <p className="mt-0.5 text-[13px]">{i.title}</p>}
          </li>
        ))}
      </ul>
      <p className="break-words pt-2 text-[12px] text-faint">From the banks' official RSS feeds, title and link only.{q.data.refreshed_display && <> Checked {q.data.refreshed_display}.</>}
        {q.data.errors.length > 0 && <span className="text-warn"> Unavailable: {q.data.errors.join("; ")}.</span>}</p>
    </>
  );
}

export function CentralBanks() {
  return (
    <div className="flex flex-col gap-3">
      <Panel title="Policy rates" icon={<Landmark className="size-4" />}><Rates /></Panel>
      <Panel title="Statements and speeches" icon={<Newspaper className="size-4" />}><Statements /></Panel>
    </div>
  );
}
