// JSON document store: Vercel Blob in deployments (BLOB_READ_WRITE_TOKEN), a local .data/ folder otherwise.
// - getJSON(): a short per-instance read cache, and a time limit on Blob reads.
// - update(): read-modify-write with an ETag precondition and retries, so concurrent writers never lose updates.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export class ImmutableError extends Error {}
export const STORAGE_MISSING = "No storage connected: data cannot be saved. In Vercel open Storage → Create → Blob, connect the store to this project, then redeploy.";
export class StorageMissing extends Error { constructor() { super(STORAGE_MISSING); } }

/** The Blob token: BLOB_READ_WRITE_TOKEN, or <PREFIX>_READ_WRITE_TOKEN when the store was connected with a custom prefix. */
export function blobToken(): string | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  return Object.entries(process.env).find(([k, v]) => k.endsWith("_READ_WRITE_TOKEN") && v?.startsWith("vercel_blob_rw_"))?.[1];
}
class PreconditionFailed extends Error {}
export class StorageSlow extends Error { constructor() { super("Storage is slow to answer (Vercel Blob); please try again in a moment."); } }
const READ_LIMIT_MS = () => Number(process.env.STORE_READ_LIMIT_MS) || 6000;

interface Backend {
  read(p: string): Promise<{ text: string; etag: string } | null>;
  write(p: string, body: string | Buffer, o: { create?: boolean; etag?: string; contentType?: string }): Promise<{ url: string }>;
  list(prefix: string): Promise<string[]>;
  del(p: string): Promise<void>;
  url(p: string): Promise<string | null>;
}

// A store's access mode is fixed when it is created. BLOB_ACCESS states it; if it is unset or wrong, the first
// access-mismatch error from the Blob API flips it for the rest of the process.
let accessMode: "public" | "private" = process.env.BLOB_ACCESS === "private" ? "private" : "public";
const blobAccess = () => accessMode;
const accessMismatch = (e: unknown) => /\b(?:private|public)\b/i.test(String((e as Error)?.message ?? "")) && /access|store/i.test(String((e as Error)?.message ?? ""));
async function withAccess<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (!accessMismatch(e)) throw e;
    accessMode = accessMode === "public" ? "private" : "public";
    return fn();
  }
}
const sameTag = (a: string, b: string) => a.replace(/^W\//, "").replace(/"/g, "") === b.replace(/^W\//, "").replace(/"/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const notFound = (e: unknown) => (e as Error)?.constructor?.name === "BlobNotFoundError" || /does not exist/i.test(String((e as Error)?.message ?? ""));

/** Current content and ETag. Public blobs are served through a CDN that may hold a copy for up to a minute, and the
 *  SDK only bypasses that cache for private stores, so public reads ask the API for the current ETag (head) and fetch
 *  that exact version with a version-specific URL. */
async function readBlob(p: string): Promise<{ body: Response; etag: string } | null> {
  const { get, head } = await import("@vercel/blob");
  const token = blobToken();
  if (blobAccess() === "private") {
    const r = await withAccess(() => get(p, { access: blobAccess(), useCache: false, token }));
    return r?.stream ? { body: new Response(r.stream), etag: r.blob.etag } : null;
  }
  let meta;
  try { meta = await head(p, { token }); } catch (e) { if (notFound(e)) return null; throw e; }
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${meta.url}?v=${encodeURIComponent(meta.etag)}${i ? `-${i}` : ""}`, { cache: "no-store" });
    if (r.ok && sameTag(r.headers.get("etag") ?? meta.etag, meta.etag)) return { body: r, etag: meta.etag };
    await r.body?.cancel();
    await sleep(150 * (i + 1));
  }
  const r = await withAccess(() => get(p, { access: blobAccess(), useCache: false, token }));
  return r?.stream ? { body: new Response(r.stream), etag: r.blob.etag } : null;
}

/** Diagnostics: each step of a Blob read (head, version-specific fetch, SDK get) with its time and outcome, each step
 *  limited to 8 s. Reads only. */
export async function probeRead(p: string) {
  if (!blobToken()) return { storage: storageMode() };
  const { get, head } = await import("@vercel/blob");
  const step = async (name: string, fn: () => Promise<unknown>) => {
    const t = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const v = await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("no answer within 8 s")), 8000); })]);
      return { name, ms: Date.now() - t, ok: true, result: v };
    } catch (e) { return { name, ms: Date.now() - t, ok: false, error: `${(e as Error).name}: ${(e as Error).message}`.slice(0, 300) }; }
    finally { clearTimeout(timer); }
  };
  const steps = [];
  let meta: { url: string; etag: string } | null = null;
  steps.push(await step("head", async () => { const m = await head(p, { token: blobToken() }); meta = { url: m.url, etag: m.etag }; return { etag: m.etag, size: m.size, uploadedAt: m.uploadedAt }; }));
  const m = meta as { url: string; etag: string } | null;
  if (m) {
    steps.push(await step("fetch versioned", async () => {
      const r = await fetch(`${m.url}?v=${encodeURIComponent(m.etag)}`, { cache: "no-store" });
      const text = await r.text();
      return { status: r.status, etag: r.headers.get("etag"), age: r.headers.get("age"), cache: r.headers.get("x-vercel-cache"), bytes: text.length, matches: sameTag(r.headers.get("etag") ?? "", m.etag) };
    }));
  }
  steps.push(await step("sdk get", async () => {
    const r = await get(p, { access: blobAccess(), useCache: false, token: blobToken() });
    return r ? { status: r.statusCode, etag: r.blob.etag, bytes: r.stream ? (await new Response(r.stream).text()).length : null } : null;
  }));
  return { path: p, access: blobAccess(), steps };
}

function blobBackend(): Backend {
  // Imported lazily so local development and tests never need the SDK configured.
  const sdk = import("@vercel/blob");
  return {
    async read(p) {
      // A slow or rate-limited store must not hold a page: give up after READ_LIMIT_MS with a clear message.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new StorageSlow()), READ_LIMIT_MS()); });
      try {
        return await Promise.race([limit, readBlob(p).then(async (r) => (r ? { text: await r.body.text(), etag: r.etag } : null))]);
      } finally { clearTimeout(timer); }
    },
    async write(p, body, o) {
      const { put } = await sdk;
      try {
        const r = await withAccess(() => put(p, body, {
          access: blobAccess(), token: blobToken(), addRandomSuffix: false, contentType: o.contentType ?? "application/json",
          cacheControlMaxAge: 60, ...(o.create ? { allowOverwrite: false } : o.etag ? { ifMatch: o.etag } : { allowOverwrite: true }),
        }));
        return { url: r.url };
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (o.create && /exist/i.test(msg)) throw new ImmutableError(`${p} already exists and cannot be overwritten`);
        if (o.etag && ((e as Error)?.constructor?.name === "BlobPreconditionFailedError" || /precondition failed|\b412\b/i.test(msg))) throw new PreconditionFailed(p);
        throw e;
      }
    },
    async list(prefix) {
      const { list } = await sdk;
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const r = await list({ prefix, cursor, limit: 1000, token: blobToken() });
        out.push(...r.blobs.map((b) => b.pathname));
        cursor = r.hasMore ? r.cursor : undefined;
      } while (cursor);
      return out;
    },
    async del(p) {
      const { del } = await sdk;
      await del(p, { token: blobToken() });
    },
    async url(p) {
      const { head } = await sdk;
      try { return (await head(p, { token: blobToken() })).url; } catch { return null; }
    },
  };
}

/** On Vercel without Blob the filesystem is read-only: reads find nothing, writes explain what is missing. */
function missingBackend(): Backend {
  return {
    async read() { return null; },
    async write() { throw new StorageMissing(); },
    async list() { return []; },
    async del() { /* nothing stored */ },
    async url() { return null; },
  };
}

function fsBackend(root: string): Backend {
  const file = (p: string) => path.join(/*turbopackIgnore: true*/ root, p);
  const tag = (s: string | Buffer) => createHash("sha1").update(s).digest("hex");
  return {
    async read(p) {
      try { const text = await fs.readFile(file(p), "utf8"); return { text, etag: tag(text) }; } catch { return null; }
    },
    async write(p, body, o) {
      await fs.mkdir(path.dirname(file(p)), { recursive: true });
      if (o.create) {
        try { await fs.writeFile(file(p), body, { flag: "wx" }); } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new ImmutableError(`${p} already exists and cannot be overwritten`);
          throw e;
        }
      } else {
        if (o.etag) {
          const cur = await this.read(p);
          if (cur && cur.etag !== o.etag) throw new PreconditionFailed(p);
        }
        await fs.writeFile(file(p), body);
      }
      return { url: `/api/files/${p}` };
    },
    async list(prefix) {
      const out: string[] = [];
      async function walk(dir: string) {
        let ents: import("node:fs").Dirent[] = [];
        try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) await walk(full);
          else out.push(path.relative(root, full).split(path.sep).join("/"));
        }
      }
      await walk(root);
      return out.filter((p) => p.startsWith(prefix)).sort();
    },
    async del(p) { await fs.rm(file(p), { force: true }); },
    async url(p) { try { await fs.access(file(p)); return `/api/files/${p}`; } catch { return null; } },
  };
}

const localRoot = () => process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), ".data");

let backend: Backend | null = null;
export function store(): Backend {
  if (!backend) backend = blobToken() ? blobBackend() : process.env.VERCEL ? missingBackend() : fsBackend(localRoot());
  return backend;
}
/** For tests: point the store at a fresh local directory. */
export function useLocalStore(dir: string) { backend = fsBackend(dir); }
export const storageMode = () => (blobToken() ? "vercel-blob" : process.env.VERCEL ? "none" : "local-files");

// Reads are kept for a few seconds per server instance, so a burst of requests (calendar, month grid, sync)
// reads each document once. This instance's own writes clear it; update() always reads fresh.
const CACHE_MS = 5000;
const cache = new Map<string, { at: number; text: string | null }>();
export const clearReadCache = () => cache.clear();

export async function getJSON<T>(p: string): Promise<T | null> {
  const hit = cache.get(p);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text == null ? null : (JSON.parse(hit.text) as T);
  const r = await store().read(p);
  cache.set(p, { at: Date.now(), text: r?.text ?? null });
  return r ? (JSON.parse(r.text) as T) : null;
}

export async function putJSON(p: string, data: unknown): Promise<void> {
  cache.delete(p);
  await store().write(p, JSON.stringify(data), {});
}

/** Read-modify-write with optimistic concurrency. `fn` may mutate and/or return the new value. */
export async function update<T>(p: string, init: () => T, fn: (cur: T) => T | void): Promise<T> {
  let last = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await store().read(p);
    const cur = r ? (JSON.parse(r.text) as T) : init();
    const next = (fn(cur) ?? cur) as T;
    try {
      cache.delete(p);
      await store().write(p, JSON.stringify(next), r ? { etag: r.etag } : {});
      return next;
    } catch (e) {
      if (!(e instanceof PreconditionFailed)) throw e;
      last = "the stored copy changed between reading and writing";
      await new Promise((res) => setTimeout(res, 150 * (attempt + 1) + Math.random() * 200));
    }
  }
  throw new Error(`could not save ${p}: the store kept rejecting the update (${last}); please try again`);
}

