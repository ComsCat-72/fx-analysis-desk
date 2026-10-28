import { HttpError, json, param, read } from "@/lib/http.ts";
import { previousPeriod } from "@/lib/data/rates.ts";

export const dynamic = "force-dynamic";

/** ?pair=EUR/USD&period=daily|weekly|monthly: the last completed period's open, high, low and close. */
export const GET = read(async (req) => {
  const pair = (param(req, "pair") ?? "").toUpperCase(), period = param(req, "period") ?? "daily";
  if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(pair) || !["daily", "weekly", "monthly"].includes(period)) throw new HttpError(400, "pair (like EUR/USD) and period (daily, weekly or monthly) are required");
  try { return json(await previousPeriod(pair, period as "daily" | "weekly" | "monthly")); } catch (e) { throw new HttpError(502, (e as Error).message); }
});
