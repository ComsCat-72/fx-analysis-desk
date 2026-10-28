import { HttpError, json, param, read } from "@/lib/http.ts";
import { rate } from "@/lib/data/rates.ts";

export const dynamic = "force-dynamic";

/** ?pairs=EUR/USD,JPY/USD: the latest rate for each (units of the second currency per one unit of the first). */
export const GET = read(async (req) => {
  const pairs = (param(req, "pairs") ?? "").split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
  if (!pairs.length || pairs.length > 8 || pairs.some((p) => !/^[A-Z]{3}\/[A-Z]{3}$/.test(p))) throw new HttpError(400, "pairs must be up to 8 items like EUR/USD");
  const out = await Promise.all(pairs.map(async (p) => {
    const [a, b] = p.split("/");
    try { return { pair: p, ...(await rate(a, b)), error: null }; } catch (e) { return { pair: p, rate: null, error: (e as Error).message }; }
  }));
  return json(out);
});
