"use client";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { PROVIDERS } from "@/lib/mailProviders";

type Msg = any;

const BUCKETS: { k: string; t: string; c: string }[] = [
  { k: "sofort", t: "Sofort beantworten", c: "#FF453A" },
  { k: "heute", t: "Heute beantworten", c: "#FF9F0A" },
  { k: "woche", t: "Diese Woche beantworten", c: "#0A84FF" },
  { k: "spaeter", t: "Später beantworten", c: "#98989D" },
  { k: "warten", t: "Warten auf Antwort", c: "#BF5AF2" },
  { k: "info", t: "Nur zur Information", c: "#30D158" },
  { k: "newsletter", t: "Newsletter & Automatisch", c: "#98989D" }
];
const CATEGORIES = ["Wichtig", "Antwort erforderlich", "Schule", "Bewerbungen und Karriere", "Sport und Karate", "Reisen", "Termine und Veranstaltungen", "Rechnungen und Finanzen", "Bestellungen und Lieferungen", "Verträge und Versicherungen", "Behörden", "Konten und Sicherheit", "Persönlich", "Newsletter und Werbung", "Automatische Benachrichtigungen", "Sonstiges"];
const FOLDER_LABELS: Record<string, string> = { inbox: "Posteingang", sent: "Gesendet", drafts: "Entwürfe", archive: "Archiv", spam: "Spam", trash: "Papierkorb", other: "Weitere" };
const TONES = ["Professionell", "Freundlich", "Kurz und direkt", "Förmlich", "Locker"];
const COMMANDS = ["Kürzer", "Freundlicher", "Förmlicher", "Direkter", "Wärmer", "Weniger begeistert", "Mehr Kontext", "Rechtschreibung prüfen"];

type Account = { id: string; email: string; provider: string };

export default function Cockpit({
  connected,
  accounts,
  sendEnabled
}: {
  connected: boolean;
  accounts: Account[];
  sendEnabled: boolean;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [compose, setCompose] = useState<any>(null);
  const [filter, setFilter] = useState({ account: "all", folder: "all", cat: "all", unread: false, needs: false, q: "" });
  const [suggests, setSuggests] = useState<Record<string, any[]>>({});
  const accById: Record<string, Account> = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const [drawer, setDrawer] = useState<any>(null); // { msg, mode, loading, draft, body, tone, customInstruction, confirmBinding, sending }
  const uidRef = useRef<string | null>(null);

  // ---- Live-Daten aus Supabase (Realtime) ----
  useEffect(() => {
    const supabase = supabaseBrowser();
    let channel: any;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      uidRef.current = user.id;
      const { data } = await supabase.from("messages").select("*").eq("is_deleted", false).order("received_at", { ascending: false });
      setMsgs(data || []);
      channel = supabase
        .channel("messages-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `user_id=eq.${user.id}` }, (payload: any) => {
          setMsgs((prev) => {
            const row = payload.new || payload.old;
            if (!row) return prev;
            if (payload.eventType === "DELETE") return prev.filter((m) => m.id !== row.id);
            const next = prev.filter((m) => m.id !== row.id);
            if (!row.is_deleted) next.unshift(row);
            return next.sort((a, b) => new Date(b.received_at || 0).getTime() - new Date(a.received_at || 0).getTime());
          });
        })
        .subscribe();
    })();
    return () => { if (channel) channel.unsubscribe(); };
  }, []);

  // ---- Beim Öffnen einmal synchronisieren (holt neue Mails) ----
  useEffect(() => {
    if (!connected) return;
    manualSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ---- Vorschläge lazy laden (nur für zu beantwortende, noch nicht gesendete Mails) ----
  async function ensureSuggestions(m: Msg) {
    if (suggests[m.id]) return;
    if (m.suggested_replies) { setSuggests((s) => ({ ...s, [m.id]: m.suggested_replies })); return; }
    setSuggests((s) => ({ ...s, [m.id]: [] })); // Platzhalter, verhindert Doppelabruf
    try {
      const r = await fetch("/api/reply/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: m.id }) });
      if (r.ok) { const j = await r.json(); setSuggests((s) => ({ ...s, [m.id]: j.suggestions || [] })); }
    } catch {}
  }

  function visible(m: Msg) {
    if (m.is_deleted) return false;
    if (m.hidden && !showHidden) return false;
    if (filter.account !== "all" && m.mail_account_id !== filter.account) return false;
    if (filter.folder !== "all" && (m.folder_type || "inbox") !== filter.folder) return false;
    if (filter.cat !== "all" && (m.semantic_category || "Sonstiges") !== filter.cat) return false;
    if (filter.unread && m.is_read) return false;
    if (filter.needs && !m.needs_reply) return false;
    if (filter.q) {
      const q = filter.q.toLowerCase();
      const hay = `${m.from_name || ""} ${m.from_address || ""} ${m.subject || ""} ${m.preview || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  const usedCats = Array.from(new Set(msgs.map((m) => m.semantic_category).filter(Boolean))) as string[];

  async function manualSync() {
    setStatus((s: any) => ({ ...s, syncing: true }));
    let errors: string[] = [];
    try {
      const r = await fetch("/api/mail/sync", { method: "POST" });
      if (r.ok) {
        const j = await r.json();
        errors = j.errors || [];
      }
    } catch {}
    // Nachrichten frisch laden (Realtime pusht sonst nur neue Inserts).
    try {
      const supabase = supabaseBrowser();
      const { data } = await supabase.from("messages").select("*").eq("is_deleted", false).order("received_at", { ascending: false });
      setMsgs(data || []);
    } catch {}
    setStatus({ syncing: false, errors });
  }

  // ---- Entwurf erzeugen (aus Vorschlag oder Freitext) ----
  async function openDraft(m: Msg, opts: { intent?: string; intentLabel?: string; custom?: boolean }) {
    if (opts.custom) {
      setDrawer({ msg: m, mode: "custom", customInstruction: "", tone: "Professionell" });
      return;
    }
    setDrawer({ msg: m, mode: "generated", loading: true, tone: null });
    await generate(m, { intent: opts.intent, intentLabel: opts.intentLabel, tone: undefined });
  }

  async function generate(m: Msg, p: { intent?: string; intentLabel?: string; customInstruction?: string; tone?: string }) {
    setDrawer((d: any) => ({ ...d, loading: true }));
    try {
      const r = await fetch("/api/reply/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: m.id, intent: p.intent, intentLabel: p.intentLabel, customInstruction: p.customInstruction, tone: p.tone })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Fehler");
      setDrawer((d: any) => ({
        ...d, mode: "generated", loading: false, draft: j.draft, body: j.draft.body,
        tone: j.draft.tone,
        fromAccountId: d.fromAccountId || m.mail_account_id,
        intent: p.intent, intentLabel: p.intentLabel, customInstruction: p.customInstruction, confirmBinding: false
      }));
    } catch (e: any) {
      setDrawer((d: any) => ({ ...d, loading: false, error: e.message }));
    }
  }

  async function refine(command: string) {
    if (!drawer) return;
    setDrawer((d: any) => ({ ...d, refining: true }));
    try {
      const r = await fetch("/api/reply/refine", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: drawer.msg.id, command }) });
      const j = await r.json();
      if (r.ok) setDrawer((d: any) => ({ ...d, body: j.body, refining: false }));
      else setDrawer((d: any) => ({ ...d, refining: false }));
    } catch { setDrawer((d: any) => ({ ...d, refining: false })); }
  }

  async function changeTone(tone: string) {
    if (!drawer) return;
    setDrawer((d: any) => ({ ...d, tone }));
    await generate(drawer.msg, { intent: drawer.intent, intentLabel: drawer.intentLabel, customInstruction: drawer.customInstruction, tone });
  }

  async function saveEdited() {
    if (!drawer) return;
    await fetch("/api/reply/refine", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: drawer.msg.id, editedBody: drawer.body }) });
  }

  async function send() {
    if (!drawer) return;
    setDrawer((d: any) => ({ ...d, sending: true }));
    await saveEdited(); // aktuellen (ggf. bearbeiteten) Text sichern
    try {
      const r = await fetch("/api/reply/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: drawer.msg.id, confirm: true, fromAccountId: drawer.fromAccountId }) });
      const j = await r.json();
      if (r.ok) setDrawer(null);
      else setDrawer((d: any) => ({ ...d, sending: false, error: j.message || j.error }));
    } catch (e: any) { setDrawer((d: any) => ({ ...d, sending: false, error: e.message })); }
  }

  async function categorize(m: Msg, opts: { category?: string; hidden?: boolean; ruleScope?: "sender" | "domain" }) {
    // Optimistisch aktualisieren.
    setMsgs((prev) => prev.map((x) => x.id === m.id ? { ...x, semantic_category: opts.category ?? x.semantic_category, hidden: opts.hidden ?? x.hidden, classification_source: "user" } : x));
    try {
      await fetch("/api/mail/categorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: m.id, ...opts }) });
    } catch {}
  }

  const statusView = () => {
    if (!connected) return <span className="status"><span className="sdot" />Kein Postfach verbunden</span>;
    if (status?.syncing) return <span className="status sync"><span className="sdot" />Synchronisierung läuft…</span>;
    if (status?.errors && status.errors.length) return <span className="status err"><span className="sdot" />Sync-Fehler</span>;
    return <span className="status live"><span className="sdot" />Verbunden · {accounts.length} Postfach{accounts.length === 1 ? "" : "er"}</span>;
  };

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <span className="mark" />
          <h1>Cockpit</h1>
        </div>
        <div className="spacer" />
        {statusView()}
        {connected && <button className="btn small ghost" onClick={manualSync} aria-label="Aktualisieren" title="Aktualisieren">↻</button>}
        <a className="btn small ghost" href="/settings" title="Einstellungen" aria-label="Einstellungen">⚙</a>
        {connected && <button className="btn small" onClick={() => setCompose({ fromAccountId: accounts[0]?.id, to: "", cc: "", bcc: "", subject: "", body: "", instruction: "" })}>Neue E-Mail</button>}
        <button className="btn btn-primary small" onClick={() => setShowConnect((v) => !v)}>
          {connected ? "+ Postfach" : "Postfach verbinden"}
        </button>
      </div>

      <div className="wrap">
        {(showConnect || !connected) && <ConnectForm accounts={accounts} onClose={() => setShowConnect(false)} />}

        {status?.errors && status.errors.length > 0 && (
          <div className="note binding-warn" style={{ marginBottom: 18 }}>
            <b>Synchronisierung fehlgeschlagen:</b>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {status.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        {connected && (
          <div className="filterbar">
            <input className="f-search" placeholder="Suche über alle Postfächer…" value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} />
            <select value={filter.account} onChange={(e) => setFilter((f) => ({ ...f, account: e.target.value }))}>
              <option value="all">Alle Postfächer</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{PROVIDERS[a.provider]?.label || a.provider} · {a.email}</option>)}
            </select>
            <select value={filter.folder} onChange={(e) => setFilter((f) => ({ ...f, folder: e.target.value }))}>
              <option value="all">Alle Ordner</option>
              <option value="inbox">Posteingang</option>
              <option value="sent">Gesendet</option>
            </select>
            <select value={filter.cat} onChange={(e) => setFilter((f) => ({ ...f, cat: e.target.value }))}>
              <option value="all">Alle Kategorien</option>
              {usedCats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className={"chip" + (filter.unread ? " sel" : "")} onClick={() => setFilter((f) => ({ ...f, unread: !f.unread }))}>Ungelesen</button>
            <button className={"chip" + (filter.needs ? " sel" : "")} onClick={() => setFilter((f) => ({ ...f, needs: !f.needs }))}>Antwort nötig</button>
            <button className="chip" onClick={() => setShowHidden((v) => !v)}>{showHidden ? "Newsletter aus" : "Newsletter an"}</button>
          </div>
        )}

        {BUCKETS.map((bk) => {
          const list = msgs.filter((m) => visible(m) && (m.category || "info") === bk.k);
          if (!list.length) return null;
          return (
            <div className="bucket" key={bk.k}>
              <div className="bh"><span className="bd" style={{ background: bk.c }} /><span className="bt">{bk.t}</span><span className="bc">{list.length}</span></div>
              {list.map((m) => (
                <MailCard key={m.id} m={m} account={accById[m.mail_account_id]} suggests={suggests[m.id]} ensure={ensureSuggestions} onReply={openDraft} onCategorize={categorize} />
              ))}
            </div>
          );
        })}

        {connected && msgs.length === 0 && status?.syncing && (
          <div className="bucket">{[0, 1, 2, 3].map((i) => <div className="sk-card" key={i} />)}</div>
        )}
        {connected && msgs.length === 0 && !status?.syncing && (
          <div className="empty">
            <div className="ic">✦</div>
            Für heute ist alles ruhig.
            <div className="sub">Keine neuen E-Mails im Posteingang.</div>
          </div>
        )}
      </div>

      <div className={"scrim" + (drawer ? " open" : "")} onClick={() => !drawer?.sending && setDrawer(null)} />
      <aside className={"drawer" + (drawer ? " open" : "")}>
        {drawer && <DraftPanel
          drawer={drawer} setDrawer={setDrawer} sendEnabled={sendEnabled}
          onGenerateCustom={() => generate(drawer.msg, { customInstruction: drawer.customInstruction, tone: drawer.tone })}
          onRefine={refine} onChangeTone={changeTone} onSend={send}
          onRegenerate={() => generate(drawer.msg, { intent: drawer.intent, intentLabel: drawer.intentLabel, customInstruction: drawer.customInstruction, tone: drawer.tone })}
          accounts={accounts}
        />}
      </aside>

      {compose && <ComposeModal compose={compose} setCompose={setCompose} accounts={accounts} sendEnabled={sendEnabled} />}
    </>
  );
}

function ConnectForm({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const providerList = Object.values(PROVIDERS);
  const [provider, setProvider] = useState("icloud");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [manual, setManual] = useState({ imapHost: "", imapPort: 993, imapSecure: true, smtpHost: "", smtpPort: 587, smtpSecure: false });
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const preset = PROVIDERS[provider];
  const isCustom = !!preset?.custom;

  function payload() {
    const base: any = { provider, email, password, displayName };
    if (isCustom) Object.assign(base, manual);
    return base;
  }

  async function testConn() {
    setTesting(true); setTest(null); setErr(null);
    try {
      const r = await fetch("/api/mail/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()) });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "Test fehlgeschlagen."); else setTest(j);
    } catch (e: any) { setErr(e.message || "Netzwerkfehler."); }
    setTesting(false);
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/mail/connect", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload())
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Verbindung fehlgeschlagen."); setBusy(false); return; }
      window.location.reload();
    } catch (e: any) {
      setErr(e.message || "Netzwerkfehler.");
      setBusy(false);
    }
  }

  async function disconnect(id: string) {
    if (!confirm("Dieses Postfach trennen? Die geladenen Mails werden entfernt.")) return;
    await fetch("/api/mail/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
    window.location.reload();
  }

  return (
    <div className="bucket" style={{ marginBottom: 18 }}>
      <div className="bh"><span className="bt">Postfach verbinden</span></div>
      <div style={{ padding: "4px 2px" }}>
        {accounts.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {accounts.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                <span className="sdot" style={{ background: "#30D158" }} />
                <span style={{ flex: 1 }}>{a.email} <span style={{ opacity: 0.6 }}>({PROVIDERS[a.provider]?.label || a.provider})</span></span>
                <button className="btn small" onClick={() => disconnect(a.id)}>Trennen</button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={connect} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ opacity: 0.7, fontSize: 13 }}>Anbieter</span>
            <select value={provider} onChange={(e) => { setProvider(e.target.value); setTest(null); }}>
              {providerList.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ opacity: 0.7, fontSize: 13 }}>Anzeigename (optional)</span>
            <input type="text" placeholder="z. B. Privat, Schule, Bewerbungen" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ opacity: 0.7, fontSize: 13 }}>E-Mail-Adresse</span>
            <input type="email" required placeholder="name@anbieter.de" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ opacity: 0.7, fontSize: 13 }}>Passwort / App-Passwort</span>
            <input type="password" required placeholder="App-Passwort" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>

          {isCustom && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ opacity: 0.7, fontSize: 13 }}>IMAP-Server</span>
                <input placeholder="imap.anbieter.de" value={manual.imapHost} onChange={(e) => setManual((m) => ({ ...m, imapHost: e.target.value }))} /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 80 }}><span style={{ opacity: 0.7, fontSize: 13 }}>Port</span>
                <input type="number" value={manual.imapPort} onChange={(e) => setManual((m) => ({ ...m, imapPort: +e.target.value }))} /></label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 10, fontSize: 12.5 }}>
                <input type="checkbox" checked={manual.imapSecure} onChange={(e) => setManual((m) => ({ ...m, imapSecure: e.target.checked }))} style={{ width: "auto" }} /> SSL</label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ opacity: 0.7, fontSize: 13 }}>SMTP-Server</span>
                <input placeholder="smtp.anbieter.de" value={manual.smtpHost} onChange={(e) => setManual((m) => ({ ...m, smtpHost: e.target.value }))} /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 80 }}><span style={{ opacity: 0.7, fontSize: 13 }}>Port</span>
                <input type="number" value={manual.smtpPort} onChange={(e) => setManual((m) => ({ ...m, smtpPort: +e.target.value }))} /></label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 10, fontSize: 12.5 }}>
                <input type="checkbox" checked={manual.smtpSecure} onChange={(e) => setManual((m) => ({ ...m, smtpSecure: e.target.checked }))} style={{ width: "auto" }} /> SSL</label>
            </div>
          )}

          <div className="note" style={{ fontSize: 13 }}>{preset?.passwordHint}</div>
          {test && (
            <div className="note" style={{ borderColor: test.imap?.ok && test.smtp?.ok ? "var(--accent-line)" : undefined }}>
              <div>{test.imap?.ok ? "✅" : "⚠️"} IMAP (Empfang): {test.imap?.msg}</div>
              <div style={{ marginTop: 4 }}>{test.smtp?.ok ? "✅" : "⚠️"} SMTP (Versand): {test.smtp?.msg}</div>
            </div>
          )}
          {err && <div className="note binding-warn">{err}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={testConn} disabled={testing || !email || !password}>{testing ? "Teste…" : "Verbindung testen"}</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? "Verbinde…" : "Verbinden"}</button>
            <button type="button" className="btn" onClick={onClose}>Schließen</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MailCard({ m, account, suggests, ensure, onReply, onCategorize }: any) {
  const canReply = m.needs_reply && m.draft_status !== "gesendet" && !m.hidden && m.folder_type !== "sent" && m.category !== "warten";
  const [menu, setMenu] = useState(false);
  useEffect(() => { if (canReply) ensure(m); }, [m.id]); // eslint-disable-line
  const providerLabel = account ? (PROVIDERS[account.provider]?.label || account.provider) : (m.account_display_name || "");
  const isSent = m.folder_type === "sent";
  return (
    <div className={"mail" + (!m.is_read && !isSent ? " unread" : "")}>
      <div className="m-acct">
        <span className="acct-pill" title={account?.email || ""}>
          {!m.is_read && !isSent && <span className="unread-dot" />}
          {providerLabel}{account?.email ? ` · ${account.email}` : ""}
        </span>
        {m.folder_type && m.folder_type !== "inbox" && <span className="acct-pill soft">{FOLDER_LABELS[m.folder_type] || m.folder_type}</span>}
        {m.semantic_category && <span className="cat-chip">{m.semantic_category}</span>}
        {m.has_attachments && <span className="acct-pill soft" title="Anhang">📎</span>}
        <span className="m-time">{m.received_at ? new Date(m.received_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</span>
      </div>
      <div className="m-top">
        <span className="m-from">{isSent ? `An: ${m.to_recipients || ""}` : (m.from_name || m.from_address)}</span>
        {m.draft_status === "gesendet" ? <span className="badge sent">Beantwortet</span>
          : m.status === "analyzing" ? <span className="badge analyzing">Wird analysiert…</span>
          : m.needs_reply && !isSent ? <span className="badge reply">Antwort nötig</span> : null}
        <button className="m-menu" onClick={() => setMenu((v) => !v)} title="Kategorie ändern">⋯</button>
      </div>
      <div className="m-subj">{m.subject || "(kein Betreff)"}</div>
      {isSent && <div className="m-sum">Gesendet über {account?.email || ""}</div>}
      {menu && (
        <div className="catmenu">
          <div className="label" style={{ margin: "0 0 6px" }}>Kategorie zuweisen</div>
          <select value={m.semantic_category || ""} onChange={(e) => { onCategorize(m, { category: e.target.value }); setMenu(false); }}>
            <option value="">— wählen —</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="chips" style={{ marginTop: 8 }}>
            <button className="chip cmd" onClick={() => { onCategorize(m, { category: m.semantic_category, ruleScope: "sender" }); setMenu(false); }}>Absender immer so</button>
            <button className="chip cmd" onClick={() => { onCategorize(m, { category: m.semantic_category, ruleScope: "domain" }); setMenu(false); }}>Domain immer so</button>
            <button className="chip cmd" onClick={() => { onCategorize(m, { hidden: true, ruleScope: "sender" }); setMenu(false); }}>Newsletter ausblenden</button>
          </div>
        </div>
      )}

      {canReply && (
        <div className="suggests">
          {(suggests && suggests.length ? suggests : []).map((s: any, i: number) => (
            <button key={i} className={"sug" + (s.binding ? " binding" : "")} title={s.explanation}
              onClick={() => onReply(m, { intent: s.intent, intentLabel: s.label })}>{s.label}</button>
          ))}
          {(!suggests || !suggests.length) && <span className="sug" style={{ pointerEvents: "none" }}><span className="spin" /></span>}
          <button className="sug custom" onClick={() => onReply(m, { custom: true })}>Eigene Antwort</button>
        </div>
      )}
      {m.draft_status === "gesendet" && m.reply_sent_at && (
        <div className="note" style={{ marginTop: 10 }}>Antwort gesendet am {new Date(m.reply_sent_at).toLocaleString("de-DE")}.</div>
      )}
    </div>
  );
}

function DraftPanel({ drawer, setDrawer, sendEnabled, onGenerateCustom, onRefine, onChangeTone, onSend, onRegenerate, accounts }: any) {
  const m = drawer.msg;
  const d = drawer.draft;
  return (
    <>
      <div className="dh">
        <div>
          <h3>Antwort an {m.from_name || m.from_address}</h3>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{m.subject}</div>
        </div>
        <button className="x" onClick={() => !drawer.sending && setDrawer(null)}>✕</button>
      </div>

      <div className="db">
        {drawer.mode === "custom" && !d ? (
          <>
            <div className="label">Wie möchtest du antworten?</div>
            <input className="custom-input" placeholder="Zum Beispiel: Zusagen und nach dem Startdatum fragen."
              value={drawer.customInstruction} autoFocus
              onChange={(e) => setDrawer((x: any) => ({ ...x, customInstruction: e.target.value }))} />
            <div className="df" style={{ padding: "14px 0 0", borderTop: 0 }}>
              <button className="btn btn-primary" disabled={!drawer.customInstruction?.trim() || drawer.loading} onClick={onGenerateCustom}>
                {drawer.loading ? <><span className="spin" /> Erstelle…</> : "Entwurf erstellen"}
              </button>
              <button className="btn" onClick={() => setDrawer(null)}>Abbrechen</button>
            </div>
          </>
        ) : drawer.loading || !d ? (
          <div className="empty"><span className="spin" /> <div style={{ marginTop: 12 }}>Antwort wird formuliert…</div></div>
        ) : (
          <>
            <div className="meta-row">
              <span className="k">Von (Konto)</span>
              <span className="v">
                <select value={drawer.fromAccountId || ""} onChange={(e) => setDrawer((x: any) => ({ ...x, fromAccountId: e.target.value }))} style={{ padding: "6px 10px", fontSize: 12.5 }}>
                  {(accounts || []).map((a: any) => <option key={a.id} value={a.id}>{(PROVIDERS[a.provider]?.label || a.provider)} · {a.email}</option>)}
                </select>
              </span>
              <span className="k">An</span><span className="v">{m.from_name || ""} &lt;{m.from_address}&gt;</span>
              <span className="k">Betreff</span><span className="v">{d.subject}</span>
              <span className="k">Reaktion</span><span className="v">{drawer.customInstruction ? "Eigene Antwort" : drawer.intentLabel}</span>
              <span className="k">Tonalität</span><span className="v">{drawer.tone || d.tone}</span>
            </div>

            <div className="label">Tonalität ändern</div>
            <div className="chips">
              {TONES.map((t) => (
                <button key={t} className={"chip" + ((drawer.tone || d.tone) === t ? " sel" : "")} onClick={() => onChangeTone(t)} disabled={drawer.loading}>{t}</button>
              ))}
            </div>

            <div className="label">Entwurf (bearbeitbar)</div>
            <textarea className="editor" value={drawer.body} onChange={(e) => setDrawer((x: any) => ({ ...x, body: e.target.value }))} />

            <div className="label">Schnelle Bearbeitung</div>
            <div className="chips">
              {COMMANDS.map((c) => (
                <button key={c} className="chip cmd" onClick={() => onRefine(c)} disabled={drawer.refining}>{c}</button>
              ))}
              {drawer.refining && <span className="spin" style={{ alignSelf: "center" }} />}
            </div>

            {d.missing_info && <div className="note warn"><b>Fehlende Information:</b> {d.missing_info} — bitte vor dem Senden prüfen.</div>}
            {d.needs_attachment && <div className="note warn"><b>Anhang beachten:</b> In dieser Unterhaltung werden Unterlagen angefordert. Anhänge werden aktuell nicht mitgesendet – bei Bedarf separat verschicken.</div>}
            {d.binding && <div className="note binding-warn"><b>Achtung – verbindliche Antwort:</b> Diese Antwort enthält eine verbindliche oder sensible Entscheidung. Bitte prüfe den Text genau vor dem Senden.</div>}
            {drawer.error && <div className="note binding-warn">{drawer.error}</div>}
          </>
        )}
      </div>

      {d && !drawer.loading && (
        <div className="df">
          {sendEnabled ? (
            d.binding && !drawer.confirmBinding ? (
              <button className="btn btn-primary" onClick={() => setDrawer((x: any) => ({ ...x, confirmBinding: true }))}>Senden…</button>
            ) : (
              <button className="btn btn-primary" onClick={onSend} disabled={drawer.sending}>
                {drawer.sending ? <><span className="spin" /> Sende…</> : (d.binding ? "Verbindlich senden" : "Senden")}
              </button>
            )
          ) : (
            <button className="btn" disabled title="Versand ist nicht aktiviert (ENABLE_SEND=false)">Senden (deaktiviert)</button>
          )}
          <button className="btn" onClick={onRegenerate} disabled={drawer.loading}>Neu formulieren</button>
          <button className="btn" onClick={() => setDrawer(null)}>Abbrechen</button>
        </div>
      )}
    </>
  );
}

function ComposeModal({ compose, setCompose, accounts, sendEnabled }: any) {
  const set = (patch: any) => setCompose((c: any) => ({ ...c, ...patch }));
  async function aiDraft() {
    if (!compose.instruction?.trim()) return;
    set({ loading: true, error: null });
    try {
      const r = await fetch("/api/mail/compose", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "draft", fromAccountId: compose.fromAccountId, instruction: compose.instruction, to: compose.to }) });
      const j = await r.json();
      if (r.ok) set({ loading: false, subject: j.draft.subject, body: j.draft.body });
      else set({ loading: false, error: "KI-Entwurf fehlgeschlagen." });
    } catch { set({ loading: false, error: "Netzwerkfehler." }); }
  }
  async function sendNow() {
    if (!compose.to?.trim()) { set({ error: "Bitte Empfänger angeben." }); return; }
    set({ sending: true, error: null });
    try {
      const r = await fetch("/api/mail/compose", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", confirm: true, fromAccountId: compose.fromAccountId, to: compose.to, cc: compose.cc, bcc: compose.bcc, subject: compose.subject, body: compose.body }) });
      const j = await r.json();
      if (r.ok) setCompose(null);
      else set({ sending: false, error: j.message || "Versand fehlgeschlagen." });
    } catch (e: any) { set({ sending: false, error: e.message }); }
  }
  return (
    <>
      <div className="scrim open" onClick={() => !compose.sending && setCompose(null)} />
      <div className="modal">
        <div className="dh"><h3>Neue E-Mail</h3><button className="x" onClick={() => !compose.sending && setCompose(null)}>✕</button></div>
        <div className="db">
          <div className="label" style={{ marginTop: 0 }}>Von (Konto)</div>
          <select value={compose.fromAccountId || ""} onChange={(e) => set({ fromAccountId: e.target.value })}>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{(PROVIDERS[a.provider]?.label || a.provider)} · {a.email}</option>)}
          </select>
          <div className="label">An</div>
          <input placeholder="empfaenger@example.com" value={compose.to} onChange={(e) => set({ to: e.target.value })} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><div className="label">CC</div><input value={compose.cc} onChange={(e) => set({ cc: e.target.value })} /></div>
            <div><div className="label">BCC</div><input value={compose.bcc} onChange={(e) => set({ bcc: e.target.value })} /></div>
          </div>
          <div className="label">KI-Anweisung (optional)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="z. B. Sage meinem Trainer ab für Freitag" value={compose.instruction} onChange={(e) => set({ instruction: e.target.value })} />
            <button className="btn" onClick={aiDraft} disabled={compose.loading}>{compose.loading ? <span className="spin" /> : "Formulieren"}</button>
          </div>
          <div className="label">Betreff</div>
          <input value={compose.subject} onChange={(e) => set({ subject: e.target.value })} />
          <div className="label">Nachricht</div>
          <textarea className="editor" value={compose.body} onChange={(e) => set({ body: e.target.value })} />
          {compose.error && <div className="note binding-warn">{compose.error}</div>}
        </div>
        <div className="df">
          {sendEnabled
            ? <button className="btn btn-primary" onClick={sendNow} disabled={compose.sending}>{compose.sending ? <><span className="spin" /> Sende…</> : "Senden"}</button>
            : <button className="btn" disabled title="Versand ist nicht aktiviert (ENABLE_SEND=false)">Senden (deaktiviert)</button>}
          <button className="btn" onClick={() => setCompose(null)}>Abbrechen</button>
        </div>
      </div>
    </>
  );
}
