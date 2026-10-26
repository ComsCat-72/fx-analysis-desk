import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle.tsx";
import { CONFIG } from "@/lib/config.ts";
import "./globals.css";

const sans = Fira_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const mono = Fira_Code({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: CONFIG.siteTitle,
  description: "Evidence-based FX analysis and reviews written by Claude. Analysis only, not trading advice.",
};

const themeScript = `try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <header className="top">
          <div className="wrap bar">
            <Link className="brand" href="/">{CONFIG.siteTitle}<small>Analysis and reporting · not trading advice</small></Link>
            <nav className="inst" aria-label="Instruments">
              {Object.entries(CONFIG.instruments).map(([code, i]) => <Link key={code} href={`/${code}`}>{i.name}</Link>)}
            </nav>
            <Link className="iconbtn" href="/admin">Generate</Link>
            <ThemeToggle />
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
