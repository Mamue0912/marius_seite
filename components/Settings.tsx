"use client";
import { useState } from "react";
import { PROVIDERS } from "@/lib/mailProviders";

const CATEGORIES = ["Wichtig", "Antwort erforderlich", "Schule", "Bewerbungen und Karriere", "Sport und Karate", "Reisen", "Termine und Veranstaltungen", "Rechnungen und Finanzen", "Bestellungen und Lieferungen", "Verträge und Versicherungen", "Behörden", "Konten und Sicherheit", "Persönlich", "Newsletter und Werbung", "Automatische Benachrichtigungen", "Sonstiges"];

type Rule = { id: string; match_type: string; match_value: string; set_category: string | null; set_hidden: boolean };
type Account = { id: string; email: string; provider: string };

export default function Settings({ accounts, initialRules, sendEnabled }: { accounts: Account[]; initialRules: Rule[]; sendEnabled: boolean }) {
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [form, setForm] = useState({ match_type: "sender", match_value: "", set_category: CATEGORIES[0], set_hidden: false });
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!form.match_value.trim()) return;
    setBusy(true);
    const r = await fetch("/api/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json();
    if (r.ok && j.rule) setRules((rs) => [j.rule, ...rs.filter((x) => x.id !== j.rule.id)]);
    setForm((f) => ({ ...f, match_value: "" }));
    setBusy(false);
  }
  async function del(id: string) {
    await fetch("/api/rules", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    setRules((rs) => rs.filter((r) => r.id !== id));
  }

  const accLabel = (id: string) => { const a = accounts.find((x) => x.id === id); return a ? `${PROVIDERS[a.provider]?.label || a.provider} · ${a.email}` : id; };

  return (
    <>
      <div className="topbar">
        <div className="brand"><span className="mark" /><h1>Einstellungen</h1></div>
        <div className="spacer" />
        <a className="btn small" href="/">Zurück zum Cockpit</a>
      </div>
      <div className="wrap" style={{ maxWidth: 760 }}>
        <div className="bucket">
          <div className="bh"><span className="bt">Verbundene Postfächer</span></div>
          {accounts.length === 0 && <div className="note">Noch kein Postfach verbunden.</div>}
          {accounts.map((a) => (
            <div className="mail" key={a.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="acct-pill">{PROVIDERS[a.provider]?.label || a.provider} · {a.email}</span>
            </div>
          ))}
        </div>

        <div className="bucket">
          <div className="bh"><span className="bt">Sortierregeln</span><span className="bc">{rules.length}</span></div>
          <div className="note" style={{ marginTop: 0, marginBottom: 12 }}>
            Regeln haben Vorrang vor der KI-Kategorisierung. Neue und vorhandene Nachrichten werden automatisch einsortiert.
          </div>

          <div className="mail" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1.4fr auto", gap: 8, alignItems: "end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="label" style={{ margin: 0 }}>Wenn</span>
              <select value={form.match_type} onChange={(e) => setForm((f) => ({ ...f, match_type: e.target.value }))}>
                <option value="sender">Absender ist</option>
                <option value="domain">Domain ist</option>
                <option value="account">Konto ist</option>
              </select>
            </label>
            {form.match_type === "account" ? (
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="label" style={{ margin: 0 }}>Konto</span>
                <select value={form.match_value} onChange={(e) => setForm((f) => ({ ...f, match_value: e.target.value }))}>
                  <option value="">— wählen —</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{accLabel(a.id)}</option>)}
                </select>
              </label>
            ) : (
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="label" style={{ margin: 0 }}>Wert</span>
                <input placeholder={form.match_type === "domain" ? "verein.de" : "trainer@verein.de"} value={form.match_value} onChange={(e) => setForm((f) => ({ ...f, match_value: e.target.value }))} />
              </label>
            )}
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="label" style={{ margin: 0 }}>Dann Kategorie</span>
              <select value={form.set_category} onChange={(e) => setForm((f) => ({ ...f, set_category: e.target.value }))}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" onClick={add} disabled={busy || !form.match_value.trim()}>Hinzufügen</button>
          </div>

          <div style={{ marginTop: 12 }}>
            {rules.map((r) => (
              <div className="mail" key={r.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, fontSize: 13 }}>
                  <b>{r.match_type === "account" ? accLabel(r.match_value) : r.match_value}</b> → {r.set_hidden ? "ausblenden" : r.set_category}
                  <span style={{ opacity: 0.5 }}> ({r.match_type})</span>
                </span>
                <button className="btn small btn-danger" onClick={() => del(r.id)}>Löschen</button>
              </div>
            ))}
            {rules.length === 0 && <div className="empty" style={{ padding: 30 }}>Noch keine Regeln.</div>}
          </div>
        </div>

        <div className="bucket">
          <div className="bh"><span className="bt">Versand</span></div>
          <div className="note" style={{ marginTop: 0 }}>
            Der E-Mail-Versand ist {sendEnabled ? <b>aktiviert</b> : <b>deaktiviert</b>}. {sendEnabled ? "Antworten und neue Mails können nach Bestätigung gesendet werden." : "Setze die Umgebungsvariable ENABLE_SEND=true in Vercel, um Senden freizuschalten. Ohne diese Variable werden nur Entwürfe erstellt."}
          </div>
        </div>
      </div>
    </>
  );
}
