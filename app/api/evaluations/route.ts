import { CONFIG } from "@/lib/config.ts";
import { HttpError, json, param, read } from "@/lib/http.ts";
import { evaluationsFor } from "@/lib/views.ts";

export const dynamic = "force-dynamic";

export const GET = read(async (req) => {
  const inst = param(req, "instrument") ?? "";
  if (!CONFIG.instruments[inst]) throw new HttpError(400, "unknown instrument");
  return json(await evaluationsFor(inst));
});
