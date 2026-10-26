import { dictionary } from "@/lib/content/terminology.ts";
import { HttpError, body, json, read, write } from "@/lib/http.ts";
import { changeSettings, getSettings, type TermEdit } from "@/lib/settings.ts";

export const dynamic = "force-dynamic";

export const GET = read(async () => json(dictionary((await getSettings()).terms)));

export const POST = write(async (req) => {
  const b = await body<Omit<TermEdit, "at">>(req);
  if (!["approved", "prohibited", "abbreviation"].includes(b.kind) || !b.term?.trim()) throw new HttpError(400, "kind and term are required");
  await changeSettings((s) => { s.terms = [...s.terms.filter((t) => !(t.kind === b.kind && t.term === b.term)), { ...b, enabled: b.enabled ?? true, at: Date.now() }]; });
  return json({ ok: true });
});
