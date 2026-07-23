"use client";
import { useEffect, useState } from "react";
import { PROVIDERS } from "@/lib/mailProviders";

function ImageSetting() {
  const [mode, setMode] = useState("always");
  useEffect(() => { try { setMode(localStorage.getItem("imgMode") || "always"); } catch {} }, []);
  function set(v: string) { setMode(v); try { localStorage.setItem("imgMode", v); } catch {} }
  const opts = [["always", "Bilder immer automatisch laden", "Logos und Bilder erscheinen sofort (empfohlen)."], ["known", "Nur bei bekannten Absendern", "Automatisch nur bei Absendern, deren Bilder du schon einmal geladen hast."], ["never", "Bilder immer blockieren", "Bilder erst nach Klick auf „Externe Bilder laden“."]];
  return (
    <div className="bucket">
      <div className="bh"><span className="bt">E-Mail-Bilder</span></div>
      <div className="note" style={{ marginTop: 0, marginBottom: 10 }}>
        Externe Bilder werden über einen sicheren Proxy geladen (deine IP/Adresse geht nicht an den Bildserver), typische 1×1-Trackingpixel werden blockiert. Skripte/Formulare bleiben immer blockiert.
      </div>
      {opts.map(([v, t, d]) => (
        <label key={v} className="mail" style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
          <input type="radio" name="imgmode" checked={mode === v} onChange={() => set(v)} style={{ marginTop: 3 }} />
          <span><b style={{ fontSize: 13.5 }}>{t}</b><br /><span className="note" style={{ margin: 0 }}>{d}</span></span>
        </label>
      ))}
    </div>
  );
}

const CATEGORIES = ["Wichtig", "Antwort erforderlich", "Schule", "Bewerbungen und Karriere", "Sport und Karate", "Reisen", "Termine und Veranstaltungen", "Rechnungen und Finanzen", "Bestellungen und Lieferungen", "Verträge und Versicherungen", "Behörden", "Konten und Sicherheit", "Persönlich", "Newsletter und Werbung", "Automatische Benachrichtigungen", "Sonstiges"];

type Rule = { id: string; match_type: string; match_value: string; set_category: string | null; set_hidden: boolean; set_label?: string | null; set_needs_reply?: boolean | null };

function ruleEffect(r: Rule): string {
  const parts: string[] = [];
  if (r.set_label) parts.push(`Label „${r.set_label}"`);
  if (r.set_category) parts.push(r.set_category);
  if (r.set_hidden) parts.push("ausblenden");
  if (r.set_needs_reply === false) parts.push("nie antwortpflichtig");
  if (r.set_needs_reply === true) parts.push("immer antwortpflichtig");
  return parts.length ? parts.join(" · ") : "—";
}
type Account = { id: string; email: string; provider: string };

const FOLDER_TYPES = [["inbox", "Posteingang"], ["sent", "Gesendet"], ["drafts", "Entwürfe"], ["archive", "Archiv"], ["spam", "Junk"], ["trash", "Papierkorb"], ["other", "Weitere"]];
const FTYPE_LABEL: Record<string, string> = Object.fromEntries(FOLDER_TYPES);

export default function Settings({ accounts, initialRules, initialFolders = [], sendEnabled }: { accounts: Account[]; initialRules: Rule[]; initialFolders?: any[]; sendEnabled: boolean }) {
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [folders, setFolders] = useState<any[]>(initialFolders);
  const [form, setForm] = useState({ match_type: "sender", match_value: "", set_category: CATEGORIES[0], set_hidden: false });
  const [busy, setBusy] = useState(false);

  async function patchFolder(f: any, patch: any) {
    setFolders((fs) => fs.map((x) => (x.account_id === f.account_id && x.path === f.path) ? { ...x, ...patch } : x));
    await fetch("/api/mail/folders", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ account_id: f.account_id, path: f.path, ...patch }) });
  }
  function foldersOf(accId: string) {
    return folders.filter((f) => f.account_id === accId)
      .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
  }
  const [newName, setNewName] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState<string | null>(null);
  async function createFolder(accId: string, name: string) {
    if (!name.trim()) return;
    setCreating(accId);
    const r = await fetch("/api/mail/create-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: accId, name: name.trim() }) });
    const j = await r.json();
    setCreating(null);
    if (r.ok) {
      setFolders((fs) => [...fs.filter((x) => !(x.account_id === accId && x.path === j.path)), { account_id: accId, path: j.path, folder_type: j.folder_type, unread: 0, total: 0 }]);
      setNewName((n) => ({ ...n, [accId]: "" }));
    } else alert(j.message || "Ordner konnte nicht erstellt werden.");
  }
  async function move(accId: string, f: any, dir: number) {
    const list = foldersOf(accId);
    const i = list.findIndex((x) => x.path === f.path);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    await patchFolder(list[i], { sort_order: j });
    await patchFolder(list[j], { sort_order: i });
  }
  function folderName(f: any) {
    if (f.display_name) return f.display_name;
    const t = f.type_override || f.folder_type;
    if (t === "other" && f.path) { const s = String(f.path).split(/[/.]/).filter(Boolean); return s[s.length - 1] || "Weitere"; }
    return FTYPE_LABEL[t] || t;
  }

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
                  <b>{r.match_type === "account" ? accLabel(r.match_value) : r.match_value}</b> → {ruleEffect(r)}
                  <span style={{ opacity: 0.5 }}> ({r.match_type})</span>
                </span>
                <button className="btn small btn-danger" onClick={() => del(r.id)}>Löschen</button>
              </div>
            ))}
            {rules.length === 0 && <div className="empty" style={{ padding: 30 }}>Noch keine Regeln.</div>}
          </div>
        </div>

        <div className="bucket">
          <div className="bh"><span className="bt">Ordneranzeige</span></div>
          <div className="note" style={{ marginTop: 0, marginBottom: 12 }}>
            Umbenennen, aus-/einblenden, Reihenfolge und Typ ändern <b>nur die Anzeige</b> – der Server-Ordner bleibt unverändert. <b>„Ordner erstellen"</b> hingegen legt einen <b>echten</b> Ordner auf dem Mailserver an (z. B. „Archiv" für WEB.DE).
          </div>
          {accounts.map((a) => {
            const fl = foldersOf(a.id);
            if (!fl.length) return null;
            return (
              <div key={a.id} style={{ marginBottom: 14 }}>
                <div className="label" style={{ margin: "0 0 6px" }}>{PROVIDERS[a.provider]?.label || a.provider} · {a.email}</div>
                {fl.map((f) => (
                  <div className="mail folder-edit" key={f.path} style={{ display: "flex", alignItems: "center", gap: 8, opacity: f.hidden ? 0.5 : 1 }}>
                    <input className="fe-name" value={folderName(f)} onChange={(e) => setFolders((fs) => fs.map((x) => (x.account_id === f.account_id && x.path === f.path) ? { ...x, display_name: e.target.value } : x))}
                      onBlur={(e) => patchFolder(f, { display_name: e.target.value })} title={f.path} />
                    <select className="fe-type" value={f.type_override || f.folder_type} onChange={(e) => patchFolder(f, { type_override: e.target.value })} title="Typ (nur Anzeige)">
                      {FOLDER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <button className="btn small" onClick={() => move(a.id, f, -1)} title="Nach oben">↑</button>
                    <button className="btn small" onClick={() => move(a.id, f, 1)} title="Nach unten">↓</button>
                    <button className="btn small" onClick={() => patchFolder(f, { hidden: !f.hidden })}>{f.hidden ? "Einblenden" : "Ausblenden"}</button>
                  </div>
                ))}
                <div className="mail" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <input className="fe-name" placeholder="Neuer Ordnername (z. B. Archiv)" value={newName[a.id] || ""} onChange={(e) => setNewName((n) => ({ ...n, [a.id]: e.target.value }))} />
                  <button className="btn small btn-primary" disabled={creating === a.id || !(newName[a.id] || "").trim()} onClick={() => createFolder(a.id, newName[a.id] || "")}>{creating === a.id ? "Erstelle…" : "Ordner erstellen"}</button>
                  {!fl.some((f) => (f.type_override || f.folder_type) === "archive") && (
                    <button className="btn small" disabled={creating === a.id} onClick={() => createFolder(a.id, "Archiv")} title="Echten Archiv-Ordner auf dem Server anlegen">＋ Archiv anlegen</button>
                  )}
                </div>
              </div>
            );
          })}
          {folders.length === 0 && <div className="empty" style={{ padding: 20 }}>Noch keine Ordner geladen. Öffne einmal den E-Mail-Bereich.</div>}
        </div>

        <ImageSetting />

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
