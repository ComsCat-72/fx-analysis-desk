// Intl.DateTimeFormat objects are costly to build; build each timezone/option combination once and reuse it.
const cache = new Map<string, Intl.DateTimeFormat>();

export function dtf(locale: string, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(o)}`;
  let f = cache.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, o); cache.set(key, f); }
  return f;
}

/** formatToParts as a { type: value } record. */
export const partsOf = (locale: string, o: Intl.DateTimeFormatOptions, t: number | Date) =>
  Object.fromEntries(dtf(locale, o).formatToParts(new Date(t)).map((x) => [x.type, x.value])) as Record<string, string>;
