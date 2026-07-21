import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cockpit",
  description: "Persönliches Cockpit mit Live-Postfach und Antwort-Assistent"
};

export const viewport: Viewport = {
  themeColor: "#0b0b0f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Dark-Mode-first (Apple-inspiriert), wie das bestehende Cockpit.
  return (
    <html lang="de" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
