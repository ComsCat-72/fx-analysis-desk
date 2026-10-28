// Second source of actual results: FXStreet's free, keyless economic calendar API, the one its public calendar page
// (https://www.fxstreet.com/economic-calendar) reads. Response: an array of events such as
//   { id, eventId, dateUtc: "2026-10-27T12:30:00Z", name: "Durable Goods Orders", countryCode: "US", currencyCode: "USD",
//     actual: 1.8, consensus: 0.6, previous: 0, revised: 0.1, unit: "%" | null, potency: "ZERO" | "K" | "M" | "B", ... }
// It publishes US and UK actuals within minutes, which biquote.io's feed for those countries often does not.
import type { Release } from "./actuals.ts";

export const FXSTREET_URL = process.env.FXSTREET_URL || "https://calendar-api.fxstreet.com/en/api/v1/eventDates"; // overridable for local testing
export const FXSTREET_PAGE = "https://www.fxstreet.com/economic-calendar";
export const FXSTREET_SOURCE = "FXStreet economic calendar";
export const FXSTREET_HEADERS = { Accept: "application/json", Origin: "https://www.fxstreet.com", Referer: "https://www.fxstreet.com/" };

const CURRENCIES = new Set(["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "CNY"]);

/** Request URL for the UTC range [from, to]. */
export const fxstreetUrl = (from: number, to: number) => `${FXSTREET_URL}/${new Date(from).toISOString().slice(0, 19)}Z/${new Date(to).toISOString().slice(0, 19)}Z`;

/** FXStreet rows as releases. A figure keeps its unit: "%" or the K/M/B multiplier ("potency"). */
export function parseFxstreet(body: unknown): Release[] {
  if (!Array.isArray(body)) return [];
  const out: Release[] = [];
  for (const o of body as Record<string, unknown>[]) {
    const currency = String(o.currencyCode ?? "").toUpperCase(), at = Date.parse(String(o.dateUtc ?? ""));
    if (!o.name || !CURRENCIES.has(currency) || Number.isNaN(at) || o.isSpeech || o.isReport) continue;
    const suffix = o.unit === "%" ? "%" : /^[KMBT]$/.test(String(o.potency)) ? String(o.potency) : "";
    const fig = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? `${v}${suffix}` : null);
    out.push({ title: String(o.name), currency, at, actual: fig(o.actual), forecast: fig(o.consensus), previous: fig(o.previous), revised: fig(o.revised),
      unit: o.unit === "%" ? "percent" : null, source: FXSTREET_SOURCE, url: FXSTREET_PAGE });
  }
  return out;
}
