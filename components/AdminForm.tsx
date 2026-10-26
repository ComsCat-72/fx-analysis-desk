"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Result { instrument: string; kind: string; period: string; status: string; detail?: string }

export default function AdminForm({ instruments, kinds }: {
  instruments: { code: string; name: string }[]; kinds: { value: string; label: string }[];
}) {
  const [token, setToken] = useState("");
  const [instrument, setInstrument] = useState(instruments[0]?.code ?? "");
  const [kind, setKind] = useState("");
  const [date, setDate] = useState("");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    try { setToken(localStorage.getItem("adminToken") ?? ""); } catch { /* storage unavailable */ }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setResults([]);
    try { localStorage.setItem("adminToken", token); } catch { /* storage unavailable */ }
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ instrument, kind: kind || undefined, date: date || undefined, force }),
      });
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else setResults(body.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="admin" onSubmit={submit}>
        <label>Admin token<input type="password" required value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" /></label>
        <label>Instrument
          <select value={instrument} onChange={(e) => setInstrument(e.target.value)}>
            {instruments.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}
          </select>
        </label>
        <label>Report
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Whatever is due today</option>
            {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label>Date (optional; reviews use the session date)<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />Rewrite if it already exists</label>
        <button className="primary" disabled={busy}>{busy ? "Claude is writing… (about 1–3 minutes)" : "Generate"}</button>
        <p className="note">Claude reads the latest prices and calendar, searches the news, and writes in your template. One report takes about a minute.</p>
      </form>
      {error && <p className="result bad" role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {results.length > 0 && (
        <div className="list result">
          {results.map((r) => (
            <div className="row" key={r.kind + r.period}>
              <span className={r.status === "failed" ? "bad" : "ok"}>{r.status}</span>
              <span className="k">{r.kind.replace("_", " ")} · {r.period}</span>
              {r.status !== "failed" && <Link href={`/${r.instrument}/${r.period}_${r.kind}`}>Open report</Link>}
              {r.detail && <span className="date">{r.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
