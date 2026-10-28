import { stamp } from "@/lib/dates.ts";
import { correlations } from "@/lib/data/correlation.ts";
import { HttpError, json, read } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

/** Correlation of daily returns over 20 and 60 trading days (cached for an hour). */
export const GET = read(async () => {
  try { const v = await correlations(); return json({ ...v, as_of_display: stamp(v.as_of) }); }
  catch (e) { throw new HttpError(502, (e as Error).message); }
});
