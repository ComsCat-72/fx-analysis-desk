import { KIND_LABEL, type Kind } from "./config.ts";
import { listReports } from "./storage.ts";

const ORDER: Record<Kind, number> = { weekly_analysis: 0, daily_analysis: 1, daily_review: 2, weekly_review: 3 };

export interface Entry { instrument: string; slug: string; period: string; kind: Kind; label: string }

/** Stored reports, newest first, for display. */
export async function entries(instrument?: string): Promise<Entry[]> {
  const rows = await listReports(instrument);
  return rows
    .map((r) => {
      const kind = r.slug.slice(11) as Kind;
      return { instrument: r.instrument, slug: r.slug, period: r.slug.slice(0, 10), kind, label: KIND_LABEL[kind] ?? kind };
    })
    .sort((a, b) => (a.period === b.period ? ORDER[b.kind] - ORDER[a.kind] : a.period < b.period ? 1 : -1));
}
