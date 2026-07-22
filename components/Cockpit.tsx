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
const FOLDER_LABELS: Record<string, string> = { inbox: "Posteingang", sent: "Gesendet", drafts: "Entwürfe", archive: "Archiv", spam: "Junk", trash: "Papierkorb", other: "Weitere" };
const FOLDER_ICONS: Record<string, string> = { inbox: "📥", sent: "➤", drafts: "✎", archive: "🗄", spam: "⚠", trash: "🗑", other: "📁" };
const DEFAULT_FOLDERS = ["inbox", "sent", "drafts", "archive", "spam", "trash"];
const LABEL_COLORS: Record<string, string> = {
  Karate: "#4AA3FF", Bewerbungen: "#B4B2FF", Zahlungen: "#4ADE80", Abonnements: "#FFB340",
  Bestellungen: "#FF9F6B", Reisen: "#5AC8FA", Schule: "#C77DFF", Sicherheit: "#FF6961",
  Termine: "#7C7AF2", "Antwort nötig": "#FFB340", Persönlich: "#4ADE80", Newsletter: "#98989D", Automatisch: "#98989D", Wichtig: "#FF6961"
};
const TONES = ["Professionell", "Freundlich", "Kurz und direkt", "Förmlich", "Locker"];
const COMMANDS = ["Kürzer", "Freundlicher", "Förmlicher", "Direkter", "Wärmer", "Weniger begeistert", "Mehr Kontext", "Rechtschreibung prüfen"];

type Account = { id: string; email: string; provider: string };

type Folder = { account_id: string; path: string; folder_type: string; unread: number; total: number };

const SMART_VIEWS = [
  { key: "wichtig", label: "Wichtig", ic: "★" },
  { key: "reply", label: "Antwort nötig", ic: "↩" },
  { key: "Persönlich", label: "Persönlich", ic: "👤" },
  { key: "Karate", label: "Karate", ic: "🥋" },
  { key: "Bewerbungen", label: "Bewerbungen", ic: "💼" },
  { key: "Zahlungen", label: "Zahlungen", ic: "€" },
  { key: "Abonnements", label: "Abos", ic: "↻" },
  { key: "Reisen", label: "Reisen", ic: "✈" },
  { key: "Newsletter", label: "Newsletter", ic: "✉" }
];

export default function Cockpit({
  connected,
  accounts,
  folders = [],
  sendEnabled
}: {
  connected: boolean;
  accounts: Account[];
  folders?: Folder[];
  sendEnabled: boolean;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [showHidden, setShowHidden] = useState(true);
  const [status, setStatus] = useState<any>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [compose, setCompose] = useState<any>(null);
  const [reading, setReading] = useState<any>(null);
  const [q, setQ] = useState("");
  // Auswahl: Konto (all|id) + Ordner-Typ + optional Smart-View.
  const [sel, setSel] = useState<{ account: string; ftype: string; path?: string; view?: string }>({ account: "all", ftype: "inbox" });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [folderItems, setFolderItems] = useState<any[] | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);
  const [mobilePane, setMobilePane] = useState<"nav" | "list" | "read">("list");
  const [suggests, setSuggests] = useState<Record<string, any[]>>({});
  const accById: Record<string, Account> = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const filter = { account: sel.account, folder: sel.ftype, cat: "all", unread: false, needs: false, q };
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

  const labelsOf = (m: Msg): string[] => (m.user_labels && m.user_labels.length ? m.user_labels : (m.labels || []));

  function visible(m: Msg) {
    if (m.is_deleted) return false;
    if (q) {
      const hay = `${m.from_name || ""} ${m.from_address || ""} ${m.subject || ""} ${m.preview || ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    if (sel.view) {
      // Intelligente Ansicht: kontenübergreifend, ordnerunabhängig.
      if (sel.view === "wichtig") return m.semantic_category === "Wichtig" || m.priority === "hoch" || m.priority === "dringend";
      if (sel.view === "reply") return !!m.needs_reply && m.folder_type !== "sent";
      return labelsOf(m).includes(sel.view);
    }
    // Konto + Ordner.
    if (sel.account !== "all" && m.mail_account_id !== sel.account) return false;
    if ((m.folder_type || "inbox") !== sel.ftype) return false;
    return true;
  }

  function foldersFor(accId: string): Folder[] {
    const order = ["inbox", "sent", "drafts", "archive", "spam", "trash", "other"];
    return folders.filter((f) => f.account_id === accId).sort((a, b) => order.indexOf(a.folder_type) - order.indexOf(b.folder_type));
  }
  async function selectFolder(account: string, ftype: string, path?: string) {
    setSel({ account, ftype, path, view: undefined });
    setReading(null); setMobilePane("list");
    if (ftype === "inbox" || ftype === "sent" || !path) { setFolderItems(null); return; }
    setFolderLoading(true); setFolderItems([]);
    try {
      const r = await fetch(`/api/mail/folder?account=${account}&path=${encodeURIComponent(path)}`);
      const j = await r.json();
      setFolderItems(r.ok ? (j.items || []) : []);
    } catch { setFolderItems([]); }
    setFolderLoading(false);
  }
  function selectView(view: string) {
    setSel({ account: "all", ftype: "inbox", view }); setFolderItems(null); setReading(null); setMobilePane("list");
  }
  async function openFolderItem(it: any) {
    const synthetic = { id: `imap:${it.account_id}:${it.uid}`, ...it, folder_type: sel.ftype, mail_account_id: it.account_id, readonly: true };
    setReading({ msg: synthetic, loading: true });
    setMobilePane("read");
    try {
      const r = await fetch(`/api/mail/message?uid=${it.uid}&account=${it.account_id}&path=${encodeURIComponent(it.path)}`);
      const j = await r.json();
      setReading((s: any) => s && s.msg.id === synthetic.id ? { ...s, loading: false, ...j } : s);
    } catch { setReading((s: any) => s ? { ...s, loading: false, error: true } : s); }
  }

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

  async function openReader(m: Msg, images = false) {
    setMobilePane("read");
    setReading((s: any) => ({ msg: m, loading: true, ...(s && s.msg?.id === m.id ? s : {}), loadingImages: images }));
    if (!images) setReading({ msg: m, loading: true });
    if (!m.is_read) setMsgs((prev) => prev.map((x) => x.id === m.id ? { ...x, is_read: true } : x));
    try {
      const r = await fetch(`/api/mail/message?id=${m.id}${images ? "&images=1" : ""}`);
      const j = await r.json();
      setReading((s: any) => s && s.msg.id === m.id ? { ...s, loading: false, ...j } : s);
    } catch {
      setReading((s: any) => s ? { ...s, loading: false, error: true } : s);
    }
  }

  async function mailAction(m: Msg, action: string) {
    // Optimistisch aus der Liste entfernen (bei move/delete) bzw. Status setzen.
    const removes = ["delete", "archive", "spam"].includes(action);
    const before = msgs;
    if (removes) { setMsgs((prev) => prev.filter((x) => x.id !== m.id)); setReading(null); }
    try {
      const r = await fetch("/api/mail/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: m.id, action }) });
      if (!r.ok) throw new Error();
    } catch {
      if (removes) setMsgs(before); // Rollback bei IMAP-Fehler
      alert("Aktion fehlgeschlagen – die Nachricht wurde auf dem Server nicht verschoben.");
    }
  }

  async function setReplyFlag(m: Msg, needs: boolean) {
    setMsgs((prev) => prev.map((x) => x.id === m.id ? { ...x, needs_reply: needs, action_status: needs ? "reply_required" : "no_action" } : x));
    setReading((s: any) => s && s.msg.id === m.id ? { ...s, msg: { ...s.msg, needs_reply: needs, user_needs_reply: needs } } : s);
    await fetch("/api/mail/categorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: m.id, needs_reply: needs }) });
  }

  async function addLabel(m: Msg, label: string, remove = false) {
    const cur = (m.user_labels && m.user_labels.length ? m.user_labels : (m.labels || [])) as string[];
    const next = remove ? cur.filter((l) => l !== label) : Array.from(new Set([...cur, label]));
    setMsgs((prev) => prev.map((x) => x.id === m.id ? { ...x, user_labels: next } : x));
    setReading((s: any) => s && s.msg.id === m.id ? { ...s, msg: { ...s.msg, user_labels: next } } : s);
    await fetch("/api/mail/categorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: m.id, user_labels: next }) });
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
          <h1>E-Mails</h1>
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

      {(showConnect || !connected) && (
        <div className="wrap"><ConnectForm accounts={accounts} onClose={() => setShowConnect(false)} /></div>
      )}

      {connected && (
        <div className={"mail3 pane-" + mobilePane}>
          {/* Spalte 1: Konten, echte Ordner, intelligente Ansichten */}
          <div className="msidebar">
            <button className={"mfolder top" + (sel.account === "all" && !sel.view && sel.ftype === "inbox" ? " active" : "")} onClick={() => selectFolder("all", "inbox")}>
              <span className="mf-ic">📥</span><span className="mf-lbl">Alle Postfächer</span>
            </button>
            {accounts.map((a) => {
              const fl = foldersFor(a.id);
              const inbox = fl.find((f) => f.folder_type === "inbox");
              const open = expanded[a.id] !== false;
              return (
                <div className="macct" key={a.id}>
                  <button className="macct-h" onClick={() => setExpanded((e) => ({ ...e, [a.id]: !open }))}>
                    <span className={"chev" + (open ? " open" : "")}>›</span>
                    <span className="macct-name">{PROVIDERS[a.provider]?.label || a.provider}</span>
                    {inbox && inbox.unread > 0 && <span className="mf-count">{inbox.unread}</span>}
                  </button>
                  {open && (
                    <div className="macct-folders">
                      {(fl.length ? fl : DEFAULT_FOLDERS.map((t) => ({ account_id: a.id, path: "", folder_type: t, unread: 0, total: 0 }))).map((f) => (
                        <button key={f.folder_type + f.path} className={"mfolder" + (sel.account === a.id && sel.ftype === f.folder_type && !sel.view ? " active" : "")} onClick={() => selectFolder(a.id, f.folder_type, f.path)}>
                          <span className="mf-ic">{FOLDER_ICONS[f.folder_type] || "📁"}</span>
                          <span className="mf-lbl">{FOLDER_LABELS[f.folder_type] || f.folder_type}</span>
                          {f.unread > 0 && <span className="mf-count">{f.unread}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="msmart-h">Intelligente Ansichten</div>
            {SMART_VIEWS.map((v) => (
              <button key={v.key} className={"mfolder" + (sel.view === v.key ? " active" : "")} onClick={() => selectView(v.key)}>
                <span className="mf-ic">{v.ic}</span><span className="mf-lbl">{v.label}</span>
              </button>
            ))}
            <button className="btn small" style={{ margin: "12px 8px" }} onClick={() => setShowConnect(true)}>+ Postfach</button>
          </div>

          {/* Spalte 2: kompakte Nachrichtenliste */}
          <div className="mlist">
            <div className="mlist-top">
              <button className="mback" onClick={() => setMobilePane("nav")} aria-label="Ordner">☰</button>
              <input className="f-search" placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn small ghost" onClick={manualSync} title="Aktualisieren">↻</button>
            </div>
            <div className="mlist-scroll">
              {folderItems !== null ? (
                folderLoading ? [0, 1, 2, 3].map((i) => <div className="sk-card" key={i} />)
                  : folderItems.length ? folderItems.map((it) => (
                    <MailRow key={it.uid} m={it} account={accById[it.account_id]} onOpen={() => openFolderItem(it)} selected={reading?.msg?.uid === it.uid} labelsOf={labelsOf} />
                  )) : <div className="empty" style={{ padding: 40 }}>Keine Nachrichten in diesem Ordner.</div>
              ) : (() => {
                const list = msgs.filter(visible).sort((a, b) => new Date(b.received_at || 0).getTime() - new Date(a.received_at || 0).getTime());
                if (msgs.length === 0 && status?.syncing) return [0, 1, 2, 3].map((i) => <div className="sk-card" key={i} />);
                if (!list.length) return <div className="empty" style={{ padding: 40 }}><div className="ic">✦</div>Keine Nachrichten.</div>;
                return list.map((m) => (
                  <MailRow key={m.id} m={m} account={accById[m.mail_account_id]} onOpen={() => openReader(m)} selected={reading?.msg?.id === m.id} labelsOf={labelsOf} />
                ));
              })()}
            </div>
          </div>

          {/* Spalte 3: dauerhafte Leseansicht */}
          <div className="mread">
            <button className="mback mread-back" onClick={() => setMobilePane("list")} aria-label="Zurück">‹ Liste</button>
            {reading ? (
              <Reader reading={reading} account={accById[reading.msg.mail_account_id]} onClose={() => { setReading(null); setMobilePane("list"); }}
                onReply={(opts: any) => { openDraft(reading.msg, opts); }} suggests={suggests[reading.msg.id]} ensure={ensureSuggestions}
                onCategorize={categorize} onLoadImages={() => openReader(reading.msg, true)} onAction={mailAction} onSetReply={setReplyFlag} onAddLabel={addLabel} />
            ) : (
              <div className="mread-empty"><div className="ic">✉</div><div>Wähle eine Nachricht zum Lesen.</div></div>
            )}
          </div>
        </div>
      )}

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

function MailRow({ m, account, onOpen, selected, labelsOf }: any) {
  const isSent = m.folder_type === "sent";
  const provider = account ? (PROVIDERS[account.provider]?.label || account.provider) : (m.account_display_name || "");
  const labels: string[] = (labelsOf ? labelsOf(m) : (m.labels || [])).filter((l: string) => l !== "Automatisch" && l !== "Persönlich").slice(0, 3);
  return (
    <div className={"mrow" + (selected ? " sel" : "") + (!m.is_read && !isSent ? " unread" : "")} onClick={onOpen}>
      <span className="mrow-dot" style={{ opacity: !m.is_read && !isSent ? 1 : 0 }} />
      <div className="mrow-main">
        <div className="mrow-top">
          <span className="mrow-from">{isSent ? "An: " + (m.to_recipients || "") : (m.from_name || m.from_address || "")}</span>
          <span className="mrow-time">{m.received_at ? new Date(m.received_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : ""}</span>
        </div>
        <div className="mrow-subj">{m.subject || "(kein Betreff)"} {m.has_attachments && <span className="mrow-att">📎</span>}</div>
        {m.preview && <div className="mrow-prev">{m.preview}</div>}
        <div className="mrow-tags">
          <span className="mrow-acct">{provider}</span>
          {m.needs_reply && !isSent && <span className="mrow-badge">Antwort</span>}
          {labels.map((l) => <span key={l} className="mrow-label" style={{ ["--lc" as any]: LABEL_COLORS[l] || "#8a8a8f" }}>{l}</span>)}
        </div>
      </div>
    </div>
  );
}

function wantSummary(m: any): string {
  switch (m.message_type) {
    case "survey_feedback": return "Automatisierte Feedback-/Umfragemail. Teilnahme optional – keine Antwort nötig.";
    case "newsletter_marketing": return "Newsletter/Werbung. Keine Antwort nötig.";
    case "transactional": return "Transaktions-/Beleg-Mail. Nur zur Information.";
    case "security_notification": return "Sicherheitsnachricht – kurz prüfen, ob die Aktivität von dir war.";
    case "system_notification": return "Automatische Systembenachrichtigung. Meist keine Aktion nötig.";
    case "personal_direct": return m.needs_reply ? "Persönliche Nachricht – eine Antwort ist sinnvoll." : "Persönliche Nachricht – zur Kenntnis.";
    default: return m.needs_reply ? "Vermutlich wird eine Antwort erwartet." : "Nur zur Information.";
  }
}

// --- Kontrollierte Dark-Mode-Transformation (Phase 1) ---------------------
// KEIN pauschales filter:invert. Wir lesen die berechneten Farben jedes
// Elements und passen NUR nahezu graue helle Flächen (→ dunkel) und
// nahezu graue dunkle Texte (→ hell) an. Markenfarben, Logos, Produktbilder
// und farbige Buttons/Texte bleiben unangetastet.
const _srgb = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
function _lum(r: number, g: number, b: number) { return 0.2126 * _srgb(r) + 0.7152 * _srgb(g) + 0.0722 * _srgb(b); }
function _parseColor(c: string): { r: number; g: number; b: number; a: number } | null {
  if (!c) return null;
  const m = c.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const p = m[1].split(",").map((s) => parseFloat(s.trim()));
  if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
  return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
}
const _grayish = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b) <= 20;

function applyDarkTransform(doc: Document) {
  const win = doc.defaultView;
  if (!win) return;
  doc.body.style.backgroundColor = "#161618";
  const els = doc.querySelectorAll<HTMLElement>("body *");
  els.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "img" || tag === "svg" || tag === "picture" || tag === "video" || tag === "canvas") return;
    const cs = win.getComputedStyle(el);
    // Hintergrund: helle, weitgehend neutrale Flächen abdunkeln.
    // Hintergrundbilder (oft Logos/Banner) bleiben unangetastet.
    if (!cs.backgroundImage || cs.backgroundImage === "none") {
      const bg = _parseColor(cs.backgroundColor);
      if (bg && bg.a > 0.05) {
        const l = _lum(bg.r, bg.g, bg.b);
        if (l > 0.55 && (_grayish(bg.r, bg.g, bg.b) || l > 0.8)) {
          el.style.setProperty("background-color", l > 0.9 ? "#1b1b1d" : "#25252a", "important");
        }
      }
    }
    // Text: dunkle, weitgehend neutrale Schrift aufhellen. Farbige (Marken-)
    // Schrift bleibt farbig.
    const col = _parseColor(cs.color);
    if (col && _grayish(col.r, col.g, col.b)) {
      const l = _lum(col.r, col.g, col.b);
      if (l < 0.3) el.style.setProperty("color", "#e6e6ea", "important");
      else if (l < 0.5) el.style.setProperty("color", "#b7b7c0", "important");
    }
    // Rahmen: dunkle Trennlinien dezent aufhellen.
    (["Top", "Right", "Bottom", "Left"] as const).forEach((side) => {
      const style = (cs as any)[`border${side}Style`];
      if (!style || style === "none") return;
      const bc = _parseColor((cs as any)[`border${side}Color`]);
      if (bc && bc.a > 0.05 && _lum(bc.r, bc.g, bc.b) < 0.4) {
        el.style.setProperty(`border-${side.toLowerCase()}-color`, "rgba(255,255,255,.14)", "important");
      }
    });
  });
  // Links gut lesbar, sofern sie zu dunkel wären.
  doc.querySelectorAll<HTMLElement>("a").forEach((a) => {
    const col = _parseColor(win.getComputedStyle(a).color);
    if (col && _lum(col.r, col.g, col.b) < 0.45) a.style.setProperty("color", "#6fb1ff", "important");
  });
}

function MailFrame({ html, hasImages, withImages, onLoadImages, mode }: any) {
  const ref = useRef<HTMLIFrameElement>(null);
  const dark = mode === "angepasst";
  const bodyCss = dark
    ? `body{padding:16px;color:#e6e6ea;background:#161618;line-height:1.55}a{color:#6fb1ff}`
    : `body{padding:18px;color:#1c1c1e;background:#fff;line-height:1.5}a{color:#0a58ca}`;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,sans-serif;font-size:14px;word-break:break-word;-webkit-text-size-adjust:100%}${bodyCss}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${html}</body></html>`;
  function onLoad() {
    const d = ref.current?.contentDocument;
    if (!d) return;
    if (dark) { try { applyDarkTransform(d); } catch {} }
    try { ref.current!.style.height = Math.min((d.body?.scrollHeight || 400) + 30, 6000) + "px"; } catch {}
  }
  const frame = (
    <iframe key={mode} ref={ref} className={"rd-frame " + (mode || "original")} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} onLoad={onLoad} title="E-Mail-Inhalt" />
  );
  return (
    <>
      {hasImages && !withImages && <button className="btn small rd-imgbtn" onClick={onLoadImages}>Externe Bilder laden</button>}
      {mode === "original" ? <div className="rd-canvas">{frame}</div> : frame}
    </>
  );
}

function Reader({ reading, account, onClose, onReply, suggests, ensure, onCategorize, onLoadImages, onAction, onSetReply, onAddLabel }: any) {
  const m = reading.msg;
  const isSent = m.folder_type === "sent";
  // Ansichtsmodus der geöffneten Mail: standardmäßig "Angepasst" (Dark-Mode-harmonisch).
  const [view, setView] = useState<"angepasst" | "original" | "text">("angepasst");
  useEffect(() => { setView("angepasst"); }, [m.id]); // eslint-disable-line
  // KI-Antwort nur bei echten persönlichen Antwortfällen – nicht bei Umfrage/Newsletter/Rechnung.
  const isPersonal = (m.message_type === "personal_direct" || m.user_needs_reply === true);
  const canReply = isPersonal && m.needs_reply && m.draft_status !== "gesendet" && !isSent;
  useEffect(() => { if (canReply) ensure(m); }, [m.id]); // eslint-disable-line
  return (
    <>
      <div className="dh">
        <div style={{ minWidth: 0 }}>
          <h3 style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{m.subject || "(kein Betreff)"}</h3>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {account ? `${PROVIDERS[account.provider]?.label || account.provider} · ${account.email}` : m.account_display_name}
          </div>
        </div>
        <button className="x" onClick={onClose}>✕</button>
      </div>
      <div className="db">
        <div className="rd-head">
          <div className="rd-from">{isSent ? "Ich" : (m.from_name || m.from_address)}</div>
          <div className="rd-addr">{isSent ? `An: ${m.to_recipients || ""}` : m.from_address}</div>
          <div className="meta-row" style={{ marginTop: 10 }}>
            {!isSent && <><span className="k">An</span><span className="v">{m.to_recipients || ""}</span></>}
            {m.cc_addresses && <><span className="k">CC</span><span className="v">{m.cc_addresses}</span></>}
            <span className="k">Datum</span><span className="v">{m.received_at ? new Date(m.received_at).toLocaleString("de-DE") : ""}</span>
            {m.semantic_category && <><span className="k">Kategorie</span><span className="v">{m.semantic_category}</span></>}
            {m.action_status && <><span className="k">Status</span><span className="v">{m.action_status}</span></>}
          </div>
        </div>

        {!isSent && (
          <div className="rd-want">
            <span className="rd-want-ic">🤖</span>
            <div><b>Diese E-Mail möchte von dir:</b> {wantSummary(m)}</div>
          </div>
        )}

        <div className="rd-labels">
          {((m.user_labels && m.user_labels.length ? m.user_labels : (m.labels || [])) as string[]).map((l) => (
            <span key={l} className="mrow-label" style={{ ["--lc" as any]: LABEL_COLORS[l] || "#8a8a8f" }}>
              {l}{onAddLabel && <button className="lbl-x" onClick={() => onAddLabel(m, l, true)} title="Entfernen">×</button>}
            </span>
          ))}
          {onAddLabel && (
            <select className="lbl-add" value="" onChange={(e) => { if (e.target.value) onAddLabel(m, e.target.value); }} title="Label hinzufügen">
              <option value="">+ Label</option>
              {["Karate", "Bewerbungen", "Zahlungen", "Abonnements", "Reisen", "Schule", "Sicherheit", "Termine", "Persönlich", "Wichtig", "Newsletter"].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
        </div>

        {reading.thread && reading.thread.length > 0 && (
          <div className="rd-thread">
            <div className="label" style={{ marginTop: 0 }}>Früher im Thread ({reading.thread.length})</div>
            {reading.thread.map((t: any) => (
              <div className="rd-tmsg" key={t.id}><b>{t.from_name || t.from_address}</b> · {t.received_at ? new Date(t.received_at).toLocaleDateString("de-DE") : ""}<div className="rd-tprev">{t.preview || ""}</div></div>
            ))}
          </div>
        )}

        <div className="rd-body">
          {reading.loading ? <div className="empty"><span className="spin" /><div style={{ marginTop: 12 }}>Nachricht wird geladen…</div></div>
            : reading.html ? (
              <>
                <div className="rd-viewsel" role="tablist">
                  <button className={view === "angepasst" ? "on" : ""} onClick={() => setView("angepasst")} title="Kontrolliert an den Dark-Mode angepasst – Markenfarben & Logos bleiben erhalten">Angepasst</button>
                  <button className={view === "original" ? "on" : ""} onClick={() => setView("original")} title="Originaldarstellung in heller Mail-Leinwand">Original</button>
                  <button className={view === "text" ? "on" : ""} onClick={() => setView("text")} title="Nur der lesbare Text ohne Layout und Werbegrafiken">Nur Text</button>
                </div>
                {view === "text"
                  ? <div className="rd-plain">{(reading.text && reading.text.trim()) || "Kein Textinhalt vorhanden."}</div>
                  : <MailFrame html={reading.html} hasImages={reading.hasImages} withImages={reading.withImages} onLoadImages={onLoadImages} mode={view} />}
              </>
            )
            : reading.text ? <div className="rd-plain">{reading.text}</div>
            : <div className="empty">Kein Inhalt geladen. {reading.error ? "(Fehler beim Abruf)" : ""}</div>}
        </div>

        {canReply ? (
          <div className="rd-actions">
            <div className="label">KI-Antwortvorschläge</div>
            <div className="suggests">
              {(suggests && suggests.length ? suggests : []).map((s: any, i: number) => (
                <button key={i} className={"sug" + (s.binding ? " binding" : "")} title={s.explanation} onClick={() => onReply({ intent: s.intent, intentLabel: s.label })}>{s.label}</button>
              ))}
              {(!suggests || !suggests.length) && <span className="sug" style={{ pointerEvents: "none" }}><span className="spin" /></span>}
              <button className="sug custom" onClick={() => onReply({ custom: true })}>Eigene Antwort</button>
            </div>
          </div>
        ) : !isSent && (
          <div className="rd-actions">
            <div className="note" style={{ marginTop: 0 }}>
              {m.message_type === "survey_feedback" ? "Automatisierte Feedback-/Umfragemail – keine persönliche Antwort nötig."
                : m.message_type === "newsletter_marketing" || m.is_bulk ? "Massen-/Newslettermail – keine persönliche Antwort nötig."
                : m.message_type === "transactional" ? "Transaktions-/Belegmail – nur zur Information."
                : "Keine persönliche Antwort erwartet."}
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              <button className="chip" onClick={() => onSetReply(m, true)}>Doch Antwort nötig</button>
              <button className="chip" onClick={() => onCategorize(m, { hidden: true, ruleScope: "sender" })}>Newsletter ausblenden</button>
            </div>
          </div>
        )}
      </div>
      <div className="df">
        {canReply && <button className="btn btn-primary" onClick={() => onReply({ custom: true })}>Antworten</button>}
        {!isSent && m.needs_reply && <button className="btn" onClick={() => onSetReply(m, false)} title="Als erledigt/keine Antwort">Keine Antwort nötig</button>}
        <button className="btn" onClick={() => onAction(m, "archive")}>Archivieren</button>
        <button className="btn" onClick={() => onAction(m, "spam")}>Spam</button>
        <button className="btn btn-danger" onClick={() => onAction(m, "delete")}>Löschen</button>
        <button className="btn" onClick={onClose}>Schließen</button>
      </div>
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

function MailCard({ m, account, onCategorize, onOpen, selected }: any) {
  const [menu, setMenu] = useState(false);
  const providerLabel = account ? (PROVIDERS[account.provider]?.label || account.provider) : (m.account_display_name || "");
  const isSent = m.folder_type === "sent";
  return (
    <div className={"mail" + (!m.is_read && !isSent ? " unread" : "") + (selected ? " selected" : "")}>
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
      <div className="m-subj" style={{ cursor: "pointer" }} onClick={() => onOpen && onOpen(m)}>{m.subject || "(kein Betreff)"}</div>
      {isSent && <div className="m-sum">Gesendet über {account?.email || ""}</div>}
      {!isSent && m.preview && <div className="m-sum">{m.preview}</div>}
      {onOpen && <button className="m-open" onClick={() => onOpen(m)}>Öffnen &amp; lesen →</button>}
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
