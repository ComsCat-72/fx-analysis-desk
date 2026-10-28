// Server-only: the display timezone for the current request (the viewer's browser zone), kept per request with
// AsyncLocalStorage so concurrent requests from different zones never mix. Outside a scope, the Configure setting applies.
import { AsyncLocalStorage } from "node:async_hooks";
import { isTimeZone, setZoneScope, zoneLabel } from "./dates.ts";

const store = new AsyncLocalStorage<{ timezone: string; timezone_label: string }>();
setZoneScope(() => store.getStore());

/** Run `fn` with `tz` as the display zone; an invalid or missing zone leaves the Configure setting in force. */
export function withZone<T>(tz: string | null | undefined, fn: () => T): T {
  if (!tz || !isTimeZone(tz)) return fn();
  return store.run({ timezone: tz, timezone_label: zoneLabel(tz) }, fn);
}
