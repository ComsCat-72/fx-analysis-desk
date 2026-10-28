import { stamp } from "@/lib/dates.ts";
import { COT_PAGE, cot } from "@/lib/data/cot.ts";
import { json, read } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

/** Latest CFTC Commitments of Traders positions (stored; refreshed when older than 6 hours). */
export const GET = read(async () => {
  const d = await cot();
  return json({ ...d, fetched_display: d.fetchedAt ? stamp(d.fetchedAt) : null, source_url: COT_PAGE });
});
