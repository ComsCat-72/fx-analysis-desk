import { authorized } from "@/lib/auth.ts";
import { CONFIG, KINDS, type Kind } from "@/lib/config.ts";
import { todayLocal } from "@/lib/dates.ts";
import { generateReport, normalisePeriod, runDueForInstrument } from "@/lib/generate.ts";

export const maxDuration = 300; // seconds; one instrument's reports per invocation
export const dynamic = "force-dynamic";

async function handle(req: Request, params: URLSearchParams | Record<string, unknown>) {
  if (!authorized(req)) return Response.json({ error: "not authorised" }, { status: 401 });
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : (params[k] as string | undefined)) ?? undefined;
  const instrument = get("instrument");
  if (!instrument || !CONFIG.instruments[instrument]) return Response.json({ error: "unknown or missing instrument" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on the server" }, { status: 500 });
  const kind = get("kind") as Kind | undefined;
  const force = String(get("force")) === "true";
  if (!kind) return Response.json({ results: await runDueForInstrument(instrument) });
  if (!KINDS.includes(kind)) return Response.json({ error: "unknown kind" }, { status: 400 });
  const period = normalisePeriod(kind, get("date") || todayLocal());
  return Response.json({ results: [await generateReport(instrument, kind, period, force)] });
}

export async function GET(req: Request) {
  return handle(req, new URL(req.url).searchParams);
}

export async function POST(req: Request) {
  return handle(req, await req.json().catch(() => ({})));
}
