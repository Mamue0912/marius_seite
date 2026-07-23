import type { Metadata, Viewport } from "next";
import "./globals.css";
import ScrollbarAutoHide from "@/components/ScrollbarAutoHide";

export const metadata: Metadata = {
  title: "Cockpit",
  description: "Persönliches Cockpit mit Live-Postfach und Antwort-Assistent"
};

export const viewport: Viewport = {
  themeColor: "#050506",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Dark-Mode-first (Apple-inspiriert), wie das bestehende Cockpit.
  return (
    <html lang="de" data-theme="dark">
      <body><ScrollbarAutoHide />{children}</body>
    </html>
  );
}
