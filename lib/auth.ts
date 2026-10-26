// Who may trigger report generation: Vercel Cron (Authorization: Bearer CRON_SECRET) or you
// (X-Admin-Token: ADMIN_TOKEN from the admin page). Reading reports is always public.
import { timingSafeEqual } from "node:crypto";

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function authorized(req: Request): boolean {
  const cron = process.env.CRON_SECRET, admin = process.env.ADMIN_TOKEN;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const token = req.headers.get("x-admin-token") ?? "";
  if (cron && bearer && same(bearer, cron)) return true;
  if (admin && token && same(token, admin)) return true;
  // Local development with neither secret configured stays open; deployments never are.
  return !cron && !admin && !process.env.VERCEL;
}
