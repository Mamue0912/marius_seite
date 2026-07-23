"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { calPrefetchDefault } from "@/lib/calendarStore";
import { prefetchApplications } from "@/lib/appsStore";
import { prefetchMail } from "@/lib/mailStore";

// Daten der Zielseite schon beim Hovern/Antippen im Hintergrund vorladen.
function prefetchData(href: string) {
  if (href === "/calendar") calPrefetchDefault();
  else if (href === "/applications") prefetchApplications();
  else if (href === "/mail") prefetchMail();
}

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
  const [unread, setUnread] = useState<number>(0);

  // Ungelesene Posteingangs-Mails – gleiche Quelle/Regel wie Liste & Übersicht
  // (messages: inbox, nicht gelesen, nicht gelöscht). Live via Realtime.
  useEffect(() => {
    const supabase = supabaseBrowser();
    let channel: any;
    let timer: any;
    async function load() {
      try {
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("folder_type", "inbox").eq("is_read", false).eq("is_deleted", false);
        setUnread(count || 0);
      } catch { /* still ignorieren */ }
    }
    load();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      channel = supabase
        .channel("nav-unread")
        .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `user_id=eq.${user.id}` }, () => {
          clearTimeout(timer); timer = setTimeout(load, 400); // kurz entprellen
        })
        .subscribe();
    })();
    const onFocus = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    const iv = setInterval(load, 60000);
    return () => { if (channel) channel.unsubscribe(); window.removeEventListener("focus", onFocus); clearInterval(iv); clearTimeout(timer); };
  }, []);

  const badgeFor = (href: string) => (href === "/mail" && unread > 0 ? unread : 0);

  return (
    <div className={"shell" + (collapsed ? " collapsed" : "")}>
      <aside className="sidebar">
        <div className="side-top">
          <span className="mark" />
          {!collapsed && <span className="side-title">Cockpit</span>}
          <button className="side-toggle" onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Ausklappen" : "Einklappen"} aria-label="Navigation ein-/ausklappen">‹</button>
        </div>
        <nav className="side-nav">
          {NAV.map((n) => {
            const b = badgeFor(n.href);
            return (
              <Link key={n.href} href={n.href} prefetch onMouseEnter={() => prefetchData(n.href)} onTouchStart={() => prefetchData(n.href)} onFocus={() => prefetchData(n.href)} className={"nav-item" + (active === n.href ? " active" : "")} title={b ? `${n.label} · ${b} ungelesen` : n.label}>
                <span className="nav-ic">{n.icon}</span>
                {!collapsed && <span className="nav-lbl">{n.label}</span>}
                {b > 0 && <span className={"nav-badge" + (collapsed ? " dot" : "")}>{collapsed ? "" : b}</span>}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="main">
        {topbar && <div className="topbar">{topbar}</div>}
        <div className="content">{children}</div>
      </div>

      <nav className="bottomnav">
        {NAV.filter((n) => !["/settings", "/deadlines"].includes(n.href)).map((n) => {
          const b = badgeFor(n.href);
          return (
            <Link key={n.href} href={n.href} prefetch onTouchStart={() => prefetchData(n.href)} className={"bn-item" + (active === n.href ? " active" : "")}>
              <span className="bn-ic">{n.icon}{b > 0 && <span className="bn-badge">{b > 99 ? "99+" : b}</span>}</span>
              <span className="bn-lbl">{n.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
