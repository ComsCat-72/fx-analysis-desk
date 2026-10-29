// The Vercel Blob backend against a fake SDK and a CDN that serves stale copies (public stores cache reads).
import assert from "node:assert/strict";
import { mock, test } from "node:test";

class BlobNotFoundError extends Error {}
class BlobPreconditionFailedError extends Error {}
const blobs = new Map<string, { body: string; etag: string; url: string }>();
const cdn = new Map<string, { body: string; etag: string }>(); // what the CDN still serves per url
let n = 0;
let failNext: Error | null = null;
let heads = 0, hangHead = false;
mock.module("@vercel/blob", { namedExports: {
  head: async (p: string) => { heads++; if (hangHead) return new Promise(() => {}); const b = blobs.get(p); if (!b) throw new BlobNotFoundError("The requested blob does not exist"); return { url: b.url, etag: b.etag }; },
  get: async (p: string) => { const b = blobs.get(p); return b ? { stream: new Response(b.body).body, blob: { etag: b.etag } } : null; },
  put: async (p: string, body: string, o: { ifMatch?: string; allowOverwrite?: boolean }) => {
    if (failNext) { const e = failNext; failNext = null; throw e; }
    const cur = blobs.get(p);
    if (o.ifMatch && cur?.etag !== o.ifMatch) throw new BlobPreconditionFailedError("Precondition failed: ETag mismatch.");
    if (cur && o.allowOverwrite === false) throw new Error("This blob already exists");
    const b = { body: String(body), etag: `"e${++n}"`, url: `https://store.public.blob.vercel-storage.com/${p}` };
    blobs.set(p, b);
    if (!cdn.has(b.url)) cdn.set(b.url, { body: b.body, etag: b.etag }); // first version gets cached
    return { url: b.url };
  },
  list: async () => ({ blobs: [...blobs.keys()].map((pathname) => ({ pathname })), hasMore: false }),
  del: async (p: string) => { blobs.delete(p); },
} });
// A CDN that ignores nothing: a plain URL returns its cached (possibly stale) copy; a version-specific URL misses the cache.
globalThis.fetch = (async (input: string) => {
  const [url, q] = input.split("?");
  const b = [...blobs.values()].find((x) => x.url === url);
  const served = !q ? cdn.get(url) : b;
  return new Response(served?.body ?? "", { status: served ? 200 : 404, headers: { etag: served?.etag ?? "" } });
}) as typeof fetch;

process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
const { getJSON, update, putJSON } = await import("../lib/store.ts");

test("public store: reads return the latest version even while the CDN holds an old copy", async () => {
  await putJSON("index/X.json", { v: 1 });
  await putJSON("index/X.json", { v: 2 }); // the CDN still has v1 for the plain URL
  assert.deepEqual(await getJSON("index/X.json"), { v: 2 });
  assert.equal(await getJSON("missing.json"), null);
});

test("read-modify-write updates do not fail on a stale CDN copy, and retry real conflicts", async () => {
  for (let i = 0; i < 5; i++) await update<{ n: number }>("counter.json", () => ({ n: 0 }), (d) => { d.n++; });
  assert.deepEqual(await getJSON("counter.json"), { n: 5 });
  let raced = false;
  await update<{ n: number }>("counter.json", () => ({ n: 0 }), (d) => {
    if (!raced) { raced = true; blobs.set("counter.json", { ...blobs.get("counter.json")!, etag: `"other${++n}"` }); } // another writer got in first
    d.n++;
  });
  assert.equal((await getJSON<{ n: number }>("counter.json"))!.n, 6);
});

test("other storage errors keep their own message", async () => {
  failNext = new Error("This store has been suspended.");
  await assert.rejects(update("counter.json", () => ({ n: 0 }), () => undefined), /suspended/);
});

test("reads are cached for a few seconds and a write clears the cache", async () => {
  await putJSON("cache/a.json", { v: 1 });
  heads = 0;
  assert.deepEqual(await getJSON("cache/a.json"), { v: 1 });
  assert.deepEqual(await getJSON("cache/a.json"), { v: 1 });
  assert.equal(heads, 1, "second read served from the cache");
  await putJSON("cache/a.json", { v: 2 });
  assert.deepEqual(await getJSON("cache/a.json"), { v: 2 }, "own write is visible at once");
});

test("a store that never answers fails fast with a clear message instead of hanging the page", async () => {
  process.env.STORE_READ_LIMIT_MS = "150";
  hangHead = true;
  const t = Date.now();
  await assert.rejects(getJSON("slow/never.json"), /Storage is slow to answer/);
  assert.ok(Date.now() - t < 2000);
  hangHead = false; delete process.env.STORE_READ_LIMIT_MS;
});
