"use client";
import { useEffect, useState } from "react";
import { PROVIDERS } from "@/lib/mailProviders";
import { Notice, notify } from "./Feedback";
import { jsonRequest, requestJson } from "@/lib/http";

function ImageSetting() {
  const [mode, setMode] = useState("always");
  useEffect(() => {
    try { setMode(localStorage.getItem("imgMode") || "always"); } catch {}
  }, []);
  function update(value: string) {
    setMode(value);
    try { localStorage.setItem("imgMode", value); } catch {}
  }
  const options = [
    ["always", "Bilder immer automatisch laden", "Logos und Bilder erscheinen sofort (empfohlen)."],
    ["known", "Nur bei bekannten Absendern", "Automatisch nur bei Absendern, deren Bilder du schon einmal geladen hast."],
    ["never", "Bilder immer blockieren", "Bilder erst nach Klick auf „Externe Bilder laden“."]
  ];
  return (
    <div className="bucket">
      <div className="bh"><span className="bt">E-Mail-Bilder</span></div>
      <div className="note" style={{ marginTop: 0, marginBottom: 10 }}>
        Externe Bilder werden über einen sicheren Proxy geladen. Typische Trackingpixel, Skripte und Formulare bleiben blockiert.
      </div>
      {options.map(([value, title, description]) => (
        <label key={value} className="mail" style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
          <input type="radio" name="imgmode" checked={mode === value} onChange={() => update(value)} style={{ marginTop: 3 }} />
          <span><b style={{ fontSize: 13.5 }}>{title}</b><br /><span className="note" style={{ margin: 0 }}>{description}</span></span>
        </label>
      ))}
    </div>
  );
}

const CATEGORIES = ["Wichtig", "Antwort erforderlich", "Schule", "Bewerbungen und Karriere", "Sport und Karate", "Reisen", "Termine und Veranstaltungen", "Rechnungen und Finanzen", "Bestellungen und Lieferungen", "Verträge und Versicherungen", "Behörden", "Konten und Sicherheit", "Persönlich", "Newsletter und Werbung", "Automatische Benachrichtigungen", "Sonstiges"];

type Rule = { id: string; match_type: string; match_value: string; set_category: string | null; set_hidden: boolean; set_label?: string | null; set_needs_reply?: boolean | null };
type Account = { id: string; email: string; provider: string };

function ruleEffect(rule: Rule): string {
  const parts: string[] = [];
  if (rule.set_label) parts.push("Label „" + rule.set_label + "“");
  if (rule.set_category) parts.push(rule.set_category);
  if (rule.set_hidden) parts.push("ausblenden");
  if (rule.set_needs_reply === false) parts.push("nie antwortpflichtig");
  if (rule.set_needs_reply === true) parts.push("immer antwortpflichtig");
  return parts.length ? parts.join(" · ") : "—";
}

const FOLDER_TYPES = [["inbox", "Posteingang"], ["sent", "Gesendet"], ["drafts", "Entwürfe"], ["archive", "Archiv"], ["spam", "Junk"], ["trash", "Papierkorb"], ["other", "Weitere"]];
const FTYPE_LABEL: Record<string, string> = Object.fromEntries(FOLDER_TYPES);

export default function Settings({ accounts, initialRules, initialFolders = [], initialError = null, sendEnabled }: { accounts: Account[]; initialRules: Rule[]; initialFolders?: any[]; initialError?: string | null; sendEnabled: boolean }) {
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [folders, setFolders] = useState<any[]>(initialFolders);
  const [form, setForm] = useState({ match_type: "sender", match_value: "", set_category: CATEGORIES[0], set_hidden: false });
  const [busy, setBusy] = useState(false);
  const [deletingRule, setDeletingRule] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(initialError);
  const [newName, setNewName] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState<string | null>(null);

  const folderKey = (folder: any) => String(folder.account_id) + ":" + String(folder.path);

  async function patchFolder(folder: any, patch: any) {
    const key = folderKey(folder);
    if (folderBusy.has(key)) return;
    const previous = folders.find((item) => folderKey(item) === key);
    setError(null);
    setFolderBusy((current) => new Set(current).add(key));
    setFolders((current) => current.map((item) => folderKey(item) === key ? { ...item, ...patch } : item));
    try {
      await requestJson("/api/mail/folders", jsonRequest("PATCH", { account_id: folder.account_id, path: folder.path, ...patch }));
      notify("Ordneranzeige gespeichert.");
    } catch (caught) {
      if (previous) setFolders((current) => current.map((item) => folderKey(item) === key ? previous : item));
      setError((caught as Error).message);
    } finally {
      setFolderBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function foldersOf(accountId: string) {
    return folders.filter((folder) => folder.account_id === accountId)
      .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
  }

  async function createFolder(accountId: string, name: string) {
    if (!name.trim() || creating) return;
    setCreating(accountId);
    setError(null);
    try {
      const data = await requestJson("/api/mail/create-folder", jsonRequest("POST", { account: accountId, name: name.trim() }));
      setFolders((current) => [
        ...current.filter((item) => !(item.account_id === accountId && item.path === data.path)),
        { account_id: accountId, path: data.path, folder_type: data.folder_type, unread: 0, total: 0 }
      ]);
      setNewName((current) => ({ ...current, [accountId]: "" }));
      notify(data.warning || "Ordner erstellt.");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setCreating(null);
    }
  }

  async function move(accountId: string, folder: any, direction: number) {
    const list = foldersOf(accountId);
    const index = list.findIndex((item) => item.path === folder.path);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= list.length) return;
    const first = list[index];
    const second = list[targetIndex];
    const keys = [folderKey(first), folderKey(second)];
    if (keys.some((key) => folderBusy.has(key))) return;
    setError(null);
    setFolderBusy((current) => new Set([...current, ...keys]));
    try {
      await Promise.all([
        requestJson("/api/mail/folders", jsonRequest("PATCH", { account_id: first.account_id, path: first.path, sort_order: targetIndex })),
        requestJson("/api/mail/folders", jsonRequest("PATCH", { account_id: second.account_id, path: second.path, sort_order: index }))
      ]);
      setFolders((current) => current.map((item) => {
        if (folderKey(item) === keys[0]) return { ...item, sort_order: targetIndex };
        if (folderKey(item) === keys[1]) return { ...item, sort_order: index };
        return item;
      }));
      notify("Reihenfolge gespeichert.");
    } catch (caught) {
      setError((caught as Error).message + " Bitte die Seite neu laden, um den Serverstand zu prüfen.");
    } finally {
      setFolderBusy((current) => {
        const next = new Set(current);
        keys.forEach((key) => next.delete(key));
        return next;
      });
    }
  }

  function folderName(folder: any) {
    if (folder.display_name) return folder.display_name;
    const type = folder.type_override || folder.folder_type;
    if (type === "other" && folder.path) {
      const sections = String(folder.path).split(/[/.]/).filter(Boolean);
      return sections[sections.length - 1] || "Weitere";
    }
    return FTYPE_LABEL[type] || type;
  }

  async function add() {
    if (!form.match_value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await requestJson("/api/rules", jsonRequest("POST", form));
      if (!data.rule) throw new Error("Regel konnte nicht gespeichert werden.");
      setRules((current) => [data.rule, ...current.filter((rule) => rule.id !== data.rule.id)]);
      setForm((current) => ({ ...current, match_value: "" }));
      notify(data.warning || "Regel gespeichert.");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(id: string) {
    if (deletingRule || !confirm("Diese Regel löschen?")) return;
    setDeletingRule(id);
    setError(null);
    try {
      await requestJson("/api/rules", jsonRequest("DELETE", { id }));
      setRules((current) => current.filter((rule) => rule.id !== id));
      notify("Regel gelöscht.");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setDeletingRule(null);
    }
  }

  const accountLabel = (id: string) => {
    const account = accounts.find((item) => item.id === id);
    return account ? (PROVIDERS[account.provider]?.label || account.provider) + " · " + account.email : id;
  };

  return (
    <>
      <div className="topbar">
        <div className="brand"><span className="mark" /><h1>Einstellungen</h1></div>
        <div className="spacer" />
        <a className="btn small" href="/">Zurück zum Cockpit</a>
      </div>
      <div className="wrap" style={{ maxWidth: 760 }}>
        {error && <Notice>{error}</Notice>}

        <div className="bucket">
          <div className="bh"><span className="bt">Verbundene Postfächer</span></div>
          {accounts.length === 0 && <div className="note">Noch kein Postfach verbunden.</div>}
          {accounts.map((account) => (
            <div className="mail" key={account.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="acct-pill">{PROVIDERS[account.provider]?.label || account.provider} · {account.email}</span>
            </div>
          ))}
        </div>

        <div className="bucket">
          <div className="bh"><span className="bt">Sortierregeln</span><span className="bc">{rules.length}</span></div>
          <div className="note" style={{ marginTop: 0, marginBottom: 12 }}>
            Regeln haben Vorrang vor der KI-Kategorisierung. Neue und vorhandene Nachrichten werden automatisch einsortiert.
          </div>
          <div className="mail settings-rule-form" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1.4fr auto", gap: 8, alignItems: "end" }}>
            <label className="field"><span className="label" style={{ margin: 0 }}>Wenn</span>
              <select value={form.match_type} onChange={(event) => setForm((current) => ({ ...current, match_type: event.target.value }))}>
                <option value="sender">Absender ist</option>
                <option value="domain">Domain ist</option>
                <option value="account">Konto ist</option>
              </select>
            </label>
            {form.match_type === "account" ? (
              <label className="field"><span className="label" style={{ margin: 0 }}>Konto</span>
                <select value={form.match_value} onChange={(event) => setForm((current) => ({ ...current, match_value: event.target.value }))}>
                  <option value="">— wählen —</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account.id)}</option>)}
                </select>
              </label>
            ) : (
              <label className="field"><span className="label" style={{ margin: 0 }}>Wert</span>
                <input placeholder={form.match_type === "domain" ? "verein.de" : "trainer@verein.de"} value={form.match_value} onChange={(event) => setForm((current) => ({ ...current, match_value: event.target.value }))} />
              </label>
            )}
            <label className="field"><span className="label" style={{ margin: 0 }}>Dann Kategorie</span>
              <select value={form.set_category} onChange={(event) => setForm((current) => ({ ...current, set_category: event.target.value }))}>
                {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" onClick={add} disabled={busy || !form.match_value.trim()}>{busy ? "Speichert…" : "Hinzufügen"}</button>
          </div>

          <div style={{ marginTop: 12 }}>
            {rules.map((rule) => (
              <div className="mail" key={rule.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, fontSize: 13 }}>
                  <b>{rule.match_type === "account" ? accountLabel(rule.match_value) : rule.match_value}</b> → {ruleEffect(rule)}
                  <span style={{ opacity: 0.5 }}> ({rule.match_type})</span>
                </span>
                <button className="btn small btn-danger" disabled={deletingRule === rule.id} onClick={() => removeRule(rule.id)}>{deletingRule === rule.id ? "Löscht…" : "Löschen"}</button>
              </div>
            ))}
            {rules.length === 0 && <div className="empty" style={{ padding: 30 }}>Noch keine Regeln.</div>}
          </div>
        </div>

        <div className="bucket">
          <div className="bh"><span className="bt">Ordneranzeige</span></div>
          <div className="note" style={{ marginTop: 0, marginBottom: 12 }}>
            Umbenennen, aus- und einblenden, Reihenfolge und Typ ändern nur die Anzeige. „Ordner erstellen“ legt einen echten Ordner auf dem Mailserver an.
          </div>
          {accounts.map((account) => {
            const accountFolders = foldersOf(account.id);
            if (!accountFolders.length) return null;
            return (
              <div key={account.id} style={{ marginBottom: 14 }}>
                <div className="label" style={{ margin: "0 0 6px" }}>{PROVIDERS[account.provider]?.label || account.provider} · {account.email}</div>
                {accountFolders.map((folder) => {
                  const pending = folderBusy.has(folderKey(folder));
                  return <div className="mail folder-edit" key={folder.path} aria-busy={pending} style={{ display: "flex", alignItems: "center", gap: 8, opacity: folder.hidden ? 0.5 : 1 }}>
                    <input className="fe-name" value={folderName(folder)} disabled={pending} onChange={(event) => setFolders((current) => current.map((item) => folderKey(item) === folderKey(folder) ? { ...item, display_name: event.target.value } : item))}
                      onBlur={(event) => patchFolder(folder, { display_name: event.target.value })} title={folder.path} />
                    <select className="fe-type" value={folder.type_override || folder.folder_type} disabled={pending} onChange={(event) => patchFolder(folder, { type_override: event.target.value })} title="Typ (nur Anzeige)">
                      {FOLDER_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <button className="btn small" disabled={pending} onClick={() => move(account.id, folder, -1)} title="Nach oben">↑</button>
                    <button className="btn small" disabled={pending} onClick={() => move(account.id, folder, 1)} title="Nach unten">↓</button>
                    <button className="btn small" disabled={pending} onClick={() => patchFolder(folder, { hidden: !folder.hidden })}>{folder.hidden ? "Einblenden" : "Ausblenden"}</button>
                  </div>;
                })}
                <div className="mail folder-create" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <input className="fe-name" placeholder="Neuer Ordnername (z. B. Archiv)" value={newName[account.id] || ""} onChange={(event) => setNewName((current) => ({ ...current, [account.id]: event.target.value }))} />
                  <button className="btn small btn-primary" disabled={creating === account.id || !(newName[account.id] || "").trim()} onClick={() => createFolder(account.id, newName[account.id] || "")}>{creating === account.id ? "Erstellt…" : "Ordner erstellen"}</button>
                  {!accountFolders.some((folder) => (folder.type_override || folder.folder_type) === "archive") && (
                    <button className="btn small" disabled={creating === account.id} onClick={() => createFolder(account.id, "Archiv")} title="Echten Archiv-Ordner auf dem Server anlegen">Archiv anlegen</button>
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
            Der E-Mail-Versand ist {sendEnabled ? <b>aktiviert</b> : <b>deaktiviert</b>}. {sendEnabled ? "Antworten und neue Mails können nach Bestätigung gesendet werden." : "Aktiviere ENABLE_SEND=true in der Bereitstellungsumgebung, um Senden freizuschalten. Ohne diese Einstellung werden nur Entwürfe erstellt."}
          </div>
        </div>
      </div>
    </>
  );
}