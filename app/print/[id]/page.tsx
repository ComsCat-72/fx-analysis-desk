import { marked } from "marked";
import { notFound } from "next/navigation";
import { getVersion } from "@/lib/reports/service";

export const dynamic = "force-dynamic";

/** Print-styled report: the PDF export opens this page and the browser's print dialog ("Save as PDF"). */
export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> }) {
  const { id } = await params;
  const { token } = await searchParams;
  if (process.env.PROTECT_READS === "1" && token !== process.env.ADMIN_TOKEN) notFound();
  const v = await getVersion(decodeURIComponent(id)).catch(() => null);
  if (!v) notFound();
  const html = await marked.parse(v.body_md.replace(/</g, "&lt;")); // report text never carries raw HTML
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px", background: "var(--bg)" }}>
      <p className="no-print" style={{ fontSize: 13, color: "var(--muted)" }}>Use your browser&apos;s print dialog and choose “Save as PDF”.</p>
      <article className="report" dangerouslySetInnerHTML={{ __html: html }} />
      <script dangerouslySetInnerHTML={{ __html: "setTimeout(function(){window.print()},400)" }} />
    </main>
  );
}
