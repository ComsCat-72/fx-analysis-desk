import { after } from "next/server";
import { stamp } from "@/lib/dates.ts";
import { refreshPolicy, type PolicyDoc } from "@/lib/data/policy.ts";
import { json, read } from "@/lib/http.ts";
import { getJSON } from "@/lib/store.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Central-bank statements and speeches from the banks' own feeds. Refreshed in the background after 30 minutes. */
export const GET = read(async () => {
  const doc = (await getJSON<PolicyDoc>("policy.json")) ?? { refreshedAt: null, items: [], errors: [] };
  const stale = !doc.refreshedAt || Date.now() - doc.refreshedAt > 30 * 60_000;
  if (stale) after(() => refreshPolicy().then(() => undefined, () => undefined));
  return json({ refreshed_display: doc.refreshedAt ? stamp(doc.refreshedAt) : null, errors: doc.errors, refreshing: stale,
    items: doc.items.slice(0, 80).map((i) => ({ bank: i.bank, currency: i.currency, kind: i.kind, title: i.title, url: i.url, at_display: stamp(i.publishedAt) })) });
});
