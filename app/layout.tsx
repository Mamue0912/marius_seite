import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cockpit — Outlook Live",
  description: "Live-Outlook-Postfach mit intelligentem Antwort-Assistenten"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Dark-Mode-first (Apple-inspiriert), wie das bestehende Cockpit.
  return (
    <html lang="de" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
