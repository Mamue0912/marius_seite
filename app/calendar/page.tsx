import { requireUser } from "@/lib/supabaseServer";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

// Google Calendar ist in dieser eigenständigen Web-App noch nicht angebunden
// (die Kalender-Ansicht lebt bisher nur im claude.ai-Artefakt). Statt eines
// leeren Kalenders zeigen wir eine klare Verbindungs-/Statusseite.
export default async function CalendarPage() {
  const user = await requireUser();
  if (!user) return <LoginForm />;
  return (
    <AppShell active="/calendar">
      <div className="page">
        <div className="page-head"><h1>Kalender</h1></div>
        <div className="wrap-inner">
          <div className="connect-card">
            <div className="cc-ic">▦</div>
            <h2>Google-Kalender noch nicht verbunden</h2>
            <p>Diese eigenständige Cockpit-App hat aktuell <b>keine</b> direkte Google-Kalender-Anbindung.
            Der Kalender, den du kennst, läuft bisher nur in deinem separaten claude.ai-Artefakt.</p>
            <p>Damit der Kalender hier live erscheint (Tag/Woche/Monat/Agenda, Klassifizierung, Verknüpfungen),
            muss eine <b>Google-OAuth-Anbindung</b> eingerichtet werden:</p>
            <ul className="cc-list">
              <li>Google-Cloud-Projekt + OAuth-Zustimmungsbildschirm</li>
              <li>OAuth-Client (Web) mit Redirect-URI auf diese App</li>
              <li>Scope <code>calendar.readonly</code> (nur Lesen)</li>
              <li>Token-Speicherung (verschlüsselt, serverseitig) + API-Routen</li>
            </ul>
            <p className="cc-note">Das ist ein eigener Einrichtungsschritt (kostenlos, Google Calendar API im Free-Tier).
            Sag mir „Google-Kalender einrichten", dann baue ich die Anbindung als nächste Phase und führe dich durch die Google-Cloud-Schritte.</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
