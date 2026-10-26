import { CONFIG } from "@/lib/config.ts";
import { HttpError, json, write } from "@/lib/http.ts";
import { readScreenshot } from "@/lib/reports/claude.ts";
import { putFile, update } from "@/lib/store.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

/** Store a chart screenshot; optionally read visible levels with Claude. Readings never become levels until confirmed. */
export const POST = write(async (req) => {
  const fd = await req.formData();
  const inst = String(fd.get("instrument") ?? ""), file = fd.get("file"), extract = String(fd.get("extract")) === "true";
  if (!CONFIG.instruments[inst]) throw new HttpError(400, "unknown instrument");
  if (!(file instanceof File)) throw new HttpError(400, "file is required");
  if (file.size > 4 * 1024 * 1024) throw new HttpError(413, "screenshot larger than 4 MB");
  const ext = TYPES[file.type as keyof typeof TYPES];
  if (!ext) throw new HttpError(415, "PNG, JPEG or WebP only");
  const data = Buffer.from(await file.arrayBuffer());
  const id = `${inst}-${Date.now().toString(36)}`;
  const url = await putFile(`screenshots/${inst}/${id}.${ext}`, data, file.type);
  const extracted = extract ? await readScreenshot(data, file.type as keyof typeof TYPES) : { status: "manual_entry_required" };
  await update<{ items: unknown[] }>(`screenshots/${inst}.json`, () => ({ items: [] }), (d) => { d.items.unshift({ id, url, extracted, status: "needs_confirmation", uploaded_at: Date.now() }); });
  return json({ id, extracted });
});
