import { addNews, newsItems } from "@/lib/data/policy.ts";
import { stamp } from "@/lib/dates.ts";
import { HttpError, body, json, read, write } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

export const GET = read(async () => json((await newsItems()).slice(0, 50).map((n) => ({ id: n.id, source_name: n.sourceName, title: n.title, url: n.url,
  entered_by: n.enteredBy, published_display: stamp(n.publishedAt), currencies: n.currencies }))));

export const POST = write(async (req) => {
  const b = await body<{ source_name: string; title: string; url?: string; published_at: string; summary?: string; currencies?: string[] }>(req);
  if (!b.source_name?.trim() || !b.title?.trim()) throw new HttpError(400, "source_name and title are required");
  if (!/([+-]\d{2}:?\d{2}|Z)$/.test(b.published_at ?? "") || Number.isNaN(Date.parse(b.published_at))) throw new HttpError(400, "published_at must include a timezone offset");
  const id = await addNews({ sourceName: b.source_name.trim(), title: b.title.trim(), url: b.url || null, publishedAt: Date.parse(b.published_at), summary: b.summary ?? null,
    currencies: (b.currencies ?? []).map((c) => c.toUpperCase()), enteredBy: "user" });
  return json({ id });
});
