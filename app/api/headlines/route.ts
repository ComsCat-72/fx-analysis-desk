import { after } from "next/server";
import { stamp } from "@/lib/dates.ts";
import { headlinesDoc, refreshHeadlines } from "@/lib/data/headlines.ts";
import { json, param, read } from "@/lib/http.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Stored headlines, newest first (?currency=GBP filters). Refreshed in the background when older than 5 minutes. */
export const GET = read(async (req) => {
  const doc = await headlinesDoc(), cur = param(req, "currency")?.toUpperCase();
  if (!doc.refreshedAt || Date.now() - doc.refreshedAt > 5 * 60_000) after(() => refreshHeadlines().then(() => undefined, () => undefined));
  const items = doc.items.filter((i) => !cur || i.currencies.includes(cur)).slice(0, 200);
  return json({ refreshed_display: doc.refreshedAt ? stamp(doc.refreshedAt) : null, errors: doc.errors, refreshing: !doc.refreshedAt || Date.now() - doc.refreshedAt > 5 * 60_000,
    items: items.map((i) => ({ id: i.id, source: i.sourceName, title: i.title, url: i.url, at: i.publishedAt, at_display: stamp(i.publishedAt), currencies: i.currencies })) });
});
