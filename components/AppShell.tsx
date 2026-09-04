"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
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
 {href:"/",label:"Übersicht",icon:"overview"}, {href:"/mail",label:"E-Mails",icon:"mail"},
 {href:"/applications",label:"Bewerbungen",icon:"briefcase"}, {href:"/calendar",label:"Kalender",icon:"calendar"},
 {href:"/tasks",label:"Aufgaben",icon:"tasks"}, {href:"/deadlines",label:"Fristen",icon:"clock"},
 {href:"/settings",label:"Einstellungen",icon:"settings"}
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
        if (count !== null) setUnread(count);
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
    window.addEventListener("cockpit:mail-changed", load);
    const iv = setInterval(load, 60000);
    return () => { if (channel) channel.unsubscribe(); window.removeEventListener("focus", onFocus); window.removeEventListener("cockpit:mail-changed", load); clearInterval(iv); clearTimeout(timer); };
  }, []);

  const badgeFor = (href: string) => (href === "/mail" && unread > 0 ? unread : 0);

  return (
    <div className={"shell" + (collapsed ? " collapsed" : "")}>
      <a className="skip-link" href="#main-content">Zum Inhalt</a><aside className="sidebar" aria-label="Hauptnavigation">
        <div className="side-top">
          <span className="mark" />
          {!collapsed && <span className="side-title">Cockpit</span>}
          <button className="side-toggle" onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Ausklappen" : "Einklappen"} aria-label="Navigation ein-/ausklappen" aria-expanded={!collapsed}><Icon name="chevron" /></button>
        </div>
        <nav className="side-nav" aria-label="Bereiche">
          {NAV.map((n) => {
            const b = badgeFor(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active === n.href ? "page" : undefined} prefetch onMouseEnter={() => prefetchData(n.href)} onTouchStart={() => prefetchData(n.href)} onFocus={() => prefetchData(n.href)} className={"nav-item" + (active === n.href ? " active" : "")} title={b ? `${n.label} · ${b} ungelesen` : n.label}>
                <span className="nav-ic"><Icon name={n.icon} /></span>
                {!collapsed && <span className="nav-lbl">{n.label}</span>}
                {b > 0 && <span className={"nav-badge" + (collapsed ? " dot" : "")}>{collapsed ? "" : b}</span>}
              </Link>
            );
          })}
        </nav><div className="side-bottom"><div className="side-caption">Dein persönlicher Arbeitsbereich</div></div>
      </aside>

      <div className="main">
        {topbar && <div className="topbar">{topbar}</div>}
        <div className="content" id="main-content" tabIndex={-1}>{children}</div>
      </div>

      <nav className="bottomnav">
        {NAV.map((n) => {
          const b = badgeFor(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={active === n.href ? "page" : undefined} prefetch onTouchStart={() => prefetchData(n.href)} className={"bn-item" + (active === n.href ? " active" : "")}>
              <span className="bn-ic"><Icon name={n.icon} />{b > 0 && <span className="bn-badge">{b > 99 ? "99+" : b}</span>}</span>
              <span className="bn-lbl">{n.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
