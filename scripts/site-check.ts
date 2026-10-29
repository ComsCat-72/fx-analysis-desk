// Measures the deployed site from an open network (CI): status, timing, cache headers and the start of each body,
// three tries per endpoint. GET only, no secrets. Writes out/site.json.
//   SITE_URL=https://example.vercel.app node --experimental-strip-types scripts/site-check.ts
import { mkdirSync, writeFileSync } from "node:fs";

const base = (process.env.SITE_URL || "https://fx-analysis-desk.vercel.app").replace(/\/$/, "");
const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const today = day(0), wd = new Date().getUTCDay();
const weekFrom = day(-wd), weekTo = day(6 - wd);
const monthFrom = `${today.slice(0, 8)}01`, monthTo = day(30).slice(0, 8) + "01";
const paths = [
  "/api/health", "/api/config",
  `/api/calendar/range?from=${weekFrom}&to=${weekTo}&currencies=&impacts=`,
  `/api/calendar/range?from=${today}&to=${today}&currencies=&impacts=`,
  `/api/calendar/range?from=${monthFrom}&to=${monthTo}&currencies=&impacts=&shape=dates`,
  "/api/markets/strength", "/api/banks",
];
const out: Record<string, unknown> = { at: new Date().toISOString(), base };
try {
  const html = await (await fetch(`${base}/`, { signal: AbortSignal.timeout(30_000) })).text();
  out.build = { buildId: html.match(/"buildId":"([^"]+)"/)?.[1] ?? html.match(/\/_next\/static\/([^/]+)\/_buildManifest/)?.[1] ?? null, bytes: html.length };
} catch (e) { out.build = { error: (e as Error).message }; }
const H = ["server-timing", "x-vercel-id", "x-vercel-cache", "age", "cache-control", "content-type"];
for (const p of paths) {
  const tries = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    try {
      const r = await fetch(base + p, { headers: { "X-Display-TZ": "Africa/Kampala" }, signal: AbortSignal.timeout(60_000) });
      const body = await r.text();
      tries.push({ status: r.status, ms: Date.now() - t, headers: Object.fromEntries(H.map((h) => [h, r.headers.get(h)])), bytes: body.length, body: body.slice(0, 800) });
    } catch (e) { tries.push({ error: (e as Error).message, ms: Date.now() - t }); }
  }
  out[p] = tries;
}
mkdirSync("out", { recursive: true });
writeFileSync("out/site.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 5000));
