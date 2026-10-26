// Central-bank press releases and speeches from the banks' official RSS/Atom feeds, plus news headlines you
// enter yourself. Both are stored with their publication time so a report only sees items published before its cutoff.
import { CONFIG } from "../config.ts";
import { getJSON, update } from "../store.ts";

export interface PolicyItem { bank: string; currency: string; kind: string; title: string; url: string | null; publishedAt: number; summary: string | null; source: string }
export interface NewsItem { id: string; sourceName: string; title: string; url: string | null; publishedAt: number; summary: string | null; currencies: string[]; enteredBy: "user" | "research" }

const DECISION = ["monetary policy decision", "policy decision", "official cash rate", "rate decision", "fomc statement", "monetary policy statement", "bank rate"];

export function classify(hint: string, title: string): string {
  const t = title.toLowerCase();
  if (DECISION.some((w) => t.includes(w))) return "decision";
  if (hint === "speech" || t.includes("speech") || t.includes("remarks")) return "speech";
  if (t.includes("minutes")) return "minutes";
  return "press";
}

/** Keep items that bear on policy, the economy or markets; drop administrative notices. */
export function isMonetaryPolicy(kind: string, title: string): boolean {
  const t = title.toLowerCase();
  if (kind === "decision" || kind === "speech") return true;
  if (["banknote", "enforcement action", "job vacanc", "appointment of", "cybersecurity", "consultation on", "supervisory",
    "regulators unveil", "bank holiday"].some((w) => t.includes(w))) return false;
  return ["monetary", "policy", "rate", "inflation", "fomc", "mpc", "minutes of the monetary", "economic", "outlook", "statement",
    "financial stability", "beige book", "projections", "governor", "chair", "president lagarde", "bulletin"].some((w) => t.includes(w));
}

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : null;
}

/** RSS 2.0 <item> and Atom <entry>. Entries without a timezone-qualified date are skipped, never guessed. */
export function parseFeed(bank: string, currency: string, hint: string, xml: string, source: string): PolicyItem[] {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return blocks.flatMap((b) => {
    const title = tag(b, "title") ?? "";
    const link = tag(b, "link") || b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || null;
    const when = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    if (!title || !when || !/(GMT|UTC|Z|[+-]\d{2}:?\d{2}|\b[ECMP][SD]T)\s*$/i.test(when)) return [];
    const t = Date.parse(when);
    if (Number.isNaN(t)) return [];
    const summary = tag(b, "description") ?? tag(b, "summary");
    return [{ bank, currency, kind: classify(hint, title), title, url: link, publishedAt: t, summary: summary ? summary.slice(0, 1500) : null, source }];
  });
}

export interface PolicyDoc { refreshedAt: number | null; items: PolicyItem[]; errors: string[] }

export async function refreshPolicy(now = Date.now()): Promise<{ stored: number; errors: string[] }> {
  const results = await Promise.all(Object.entries(CONFIG.centralBanks).flatMap(([bank, c]) =>
    Object.entries(c.feeds).map(async ([hint, url]) => {
      try {
        const r = await fetch(url, { headers: { "User-Agent": "fx-analysis-desk/1.0" }, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(15000) });
        if (!r.ok) return { items: [], error: `${bank} ${hint}: HTTP ${r.status}` };
        return { items: parseFeed(bank, c.currency, hint, await r.text(), url), error: null };
      } catch (e) { return { items: [], error: `${bank} ${hint}: ${(e as Error).message}` }; }
    })));
  const fresh = results.flatMap((r) => r.items);
  const errors = results.flatMap((r) => (r.error ? [r.error] : []));
  const keepFrom = now - 45 * 86400_000;
  await update<PolicyDoc>("policy.json", () => ({ refreshedAt: null, items: [], errors: [] }), (doc) => {
    const seen = new Map(doc.items.map((i) => [`${i.bank}|${i.url ?? i.title}`, i]));
    for (const i of fresh) seen.set(`${i.bank}|${i.url ?? i.title}`, i);
    doc.items = [...seen.values()].filter((i) => i.publishedAt >= keepFrom).sort((a, b) => b.publishedAt - a.publishedAt);
    doc.refreshedAt = now;
    doc.errors = errors;
  });
  return { stored: fresh.length, errors };
}

export const policyItems = async () => (await getJSON<PolicyDoc>("policy.json"))?.items ?? [];
export const newsItems = async () => (await getJSON<{ items: NewsItem[] }>("news.json"))?.items ?? [];

export async function addNews(n: Omit<NewsItem, "id">): Promise<string> {
  const id = `n${n.publishedAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await update<{ items: NewsItem[] }>("news.json", () => ({ items: [] }), (doc) => {
    doc.items = [{ ...n, id }, ...doc.items].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 400);
  });
  return id;
}
