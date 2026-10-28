// Everything you might want to change lives here. Secrets live in Vercel environment variables, never here.

export type InstrumentKind = "fx_spot" | "metal" | "index" | "index_cash";

export interface InstrumentConfig {
  display: string;
  yahoo: string; // Yahoo Finance chart symbol (free, no key)
  base: string;
  quote: string;
  kind: InstrumentKind;
  decimals: number;
  label?: string; // what the price series is, when it is not plain spot
}

export const CONFIG = {
  siteTitle: "FX Analysis Desk",
  // Default display timezone; changeable in Configure. labels: short names shown for common zones.
  display: {
    timezone: "Africa/Kampala", timezone_label: "EAT", // EAT, UTC+3, no daylight saving
    choices: ["Africa/Kampala", "Africa/Kigali", "Africa/Nairobi", "UTC", "Europe/London", "America/New_York"],
    labels: { "Africa/Kampala": "EAT", "Africa/Nairobi": "EAT", "Africa/Kigali": "CAT", UTC: "UTC" },
  },
  instruments: {
    GBP_USD: { display: "GBP/USD", yahoo: "GBPUSD=X", base: "GBP", quote: "USD", kind: "fx_spot", decimals: 5 },
    EUR_USD: { display: "EUR/USD", yahoo: "EURUSD=X", base: "EUR", quote: "USD", kind: "fx_spot", decimals: 5 },
    AUD_USD: { display: "AUD/USD", yahoo: "AUDUSD=X", base: "AUD", quote: "USD", kind: "fx_spot", decimals: 5 },
    NZD_USD: { display: "NZD/USD", yahoo: "NZDUSD=X", base: "NZD", quote: "USD", kind: "fx_spot", decimals: 5 },
    USD_CHF: { display: "USD/CHF", yahoo: "CHF=X", base: "USD", quote: "CHF", kind: "fx_spot", decimals: 5 },
    XAU_USD: {
      display: "Gold", yahoo: "GC=F", base: "XAU", quote: "USD", kind: "metal", decimals: 2,
      label: "COMEX gold futures (GC=F, front month) via Yahoo Finance, the closest free gold series; not spot XAU/USD.",
    },
    DXY: {
      display: "DXY", yahoo: "DX-Y.NYB", base: "USD", quote: "BASKET", kind: "index", decimals: 3,
      label: "ICE US Dollar Index level as published via Yahoo Finance.",
    },
    NAS100: {
      display: "Nasdaq-100", yahoo: "^NDX", base: "NAS100", quote: "USD", kind: "index_cash", decimals: 2,
      label: "Nasdaq-100 cash index level (09:30–16:00 New York) via Yahoo Finance; not futures or a CFD.",
    },
  } as Record<string, InstrumentConfig>,

  calendar: { feed: "https://nfs.faireconomy.media/ff_calendar_thisweek.json", impacts: ["High", "Medium", "Holiday"] },
  // Free, headline-only feeds (title, link, time). Article text is not fetched; WSJ articles are paywalled.
  // Reuters publishes no public RSS, so Reuters headlines come from Google News RSS restricted to reuters.com.
  headlines: {
    keepDays: 45,
    feeds: [
      { source: "WSJ", name: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml" },
      { source: "WSJ", name: "WSJ World News", url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml" },
      { source: "WSJ", name: "WSJ US Business", url: "https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml" },
      ...[
        "federal reserve OR fed rates OR dollar OR treasury yields",
        "ecb OR euro zone OR eurozone",
        "bank of england OR sterling OR uk economy",
        "reserve bank of australia OR australian dollar",
        "reserve bank of new zealand OR new zealand dollar",
        "swiss national bank OR swiss franc",
        "gold prices",
        "nasdaq OR wall street stocks",
      ].map((q) => ({ source: "Reuters", name: `Reuters: ${q}`,
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(`site:reuters.com ${q} when:7d`)}&hl=en-US&gl=US&ceid=US:en` })),
    ],
    // A headline is tagged with a currency when its title contains one of these words (case-insensitive, whole words).
    currencyKeywords: {
      USD: ["fed", "federal reserve", "fomc", "powell", "warsh", "dollar", "treasury", "treasuries", "us inflation", "us jobs", "payrolls", "u.s."],
      EUR: ["ecb", "euro", "eurozone", "euro zone", "lagarde", "germany", "german", "france", "french", "italy"],
      GBP: ["bank of england", "boe", "sterling", "pound", "uk", "britain", "british", "gilts", "gilt"],
      AUD: ["rba", "reserve bank of australia", "australia", "australian", "aussie"],
      NZD: ["rbnz", "reserve bank of new zealand", "new zealand", "kiwi"],
      CHF: ["snb", "swiss national bank", "swiss", "franc", "switzerland"],
      XAU: ["gold", "bullion"],
      NAS100: ["nasdaq", "wall street", "tech stocks", "s&p 500", "stocks"],
    } as Record<string, string[]>,
  },
  centralBanks: {
    fed: { currency: "USD", feeds: { press: "https://www.federalreserve.gov/feeds/press_all.xml", speech: "https://www.federalreserve.gov/feeds/speeches.xml" } },
    ecb: { currency: "EUR", feeds: { press: "https://www.ecb.europa.eu/rss/press.html" } },
    boe: { currency: "GBP", feeds: { press: "https://www.bankofengland.co.uk/rss/news" } },
    rba: { currency: "AUD", feeds: { press: "https://www.rba.gov.au/rss/rss-cb-media-releases.xml" } },
    rbnz: { currency: "NZD", feeds: { press: "https://www.rbnz.govt.nz/feeds/news" } },
    snb: { currency: "CHF", feeds: { press: "https://www.snb.ch/public/en/rss/pressrel" } },
  } as Record<string, { currency: string; feeds: Record<string, string> }>,
};

export const instrument = (code: string) => {
  const i = CONFIG.instruments[code];
  if (!i) throw new Error(`unknown instrument ${code}`);
  return i;
};

export const env = {
  get production() { return process.env.VERCEL_ENV === "production"; },
  get appEnv() { return process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development"); },
  /** "yahoo" (default) or "fixture": synthetic development data, labelled everywhere. */
  get dataSource() { return (process.env.DATA_SOURCE ?? "yahoo") as "yahoo" | "fixture"; },
};
