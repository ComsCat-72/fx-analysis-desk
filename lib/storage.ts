// Report storage. Production: Vercel Blob (BLOB_READ_WRITE_TOKEN is added automatically when you
// connect a Blob store). Local development without a token: files under .data/.
import { list, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Kind } from "./config.ts";

export interface ReportMeta {
  instrument: string;
  kind: Kind;
  period: string; // YYYY-MM-DD (weekly kinds: Monday of the week)
  published: string; // ISO timestamp
  model: string;
  check: "ok" | "flagged";
}
export interface StoredReport { meta: ReportMeta; markdown: string; slug: string }

const LOCAL = path.join(process.cwd(), ".data", "reports");
const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const key = (inst: string, slug: string) => `reports/${inst}/${slug}.md`;
export const slugFor = (kind: Kind, period: string) => `${period}_${kind}`;

function serialise(r: StoredReport): string {
  return `---\n${JSON.stringify(r.meta)}\n---\n${r.markdown.trim()}\n`;
}

function parse(slug: string, raw: string): StoredReport | null {
  const m = raw.match(/^---\n(.*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  try {
    return { meta: JSON.parse(m[1]) as ReportMeta, markdown: m[2], slug };
  } catch {
    return null;
  }
}

export async function saveReport(r: StoredReport): Promise<void> {
  const body = serialise(r);
  if (useBlob()) {
    await put(key(r.meta.instrument, r.slug), body, {
      access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "text/markdown; charset=utf-8",
      cacheControlMaxAge: 60,
    });
    return;
  }
  await fs.mkdir(path.join(LOCAL, r.meta.instrument), { recursive: true });
  await fs.writeFile(path.join(LOCAL, r.meta.instrument, `${r.slug}.md`), body);
}

/** All stored report keys as {instrument, slug}; optionally for one instrument. */
export async function listReports(instrument?: string): Promise<{ instrument: string; slug: string; url?: string }[]> {
  if (useBlob()) {
    const out: { instrument: string; slug: string; url: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: instrument ? `reports/${instrument}/` : "reports/", cursor, limit: 1000 });
      for (const b of page.blobs) {
        const m = b.pathname.match(/^reports\/([^/]+)\/(.+)\.md$/);
        if (m) out.push({ instrument: m[1], slug: m[2], url: b.url });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out.sort((a, b) => a.slug.localeCompare(b.slug));
  }
  const out: { instrument: string; slug: string }[] = [];
  const insts = instrument ? [instrument] : await fs.readdir(LOCAL).catch(() => []);
  for (const i of insts) {
    for (const f of await fs.readdir(path.join(LOCAL, i)).catch(() => [] as string[])) {
      if (f.endsWith(".md")) out.push({ instrument: i, slug: f.slice(0, -3) });
    }
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function readReport(instrument: string, slug: string, url?: string): Promise<StoredReport | null> {
  if (useBlob()) {
    const href = url ?? (await listReports(instrument)).find((r) => r.slug === slug)?.url;
    if (!href) return null;
    const res = await fetch(href, { cache: "no-store" });
    return res.ok ? parse(slug, await res.text()) : null;
  }
  const raw = await fs.readFile(path.join(LOCAL, instrument, `${slug}.md`), "utf8").catch(() => null);
  return raw ? parse(slug, raw) : null;
}
