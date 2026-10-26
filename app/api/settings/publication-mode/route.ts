import { HttpError, body, json, write } from "@/lib/http.ts";
import { changeSettings } from "@/lib/settings.ts";

export const dynamic = "force-dynamic";

export const PUT = write(async (req) => {
  const b = await body<{ mode: string; confirm_automatic?: boolean }>(req);
  if (b.mode !== "manual" && b.mode !== "automatic") throw new HttpError(400, "mode must be manual or automatic");
  if (b.mode === "automatic" && !b.confirm_automatic) throw new HttpError(400, "automatic publication must be explicitly confirmed");
  await changeSettings((s) => { s.publication_mode = b.mode as "manual" | "automatic"; });
  return json({ mode: b.mode });
});
