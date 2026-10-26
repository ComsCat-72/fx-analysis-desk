// Everything you might want to change lives here. Secrets live in Vercel environment variables, never here.

export type InstrumentKind = "fx_spot" | "metal" | "index" | "index_cash";

/** How the data source's daily bars are delimited, in the source's own exchange timezone.
 *  Day D runs from the previous day's `close` to D's `close`, or from `open` to `close` when `open` is set
 *  (a cash session). "24:00" means midnight at the end of D. Monday starts at Sunday's close. */
export interface SessionRule { tz: string; close: string; open?: string; description: string }

export interface InstrumentConfig {
  display: string;
  yahoo: string; // Yahoo Finance chart symbol (free, no key)
  base: string;
  quote: string;
  kind: InstrumentKind;
  decimals: number;
  session: SessionRule;
  label?: string; // shown on reports: what the price series is
}

const LONDON_DAY: SessionRule = {
  tz: "Europe/London", close: "24:00",
  description: "Yahoo Finance spot FX daily bars: one bar per London calendar day (00:00–24:00 London), Monday to Friday.",
};
const NY_17: SessionRule = {
  tz: "America/New_York", close: "17:00",
  description: "Exchange trading day ending 17:00 New York (Monday opens Sunday 17:00), as published by Yahoo Finance.",
};

export const CONFIG = {
  siteTitle: "FX Analysis Desk",
  display: { timezone: "Africa/Kampala", timezone_label: "EAT" }, // EAT, UTC+3, no daylight saving
  // Claude: the writer drafts each report; research (web search) and the pre-publication review use a faster model.
  models: { writer: "claude-opus-5-5", research: "claude-sonnet-5-5", review: "claude-sonnet-5-5", vision: "claude-opus-5-5" },
  effort: "medium" as "low" | "medium" | "high",
  webSearchesPerReport: 5,
  // Instruments the schedule writes (remove some to reduce cost). All configured instruments stay viewable.
  scheduled: ["GBP_USD", "EUR_USD", "AUD_USD", "NZD_USD", "USD_CHF", "XAU_USD", "DXY", "NAS100"],
  instruments: {
    GBP_USD: { display: "GBP/USD", yahoo: "GBPUSD=X", base: "GBP", quote: "USD", kind: "fx_spot", decimals: 5, session: LONDON_DAY },
    EUR_USD: { display: "EUR/USD", yahoo: "EURUSD=X", base: "EUR", quote: "USD", kind: "fx_spot", decimals: 5, session: LONDON_DAY },
    AUD_USD: { display: "AUD/USD", yahoo: "AUDUSD=X", base: "AUD", quote: "USD", kind: "fx_spot", decimals: 5, session: LONDON_DAY },
    NZD_USD: { display: "NZD/USD", yahoo: "NZDUSD=X", base: "NZD", quote: "USD", kind: "fx_spot", decimals: 5, session: LONDON_DAY },
    USD_CHF: { display: "USD/CHF", yahoo: "CHF=X", base: "USD", quote: "CHF", kind: "fx_spot", decimals: 5, session: LONDON_DAY },
    XAU_USD: {
      display: "Gold", yahoo: "GC=F", base: "XAU", quote: "USD", kind: "metal", decimals: 2, session: NY_17,
      label: "COMEX gold futures (GC=F, front month) via Yahoo Finance, the closest free gold series; not spot XAU/USD.",
    },
    DXY: {
      display: "DXY", yahoo: "DX-Y.NYB", base: "USD", quote: "BASKET", kind: "index", decimals: 3, session: NY_17,
      label: "ICE US Dollar Index level as published via Yahoo Finance.",
    },
    NAS100: {
      display: "Nasdaq-100", yahoo: "^NDX", base: "NAS100", quote: "USD", kind: "index_cash", decimals: 2,
      session: { tz: "America/New_York", open: "09:30", close: "16:00", description: "US cash equity session 09:30–16:00 New York." },
      label: "Nasdaq-100 cash index level (09:30–16:00 New York) via Yahoo Finance; not futures or a CFD.",
    },
  } as Record<string, InstrumentConfig>,

  technical: {
    swings: { left: 3, right: 3 },   // a swing is confirmed only after `right` later bars close
    atrPeriod: 14,
    movingAverages: [{ type: "SMA", period: 20 }, { type: "SMA", period: 50 }, { type: "EMA", period: 20 }],
    rsi: { enabled: false, period: 14 },
    // A daily session missing at most this many hourly bars still counts for intraday checks (disclosed).
    maxMissingH1: 2,
    breaks: { basis: "close" as const, timeframe: "H1", sustainedCloses: 2, reversalCloses: 1 },
  },
  evaluation: {
    wording: "assessment" as "assessment" | "correct_incorrect",
    inconclusiveAtrFraction: 0.25,   // net move below this fraction of daily ATR = Inconclusive
    mixedExcursionAtrFraction: 0.5,  // opposite excursion of this size = Mixed
  },
  reports: {
    // automatic: drafts that pass every check are published by the schedule; anything with a blocking finding
    // stays a draft for you. manual: everything stays a draft until you publish it. Changeable in Configure.
    publicationMode: "automatic" as "manual" | "automatic",
    lengthWords: { daily_analysis: [250, 400], daily_review: [250, 400], weekly_analysis: [400, 650], weekly_review: [450, 700] } as Record<string, [number, number]>,
    partialPublication: "block" as "block" | "label",
    maxRevisions: 1,
  },
  // Vercel Cron (UTC, see vercel.json): reviews 03:00 UTC Tue–Sat, analyses 05:00 UTC daily.
  schedules: {
    reviews: "0 3 * * 2-6  (06:00 EAT): previous-session review; Saturday also reviews Friday",
    analyses: "0 5 * * *  (08:00 EAT): daily analysis Mon–Fri, weekly review Saturday, weekly analysis Sunday",
  },
  calendar: { feed: "https://nfs.faireconomy.media/ff_calendar_thisweek.json", impacts: ["High", "Medium", "Holiday"] },
  centralBanks: {
    fed: { currency: "USD", feeds: { press: "https://www.federalreserve.gov/feeds/press_all.xml", speech: "https://www.federalreserve.gov/feeds/speeches.xml" } },
    ecb: { currency: "EUR", feeds: { press: "https://www.ecb.europa.eu/rss/press.html" } },
    boe: { currency: "GBP", feeds: { press: "https://www.bankofengland.co.uk/rss/news" } },
    rba: { currency: "AUD", feeds: { press: "https://www.rba.gov.au/rss/rss-cb-media-releases.xml" } },
    rbnz: { currency: "NZD", feeds: { press: "https://www.rbnz.govt.nz/feeds/news" } },
    snb: { currency: "CHF", feeds: { press: "https://www.snb.ch/public/en/rss/pressrel" } },
  } as Record<string, { currency: string; feeds: Record<string, string> }>,
};

export type Kind = "weekly_analysis" | "daily_analysis" | "daily_review" | "weekly_review";
export const KINDS: Kind[] = ["weekly_analysis", "daily_analysis", "daily_review", "weekly_review"];
export const ANALYSIS_KINDS: Kind[] = ["weekly_analysis", "daily_analysis"];
export const KIND_LABEL: Record<Kind, string> = {
  weekly_analysis: "Weekly analysis", daily_analysis: "Daily analysis", daily_review: "Previous-day review", weekly_review: "Weekly review",
};

export const instrument = (code: string) => {
  const i = CONFIG.instruments[code];
  if (!i) throw new Error(`unknown instrument ${code}`);
  return i;
};

export const env = {
  get production() { return process.env.VERCEL_ENV === "production"; },
  get appEnv() { return process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development"); },
  get anthropicKey() { return process.env.ANTHROPIC_API_KEY ?? ""; },
  /** "yahoo" (default) or "fixture": synthetic development data, labelled everywhere and never publishable in production. */
  get dataSource() { return (process.env.DATA_SOURCE ?? "yahoo") as "yahoo" | "fixture"; },
};
