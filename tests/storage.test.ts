// Storage selection on Vercel: a prefixed Blob token is found; without one, saves fail with a clear message.
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (k.endsWith("_READ_WRITE_TOKEN")) delete process.env[k];
const { blobToken, storageMode, store, putJSON, getJSON, STORAGE_MISSING } = await import("../lib/store.ts");

test("a Blob store connected with a custom prefix is still found", () => {
  process.env.CUSTOM_READ_WRITE_TOKEN = "vercel_blob_rw_x";
  assert.equal(blobToken(), "vercel_blob_rw_x");
  assert.equal(storageMode(), "vercel-blob");
  process.env.OTHER_READ_WRITE_TOKEN = "not-a-blob-token";
  delete process.env.CUSTOM_READ_WRITE_TOKEN;
  assert.equal(blobToken(), undefined, "only values that look like Blob tokens count");
  delete process.env.OTHER_READ_WRITE_TOKEN;
});

test("on Vercel without Blob, reads find nothing and saves explain what is missing", async () => {
  process.env.VERCEL = "1";
  assert.equal(storageMode(), "none");
  store(); // first use picks the backend
  assert.equal(await getJSON("settings.json"), null);
  await assert.rejects(putJSON("settings.json", {}), (e: Error) => e.message === STORAGE_MISSING);
  delete process.env.VERCEL;
});
