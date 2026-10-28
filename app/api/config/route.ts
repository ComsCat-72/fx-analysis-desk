import { CONFIG, env } from "@/lib/config.ts";
import { displayZone, hhmm, zoneLabel } from "@/lib/dates.ts";
import { json, read } from "@/lib/http.ts";
import { writerFor } from "@/lib/reports/service.ts";
import { getSettings } from "@/lib/settings.ts";
import { storageMode } from "@/lib/store.ts";

export const dynamic = "force-dynamic";

export const GET = read(async () => {
  const s = await getSettings();
  const writer = writerFor(null, s.writer).name;
  return json({
    app_env: env.appEnv, display: { ...displayZone(), choices: CONFIG.display.choices.map((tz) => ({ tz, label: zoneLabel(tz) })) },
    instruments: Object.entries(CONFIG.instruments).map(([code, i]) => ({ code, display: i.display, base: i.base, quote: i.quote, kind: i.kind, label: i.label ?? null,
      decimals: i.decimals, symbol: i.yahoo, session: i.session.description, scheduled: CONFIG.scheduled.includes(code) })),
    publication_mode: s.publication_mode, writer, writer_setting: s.writer, models: CONFIG.models, schedules: Object.fromEntries(Object.entries(CONFIG.schedules).map(([k, v]) => {
      const [h, m] = v.utc.split(":").map(Number), t = Date.UTC(2026, 0, 15, h, m); // Africa zones have no daylight saving
      return [k, `${v.what}: ${v.utc} UTC (${hhmm(t)} ${displayZone().timezone_label}) · cron ${v.cron}`];
    })), technical: CONFIG.technical, evaluation: CONFIG.evaluation,
    providers: { prices: env.dataSource === "fixture" ? "DEVELOPMENT FIXTURE" : "Yahoo Finance (bars as published)", calendar: "Forex Factory weekly export (no actuals)",
      actuals: writer === "claude" ? "manual entry, or web search with a cited source" : "manual entry (the free calendar export has no actual results)",
      central_banks: Object.keys(CONFIG.centralBanks), news: `${[...new Set(CONFIG.headlines.feeds.map((f) => f.source))].join(" + ")} headline feeds, manual entry${writer === "claude" ? ", Claude web search" : ""}`,
      storage: storageMode() },
    credentials: { anthropic: !!env.anthropicKey, blob: storageMode() === "vercel-blob", admin_token: !!process.env.ADMIN_TOKEN, cron_secret: !!process.env.CRON_SECRET },
  });
});
