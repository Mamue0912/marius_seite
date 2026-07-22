"use client";
import { useState } from "react";

const NAV = [
  { href: "/", label: "Übersicht", icon: "◉" },
  { href: "/mail", label: "E-Mails", icon: "✉" },
  { href: "/applications", label: "Bewerbungen", icon: "💼" },
  { href: "/calendar", label: "Kalender", icon: "▦" },
  { href: "/tasks", label: "Aufgaben", icon: "☑" },
  { href: "/deadlines", label: "Fristen", icon: "◎" },
  { href: "/settings", label: "Einstellungen", icon: "⚙" }
];

// Dauerhafte App-Navigation. `active` = aktueller Pfad. `topbar` = globale Leiste.
export default function AppShell({ active, topbar, children }: { active: string; topbar?: React.ReactNode; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={"shell" + (collapsed ? " collapsed" : "")}>
      <aside className="sidebar">
        <div className="side-top">
          <span className="mark" />
          {!collapsed && <span className="side-title">Cockpit</span>}
          <button className="side-toggle" onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Ausklappen" : "Einklappen"} aria-label="Navigation ein-/ausklappen">‹</button>
        </div>
        <nav className="side-nav">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={"nav-item" + (active === n.href ? " active" : "")} title={n.label}>
              <span className="nav-ic">{n.icon}</span>
              {!collapsed && <span className="nav-lbl">{n.label}</span>}
            </a>
          ))}
        </nav>
      </aside>

      <div className="main">
        {topbar && <div className="topbar">{topbar}</div>}
        <div className="content">{children}</div>
      </div>

      <nav className="bottomnav">
        {NAV.filter((n) => !["/settings", "/deadlines"].includes(n.href)).map((n) => (
          <a key={n.href} href={n.href} className={"bn-item" + (active === n.href ? " active" : "")}>
            <span className="bn-ic">{n.icon}</span>
            <span className="bn-lbl">{n.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
