// Everything you might want to change lives here.

export interface InstrumentConfig {
  name: string;
  yahoo: string; // Yahoo Finance symbol (free, no key)
  base: string;
  quote: string;
  decimals: number;
  note?: string; // extra instruction for Claude about the data
}

export const CONFIG = {
  siteTitle: "FX Analysis Desk",
  timezone: "Africa/Kampala", // EAT, UTC+3, no daylight saving
  timezoneLabel: "EAT",
  model: "claude-opus-5-5",
  effort: "medium" as "low" | "medium" | "high", // higher = more thorough and more expensive
  webSearchesPerReport: 5,
  // Instruments written by the daily schedule (remove some to reduce cost).
  scheduled: ["GBP_USD", "EUR_USD", "AUD_USD", "NZD_USD", "USD_CHF", "XAU_USD", "DXY", "NAS100"],
  instruments: {
    GBP_USD: { name: "GBP/USD", yahoo: "GBPUSD=X", base: "GBP", quote: "USD", decimals: 5 },
    EUR_USD: { name: "EUR/USD", yahoo: "EURUSD=X", base: "EUR", quote: "USD", decimals: 5 },
    AUD_USD: { name: "AUD/USD", yahoo: "AUDUSD=X", base: "AUD", quote: "USD", decimals: 5 },
    NZD_USD: { name: "NZD/USD", yahoo: "NZDUSD=X", base: "NZD", quote: "USD", decimals: 5 },
    USD_CHF: { name: "USD/CHF", yahoo: "CHF=X", base: "USD", quote: "CHF", decimals: 5 },
    XAU_USD: {
      name: "Gold (XAU/USD)", yahoo: "GC=F", base: "XAU", quote: "USD", decimals: 2,
      note: "Price data is COMEX gold futures (GC=F), the closest free series; describe it as gold futures.",
    },
    DXY: { name: "DXY", yahoo: "DX-Y.NYB", base: "USD", quote: "basket", decimals: 3 },
    NAS100: { name: "Nasdaq-100", yahoo: "^NDX", base: "US equities", quote: "USD", decimals: 2 },
  } as Record<string, InstrumentConfig>,
};

export type Kind = "weekly_analysis" | "daily_analysis" | "daily_review" | "weekly_review";
export const KINDS: Kind[] = ["weekly_analysis", "daily_analysis", "daily_review", "weekly_review"];
export const KIND_LABEL: Record<Kind, string> = {
  weekly_analysis: "Weekly analysis",
  daily_analysis: "Daily analysis",
  daily_review: "Session review",
  weekly_review: "Weekly review",
};
