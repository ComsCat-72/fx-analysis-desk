import { marked } from "marked";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CONFIG } from "@/lib/config.ts";
import { stamp } from "@/lib/dates.ts";
import { readReport } from "@/lib/storage.ts";

export const dynamic = "force-dynamic";

/** Markdown from Claude, rendered with raw HTML disabled and external links opened in a new tab. */
function render(md: string): string {
  const escaped = md.replace(/</g, "&lt;");
  const html = marked.parse(escaped, { async: false, gfm: true }) as string;
  return html.replace(/<a href="(https?:[^"]+)"/g, '<a target="_blank" rel="noopener noreferrer" href="$1"');
}

export default async function ReportPage({ params }: { params: Promise<{ instrument: string; slug: string }> }) {
  const { instrument, slug } = await params;
  const inst = CONFIG.instruments[instrument];
  const report = inst ? await readReport(instrument, slug) : null;
  if (!inst || !report) notFound();
  return (
    <>
      <div className="crumbs"><Link href="/">Home</Link> / <Link href={`/${instrument}`}>{inst.name}</Link></div>
      <p className="meta">
        Published {stamp(report.meta.published)} · written by {report.meta.model}
        {report.meta.check === "flagged" && <span className="flag" title="The automatic wording check still found possible advice or jargon">check flagged wording</span>}
      </p>
      <article dangerouslySetInnerHTML={{ __html: render(report.markdown) }} />
      <p className="disclaimer">Analysis only. This report explains market behaviour and does not recommend buying, selling or positioning in any market.</p>
    </>
  );
}
