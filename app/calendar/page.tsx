import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/AppShell";
import CalendarView from "@/components/CalendarView";
import IcloudConnect from "@/components/IcloudConnect";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ google?: string; icloud?: string; reason?: string }> }) {
  const query = await searchParams;
  const user = await requireUser();
  if (!user) return <LoginForm />;

  const admin = supabaseAdmin();
  const [{ data: gAcc }, { data: iAcc }] = await Promise.all([
    admin.from("google_accounts").select("email,status").eq("user_id", user.id).maybeSingle(),
    admin.from("icloud_accounts").select("apple_id,status").eq("user_id", user.id).maybeSingle()
  ]);
  const gConnected = !!gAcc;
  const iConnected = !!iAcc;
  const anyConnected = gConnected || iConnected;
  const configured = env.google.configured();
  const status = query?.google;
  let callbackUrl = "[deine-App]/api/auth/google/callback";
  try { callbackUrl = env.appBaseUrl() + "/api/auth/google/callback"; } catch { /* APP_BASE_URL evtl. nicht gesetzt */ }

  return (
    <AppShell active="/calendar">
      <div className="page">
        <div className="page-head">
          <h1>Kalender</h1>
        </div>
        <div className="wrap-inner">
          {status === "error" && <div className="cal-note bad" style={{ marginBottom: 12 }}>Verbindung fehlgeschlagen{query?.reason ? `: ${query.reason}` : "."}</div>}
          {status === "connected" && <div className="cal-note ok" style={{ marginBottom: 12 }}>Google-Kalender verbunden.</div>}
          {query?.icloud === "connected" && <div className="cal-note ok" style={{ marginBottom: 12 }}>iCloud-Kalender verbunden.</div>}

          {anyConnected ? (
            <>
              <CalendarView initialEmail={gAcc?.email || iAcc?.apple_id} />

              <div className="bucket" style={{ marginTop: 16 }}>
                <div className="bh"><span className="bt">Kalenderquellen</span></div>
                {gConnected ? (
                  <div className="note" style={{ marginTop: 0 }}>Google-Kalender verbunden ({gAcc?.email}). Trennen über den Kalender oben.</div>
                ) : (
                  configured && <div className="mail"><a className="btn small" href="/api/auth/google">Google-Kalender verbinden</a></div>
                )}
                <IcloudConnect connected={iConnected} appleId={iAcc?.apple_id} compact />
              </div>
            </>
          ) : (
            <div style={{ display: "grid", gap: 16 }}>
              <div className="connect-card">
                <div className="cc-ic">▦</div>
                <h2>Google-Kalender verbinden</h2>
                <p>Verbinde deinen Google-Kalender, um deine Termine (Monat &amp; Agenda) direkt hier im Cockpit zu sehen. Es wird ausschließlich <b>lesend</b> zugegriffen – nichts wird geändert oder gelöscht.</p>
                {configured ? (
                  <>
                    <a className="cc-connect" href="/api/auth/google">Mit Google verbinden</a>
                    <p className="cc-note">Du wirst zu Google weitergeleitet und wählst dort dein Konto. Nach der Freigabe kommst du automatisch hierher zurück.</p>
                  </>
                ) : (
                  <>
                    <p><b>Die Google-Anbindung ist serverseitig noch nicht konfiguriert.</b> Dafür sind einmalig folgende Schritte in der Google Cloud Console nötig:</p>
                    <ul className="cc-list">
                      <li>Google-Cloud-Projekt anlegen und die <b>Google Calendar API</b> aktivieren</li>
                      <li>OAuth-Zustimmungsbildschirm (extern) einrichten, deine E-Mail als Testnutzer eintragen</li>
                      <li>OAuth-Client-ID (Typ „Web") erstellen, Redirect-URI: <code>{callbackUrl}</code></li>
                      <li>In Vercel die Variablen <code>GOOGLE_CLIENT_ID</code> und <code>GOOGLE_CLIENT_SECRET</code> setzen und neu deployen</li>
                      <li>Scope: <code>calendar.readonly</code> (nur Lesen)</li>
                    </ul>
                    <p className="cc-note">Danach erscheint hier der Button „Mit Google verbinden".</p>
                  </>
                )}
                {status === "not_configured" && <div className="cal-note bad" style={{ marginTop: 12 }}>Google ist serverseitig noch nicht eingerichtet (GOOGLE_CLIENT_ID/SECRET fehlen).</div>}
              </div>

              <IcloudConnect connected={false} />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
