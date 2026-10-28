// Route helpers: JSON responses, auth guards and errors returned as JSON (never an HTML error page).
import { authorized, canRead } from "./auth.ts";
import { ImmutableError, StorageMissing } from "./store.ts";
import { PublishError } from "./reports/service.ts";
import { getSettings } from "./settings.ts";

export class HttpError extends Error {
  status: number; detail: unknown;
  constructor(status: number, detail: unknown) { super(typeof detail === "string" ? detail : "error"); this.status = status; this.detail = detail; }
}

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

function wrap<C>(write: boolean, fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    if (write ? !authorized(req) : !canRead(req)) return json({ detail: "admin token required" }, 401);
    try {
      await getSettings(); // applies the display timezone for this request
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ detail: e.detail }, e.status);
      if (e instanceof PublishError) return json({ detail: { message: e.message, findings: e.findings } }, 409);
      if (e instanceof ImmutableError) return json({ detail: e.message }, 409);
      if (e instanceof StorageMissing) return json({ detail: e.message }, 503);
      console.error(e);
      const msg = `${(e as Error).name}: ${(e as Error).message}`.replace(/(sk-ant-[\w-]{6})[\w-]+/g, "$1***");
      return json({ detail: msg.slice(0, 1500) }, 500);
    }
  };
}
export const read = <C = unknown>(fn: Handler<C>) => wrap(false, fn);
export const write = <C = unknown>(fn: Handler<C>) => wrap(true, fn);

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, "request body must be JSON"); }
}
export const param = (req: Request, k: string) => new URL(req.url).searchParams.get(k);
export type Ctx<P extends Record<string, string | string[]>> = { params: Promise<P> };
