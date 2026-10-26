import Link from "next/link";
import { CONFIG } from "@/lib/config.ts";
import { shortDate } from "@/lib/dates.ts";
import { entries } from "@/lib/view.ts";

export const dynamic = "force-dynamic";

export default async function Home() {
  const all = await entries();
  return (
    <>
      <h1 className="page">Market reports</h1>
      <p className="sub">Weekly and daily analyses and reviews, written by Claude every morning at 07:00 {CONFIG.timezoneLabel}.</p>
      <div className="grid">
        {Object.entries(CONFIG.instruments).map(([code, inst]) => {
          const mine = all.filter((e) => e.instrument === code).slice(0, 6);
          return (
            <section className="card" key={code}>
              <h2><Link href={`/${code}`}>{inst.name}</Link><span>{code}</span></h2>
              <ul>
                {mine.length === 0 && <li className="empty">No reports yet</li>}
                {mine.map((e) => (
                  <li key={e.slug}><span className="date">{shortDate(e.period)}</span><Link href={`/${code}/${e.slug}`}>{e.label}</Link></li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
