"use client";
import { useState } from "react";

// Verbindet den iCloud-Kalender per app-spezifischem Passwort (CalDAV, nur Lesen).
// Das Passwort gibt der Nutzer selbst ein; es wird serverseitig verschlüsselt
// gespeichert und nie im Klartext gehalten.
export default function IcloudConnect({
  connected,
  appleId,
  compact = false
}: {
  connected: boolean;
  appleId?: string | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    if (!id.trim() || !pw.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/icloud/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appleId: id.trim(), appPassword: pw })
      });
      const j = await r.json();
      if (r.ok) window.location.href = "/calendar?icloud=connected";
      else setError(j.error || "Verbindung fehlgeschlagen.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("iCloud-Kalender wirklich trennen?")) return;
    setBusy(true);
    try {
      await fetch("/api/icloud/disconnect", { method: "POST" });
      window.location.href = "/calendar";
    } catch {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 11px", borderRadius: 8,
    border: "1px solid var(--line, #ccc)", background: "var(--surface-2, #fff)",
    color: "inherit", fontSize: 13.5
  };

  if (connected) {
    return (
      <div className="mail" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="acct-pill">iCloud-Kalender · {appleId || "verbunden"}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn small btn-danger" onClick={disconnect} disabled={busy}>
          {busy ? "Trenne…" : "Trennen"}
        </button>
      </div>
    );
  }

  // Kompakter Modus (neben bereits verbundener Quelle): erst ein Button, der das
  // Formular aufklappt.
  const form = (
    <div style={{ display: "grid", gap: 8, maxWidth: 440 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="label" style={{ margin: 0 }}>Apple-ID (E-Mail)</span>
        <input style={inputStyle} type="email" autoComplete="username" placeholder="name@icloud.com"
          value={id} onChange={(e) => setId(e.target.value)} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="label" style={{ margin: 0 }}>App-spezifisches Passwort</span>
        <input style={inputStyle} type="password" autoComplete="off" placeholder="xxxx-xxxx-xxxx-xxxx"
          value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      {error && <div className="cal-note bad" style={{ margin: 0 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn btn-primary" onClick={connect} disabled={busy || !id.trim() || !pw.trim()}>
          {busy ? "Prüfe…" : "iCloud verbinden"}
        </button>
        {compact && <button className="btn small" onClick={() => setOpen(false)} disabled={busy}>Abbrechen</button>}
      </div>
    </div>
  );

  const help = (
    <ol className="cc-list" style={{ marginTop: 10 }}>
      <li>Auf <code>appleid.apple.com</code> anmelden → „Anmeldung &amp; Sicherheit"</li>
      <li>„App-spezifische Passwörter" → neues Passwort erzeugen (z. B. „Cockpit")</li>
      <li>Das angezeigte Passwort hier einfügen – zusammen mit deiner Apple-ID</li>
    </ol>
  );

  if (compact) {
    return (
      <div style={{ marginTop: 6 }}>
        {open ? form : (
          <button className="btn small" onClick={() => setOpen(true)}>＋ iCloud-Kalender verbinden</button>
        )}
      </div>
    );
  }

  return (
    <div className="connect-card">
      <div className="cc-ic"></div>
      <h2>iCloud-Kalender verbinden</h2>
      <p>
        Verbinde deinen iCloud-Kalender, um deine Apple-Termine hier im Cockpit zu sehen. Der Zugriff
        erfolgt ausschließlich <b>lesend</b> über CalDAV. Dafür brauchst du ein <b>app-spezifisches
        Passwort</b> (nicht dein normales Apple-Passwort).
      </p>
      {form}
      {help}
      <p className="cc-note">
        Hinweis: Apple <b>Notizen</b> lassen sich nicht anbinden (keine offizielle Schnittstelle).
        Apple <b>Erinnerungen</b> sind technisch über CalDAV möglich und können als nächster Schritt
        ergänzt werden.
      </p>
    </div>
  );
}
