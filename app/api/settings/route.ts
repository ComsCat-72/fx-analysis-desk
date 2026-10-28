import { CONFIG } from "@/lib/config.ts";
import { isTimeZone, zoneLabel } from "@/lib/dates.ts";
import { HttpError, body, json, read, write } from "@/lib/http.ts";
import { changeSettings, getSettings } from "@/lib/settings.ts";

export const dynamic = "force-dynamic";

const view = (s: Awaited<ReturnType<typeof getSettings>>) => ({ publication_mode: s.publication_mode, writer: s.writer, display_timezone: s.display_timezone,
  display_label: zoneLabel(s.display_timezone), timezone_choices: CONFIG.display.choices.map((tz) => ({ tz, label: zoneLabel(tz) })) });

export const GET = read(async () => json(view(await getSettings())));

/** Writer and display timezone. Publication mode has its own route because automatic mode needs confirmation. */
export const PUT = write(async (req) => {
  const b = await body<{ writer?: string; display_timezone?: string }>(req);
  if (b.writer != null && b.writer !== "template" && b.writer !== "claude") throw new HttpError(400, "writer must be template or claude");
  if (b.display_timezone != null && !isTimeZone(b.display_timezone)) throw new HttpError(400, "display_timezone must be an IANA timezone such as Africa/Kampala");
  return json(view(await changeSettings((s) => {
    if (b.writer) s.writer = b.writer as "template" | "claude";
    if (b.display_timezone) s.display_timezone = b.display_timezone;
  })));
});
