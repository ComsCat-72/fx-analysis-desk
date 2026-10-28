import { CONFIG, env } from "@/lib/config.ts";
import { displayZone, zoneLabel } from "@/lib/dates.ts";
import { json, read } from "@/lib/http.ts";
import { getSettings } from "@/lib/settings.ts";
import { storageMode } from "@/lib/store.ts";

export const dynamic = "force-dynamic";

export const GET = read(async () => {
  const s = await getSettings();
  return json({
    app_env: env.appEnv, display: { ...displayZone(), choices: CONFIG.display.choices.map((tz) => ({ tz, label: zoneLabel(tz) })),
      default_timezone: s.display_timezone, default_label: zoneLabel(s.display_timezone) },
    instruments: Object.entries(CONFIG.instruments).map(([code, i]) => ({ code, display: i.display, base: i.base, quote: i.quote, kind: i.kind, label: i.label ?? null,
      decimals: i.decimals, symbol: i.yahoo })),
    providers: {
      prices: env.dataSource === "fixture" ? "DEVELOPMENT FIXTURE" : "Yahoo Finance",
      calendar: "Forex Factory weekly export",
      actuals: "FXStreet and biquote.io free economic calendars, or manual entry",
      positioning: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
      central_banks: Object.keys(CONFIG.centralBanks),
      news: `${[...new Set(CONFIG.headlines.feeds.map((f) => f.source))].join(" + ")} headline feeds`,
      storage: storageMode(),
    },
    credentials: { blob: storageMode() === "vercel-blob", admin_token: !!process.env.ADMIN_TOKEN, cron_secret: !!process.env.CRON_SECRET },
  });
});
