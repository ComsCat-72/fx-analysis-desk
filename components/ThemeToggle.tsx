"use client";

export default function ThemeToggle() {
  function toggle() {
    const r = document.documentElement;
    const current = r.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const next = current === "light" ? "dark" : "light";
    r.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* storage unavailable */ }
  }
  return <button className="iconbtn" onClick={toggle} aria-label="Toggle light or dark theme">◐</button>;
}
