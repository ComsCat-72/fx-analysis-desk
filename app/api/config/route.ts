import { CONFIG, env } from "@/lib/config.ts";
import { json, read } from "@/lib/http.ts";
import { getSettings } from "@/lib/settings.ts";
import { storageMode } from "@/lib/store.ts";

export const dynamic = "force-dynamic";

export const GET = read(async () => json({
  app_env: env.appEnv, display: CONFIG.display,
  instruments: Object.entries(CONFIG.instruments).map(([code, i]) => ({ code, display: i.display, base: i.base, quote: i.quote, kind: i.kind, label: i.label ?? null,
    decimals: i.decimals, symbol: i.yahoo, session: i.session.description, scheduled: CONFIG.scheduled.includes(code) })),
  publication_mode: (await getSettings()).publication_mode,
  writer: env.anthropicKey ? "claude" : "template", models: CONFIG.models, schedules: CONFIG.schedules, technical: CONFIG.technical, evaluation: CONFIG.evaluation,
  providers: { prices: env.dataSource === "fixture" ? "DEVELOPMENT FIXTURE" : "Yahoo Finance (bars as published)", calendar: "Forex Factory weekly export (no actuals)",
    actuals: "manual entry, or web search with a cited source", central_banks: Object.keys(CONFIG.centralBanks), news: "manual entry + Claude web search", storage: storageMode() },
  credentials: { anthropic: !!env.anthropicKey, blob: storageMode() === "vercel-blob", admin_token: !!process.env.ADMIN_TOKEN, cron_secret: !!process.env.CRON_SECRET },
}));
