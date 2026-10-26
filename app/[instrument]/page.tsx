import Link from "next/link";
import { notFound } from "next/navigation";
import { CONFIG } from "@/lib/config.ts";
import { longDate } from "@/lib/dates.ts";
import { entries } from "@/lib/view.ts";

export const dynamic = "force-dynamic";

export default async function InstrumentPage({ params }: { params: Promise<{ instrument: string }> }) {
  const { instrument } = await params;
  const inst = CONFIG.instruments[instrument];
  if (!inst) notFound();
  const rows = await entries(instrument);
  return (
    <>
      <div className="crumbs"><Link href="/">Home</Link> / {inst.name}</div>
      <h1 className="page">{inst.name}</h1>
      <p className="sub">All reports, newest first.</p>
      <div className="list">
        {rows.length === 0 && <div className="row empty">No reports yet. They appear after the next scheduled run, or use Generate.</div>}
        {rows.map((e) => (
          <div className="row" key={e.slug}>
            <span className="date">{longDate(e.period)}</span>
            <span className="k"><Link href={`/${instrument}/${e.slug}`}>{e.label}</Link></span>
          </div>
        ))}
      </div>
    </>
  );
}
