import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import "./globals.css";

const sans = Fira_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-fira-sans" });
const mono = Fira_Code({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-fira-code" });

export const metadata: Metadata = {
  title: "FX Analysis Desk",
  description: "Evidence-based FX analysis and reviews. Analysis only, not trading advice.",
};

const themeScript = `try{var t=localStorage.getItem('fx.theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
