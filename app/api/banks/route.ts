import { stamp } from "@/lib/dates.ts";
import { banks } from "@/lib/data/banks.ts";
import { json, read } from "@/lib/http.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const d = (t: number | null) => (t ? stamp(t) : null);

/** Policy rates of the eight central banks, their last change and next scheduled decision. */
export const GET = read(async () => {
  const v = await banks();
  return json({ ...v, fetched_display: d(v.fetched_at), rows: v.rows.map((r) => ({ ...r, rate_display: d(r.rate_at), awaiting_display: d(r.awaiting_at), next_display: d(r.next_at),
    last_change: r.last_change && { ...r.last_change, display: stamp(r.last_change.at, { date: true }) }, history: r.history.map((h) => ({ ...h, display: stamp(h.at) })) })) });
});
