import { motion } from "framer-motion";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Loader2, MoveHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Panel({ title, icon, actions, children, className, bodyClass }: {
  title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={cx("panel flex min-w-0 flex-col", className)}>
      {title && (
        <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          {icon && <span className="text-muted" aria-hidden>{icon}</span>}
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.07em] text-muted">{title}</h2>
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      <div className={cx("min-h-0 flex-1", bodyClass ?? "p-4")}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "fixture";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-3 text-muted border-line",
  accent: "bg-accent-soft text-accent border-[color-mix(in_srgb,var(--accent)_30%,transparent)]",
  ok: "bg-ok-soft text-ok border-[color-mix(in_srgb,var(--ok)_30%,transparent)]",
  warn: "bg-warn-soft text-warn border-[color-mix(in_srgb,var(--warn)_35%,transparent)]",
  danger: "bg-danger-soft text-danger border-[color-mix(in_srgb,var(--danger)_35%,transparent)]",
  fixture: "bg-fixture-soft text-fixture border-[color-mix(in_srgb,var(--fixture)_35%,transparent)]",
};

export function Badge({ tone = "neutral", children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium leading-4", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Button({ children, onClick, variant = "secondary", disabled, busy, title, type = "button", size = "md", className }: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; busy?: boolean;
  title?: string; type?: "button" | "submit"; size?: "sm" | "md"; className?: string;
}) {
  const v = {
    primary: "bg-accent-strong text-white hover:brightness-110 border-transparent",
    secondary: "bg-surface-2 text-fg border-line hover:border-line-strong hover:bg-surface-3",
    ghost: "bg-transparent text-muted border-transparent hover:text-fg hover:bg-surface-3",
    danger: "bg-danger-soft text-danger border-[color-mix(in_srgb,var(--danger)_35%,transparent)] hover:brightness-110",
  }[variant];
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled || busy}
      className={cx("inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border font-medium transition-[background,border-color,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-3.5 text-sm", v, className)}>
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const DIR: Record<string, { label: string; icon: typeof ArrowRight }> = {
  upward_lean: { label: "Upward lean", icon: ArrowUpRight },
  downward_lean: { label: "Downward lean", icon: ArrowDownRight },
  neutral: { label: "Neutral", icon: ArrowRight },
  range_bound: { label: "Range-bound", icon: MoveHorizontal },
};

/** Direction is shown with an arrow and a word, never with buy/sell colours. */
export function DirectionTag({ direction, compact }: { direction: string | null | undefined; compact?: boolean }) {
  if (!direction) return <span className="text-faint">—</span>;
  const d = DIR[direction] ?? { label: direction, icon: ArrowRight };
  const Icon = d.icon;
  return (
    <span className="inline-flex items-center gap-1 text-fg" title={d.label}>
      <Icon className="size-3.5 text-accent" aria-hidden />
      {!compact && <span className="text-[13px]">{d.label}</span>}
      {compact && <span className="sr-only">{d.label}</span>}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <div className="flex items-center gap-2 p-4 text-sm text-muted" role="status"><Loader2 className="size-4 animate-spin" aria-hidden />{label}…</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</div>;
}

export function FadeIn({ children, k }: { children: ReactNode; k: string | number }) {
  return (
    <motion.div key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: "easeOut" }}>
      {children}
    </motion.div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls = "h-9 rounded-lg border border-line bg-surface-2 px-2.5 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none";
