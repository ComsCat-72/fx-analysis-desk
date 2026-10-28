// Reuters and WSJ headlines from free RSS feeds: title, link and publication time only. Article text is never
// fetched or summarised, so a report can say what a headline reported, not what the article argued.
// Items are tagged with currencies by keyword; untagged items are dropped. Stored with their publication time so a
// report only sees headlines published before its cutoff.
import { CONFIG } from "../config.ts";
import { getJSON, update } from "../store.ts";
import { parseFeed, type NewsItem } from "./policy.ts";

export interface HeadlinesDoc { refreshedAt: number | null; items: NewsItem[]; errors: string[] }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEYWORDS = Object.entries(CONFIG.headlines.currencyKeywords).map(([cur, words]) =>
  [cur, new RegExp(`(?<![a-z])(?:${words.map(esc).join("|")})(?![a-z])`, "i")] as const);

export function tagCurrencies(title: string): string[] {
  return KEYWORDS.filter(([, re]) => re.test(title)).map(([cur]) => cur);
}

/** Google News titles end with " - Reuters"; the source is recorded separately. */
const cleanTitle = (t: string, source: string) => t.replace(new RegExp(`\\s+[-–]\\s+${esc(source)}\\s*$`, "i"), "").trim();

export function parseHeadlines(source: string, name: string, xml: string, feedUrl: string): NewsItem[] {
  return parseFeed(source, "", "press", xml, feedUrl).flatMap((p) => {
    const title = cleanTitle(p.title, source);
    const currencies = tagCurrencies(title);
    if (!currencies.length) return [];
    return [{ id: `h${p.publishedAt.toString(36)}${hash(p.url ?? title)}`, sourceName: source, title, url: p.url, publishedAt: p.publishedAt,
      summary: null, currencies, enteredBy: "feed" as const, feed: name } as NewsItem];
  });
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function refreshHeadlines(now = Date.now()): Promise<{ stored: number; errors: string[] }> {
  const results = await Promise.all(CONFIG.headlines.feeds.map(async (f) => {
    try {
      const r = await fetch(f.url, { headers: { "User-Agent": "fx-analysis-desk/1.0" }, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!r.ok) return { items: [], error: `${f.name}: HTTP ${r.status}` };
      return { items: parseHeadlines(f.source, f.name, await r.text(), f.url), error: null };
    } catch (e) { return { items: [], error: `${f.name}: ${(e as Error).message}` }; }
  }));
  const fresh = results.flatMap((r) => r.items);
  const errors = results.flatMap((r) => (r.error ? [r.error] : []));
  const keepFrom = now - CONFIG.headlines.keepDays * 86400_000;
  await update<HeadlinesDoc>("headlines.json", () => ({ refreshedAt: null, items: [], errors: [] }), (doc) => {
    const seen = new Map(doc.items.map((i) => [`${i.sourceName}|${i.title.toLowerCase()}`, i]));
    for (const i of fresh) { const k = `${i.sourceName}|${i.title.toLowerCase()}`; if (!seen.has(k)) seen.set(k, i); }
    doc.items = [...seen.values()].filter((i) => i.publishedAt >= keepFrom && i.publishedAt <= now + 3600_000).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 1500);
    doc.refreshedAt = now;
    doc.errors = errors;
  });
  return { stored: fresh.length, errors };
}

export const headlineItems = async () => (await getJSON<HeadlinesDoc>("headlines.json"))?.items ?? [];
export const headlinesDoc = async () => (await getJSON<HeadlinesDoc>("headlines.json")) ?? { refreshedAt: null, items: [], errors: [] };
