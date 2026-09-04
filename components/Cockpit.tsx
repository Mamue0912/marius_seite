"use client";
import { useEffect, useRef, useState, memo, useDeferredValue } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { Notice, notify } from "./Feedback";
import { requestJson, jsonRequest } from "@/lib/http";
import { messageContentKey } from "@/lib/mailKeys";
import OverlayScroll from "@/components/OverlayScroll";
import { getMailCache, fetchMessages, setMailCache, getFolderCache, fetchFolder, prefetchFolder, getMsgContent, setMsgContent, invalidateFolderCache } from "@/lib/mailStore";
import { PROVIDERS } from "@/lib/mailProviders";
import { RELEVANCE_LABEL } from "@/lib/classify2";

type Msg = any;

// Bild-Einstellung (im Browser gespeichert): always | known | never (Standard: always).
function imageMode(): string {
  try { return localStorage.getItem("imgMode") || "always"; } catch { return "always"; }
}
function knownSenders(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem("imgKnown") || "[]")); } catch { return new Set(); }
}
function rememberImageSender(m: any) {
  const s = (m.from_address || "").toLowerCase(); if (!s) return;
  try { const set = knownSenders(); set.add(s); localStorage.setItem("imgKnown", JSON.stringify(Array.from(set))); } catch {}
}
function autoImages(m: any): boolean {
  const mode = imageMode();
  if (mode === "always") return true;
  if (mode === "never") return false;
  return knownSenders().has((m.from_address || "").toLowerCase());
}

// Inhaltliche Labels einer Nachricht (ohne Meta-Labels), Nutzer-Override zuerst.
function labelsOfMsg(m: any): string[] {
  const ls = (m.user_labels && m.user_labels.length ? m.user_labels : (m.labels || [])) as string[];
  return ls.filter((l) => !["Automatisch", "Persönlich", "Sonstiges"].includes(l));
}

// Kompakter Status-Chip aus gespeicherter Klassifizierung (Nutzer-Override zuerst).
function statusChip(m: any): { text: string; tone: string } | null {
  const isSent = m.folder_type === "sent";
  if (isSent) return null;
  if (m.reply_sent_at || m.draft_status === "gesendet") return { text: "Beantwortet", tone: "answered" };
  const rel = m.user_relevance || m.relevance;
  const action = m.user_action_status || m.action_status;
  const needs = m.user_needs_reply != null ? m.user_needs_reply : m.needs_reply;
  if (needs) return { text: "Antwort nötig", tone: "reply" };
  if (action === "act_now") return { text: "Sofort prüfen", tone: "urgent" };
  if (rel === "sehr_wichtig") return { text: "Sehr wichtig", tone: "urgent" };
  if (rel === "wichtig") return { text: "Wichtig", tone: "high" };
  if (action === "review_recommended" || action === "action_no_reply") return { text: "Prüfen", tone: "mid" };
  if (action === "no_action" || action === "information_only" || rel === "irrelevant" || rel === "niedrig") return { text: "Nur Info", tone: "muted" };
  return null;
}

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

// Robuster fetch mit hartem Zeitlimit und optionalem externen Abbruch.
// Verhindert unendliches Laden: nach timeoutMs bricht der Request sicher ab.
async function fetchJson(
  url: string,
  opts: { method?: string; body?: string; headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<{ ok: boolean; status: number; data: any; timedOut: boolean; aborted: boolean }> {
  const { timeoutMs = 45000, signal: extSignal, ...rest } = opts;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(new DOMException("timeout", "TimeoutError")); }, timeoutMs);
  const onExt = () => ctrl.abort(new DOMException("cancel", "AbortError"));
  if (extSignal?.aborted) onExt(); else if (extSignal) extSignal.addEventListener("abort", onExt, { once: true });
  try {
    const r = await fetch(url, { ...rest, signal: ctrl.signal });
    let data: any = {};
    try { data = (await r.json()) || {}; } catch {}
    return { ok: r.ok, status: r.status, data, timedOut: false, aborted: false };
  } catch (e: any) {
    const aborted = !timedOut && (e?.name === "AbortError" || !!extSignal?.aborted);
    return { ok: false, status: 0, data: {}, timedOut, aborted };
  } finally {
    clearTimeout(timer);
    if (extSignal) extSignal.removeEventListener("abort", onExt);
  }
}

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
  { key: "Sicherheit", label: "Sicherheit", ic: "🛡" },
  { key: "Newsletter", label: "Newsletter", ic: "✉" },
  { key: "Automatisch", label: "Automatisch", ic: "⚙" },
  { key: "Niedrig", label: "Niedrige Priorität", ic: "▽" }
];

export default function Cockpit({
  connected,
  accounts,
  folders = [],
  sendEnabled,
  initialOpenId
}: {
  connected: boolean;
  accounts: Account[];
  folders?: Folder[];
  sendEnabled: boolean;
  initialOpenId?: string | null;
}) {
  const [msgs, setMsgs] = useState<Msg[]>(() => (getMailCache() as Msg[]) || []);
  const [showHidden, setShowHidden] = useState(true);
  const [status, setStatus] = useState<any>(null);
  const [mailDiag, setMailDiag] = useState<boolean>(false);
  const [showConnect, setShowConnect] = useState(false);
  const [compose, setCompose] = useState<any>(null);
  const [reading, setReading] = useState<any>(null);
  const [q, setQ] = useState("");
  const searchQuery = useDeferredValue(q);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(() => !getMailCache());
  const folderSequence = useRef(0);
  const actionLocks = useRef(new Set<string>());
  // Auswahl: Konto (all|id) + Ordner-Typ + optional Smart-View.
  const [sel, setSel] = useState<{ account: string; ftype: string; path?: string; view?: string }>({ account: "all", ftype: "inbox" });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [folderItems, setFolderItems] = useState<any[] | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);
  const [mobilePane, setMobilePane] = useState<"nav" | "list" | "read">("list");
  const [suggests, setSuggests] = useState<Record<string, any[]>>({});
  const [suggestLoading, setSuggestLoading] = useState<Record<string, boolean>>({});
  const [diag, setDiag] = useState<boolean>(false);
  const [classify, setClassify] = useState<{ total: number; done: number } | null>(null);
  const [classifyErr, setClassifyErr] = useState<string | null>(null);
  const [backfill, setBackfill] = useState<any>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [listLimit, setListLimit] = useState(50);
  // Listenfilter: alle Mails oder nur aktuell ungelesene. Kombinierbar mit
  // Suche, Konto/Ordner-Auswahl und intelligenten Ansichten.
  const [unreadOnly, setUnreadOnly] = useState(false);
  const accById: Record<string, Account> = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const filter = { account: sel.account, folder: sel.ftype, cat: "all", unread: false, needs: false, q };
  const [drawer, setDrawer] = useState<any>(null); // { msg, mode, loading, draft, body, tone, customInstruction, confirmBinding, sending }
  const uidRef = useRef<string | null>(null);

  // ---- Live-Daten aus Supabase (Realtime) ----
  useEffect(() => {
    const supabase = supabaseBrowser();
    let channel: any;
    let disposed = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      uidRef.current = user.id;
      // Sofort aus dem Cache (falls per Hover vorgeladen), dann im Hintergrund
      // aktualisieren – kein Warten mit leerer Liste beim Öffnen.
      try { const data = await fetchMessages(); if (!disposed) { setMsgs(data as Msg[]); setLoadError(null); } }
      catch (e) { if (!disposed) setLoadError((e as Error).message); }
      finally { if (!disposed) setListLoading(false); }
      if (disposed) return;
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
    return () => { disposed = true; if (channel) channel.unsubscribe(); };
  }, []);

  useEffect(() => { setMailCache(msgs); }, [msgs]);

  // ---- Beim Öffnen einmal synchronisieren (holt neue Mails) ----
  useEffect(() => {
    if (!connected) return;
    manualSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ---- Automatische Aktualisierung: Fenster-Fokus + regelmäßig ----
  useEffect(() => {
    if (!connected) return;
    const onFocus = () => { if (document.visibilityState === "visible") autoSync(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const iv = setInterval(() => { if (document.visibilityState === "visible") autoSync(); }, 150000);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ---- Deep-Link: bestimmte Nachricht direkt öffnen (aus der Übersicht) ----
  const openedDeepLink = useRef(false);
  useEffect(() => {
    if (openedDeepLink.current || !initialOpenId || !msgs.length) return;
    const m = msgs.find((x: any) => x.id === initialOpenId);
    if (m) { openedDeepLink.current = true; openReader(m); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, initialOpenId]);

  // ---- Nachklassifizierung bereits gespeicherter Mails (mit sichtbarem Fehler) ----
  async function runClassify() {
    setClassifyErr(null);
    try {
      const g = await fetch("/api/mail/classify");
      if (!g.ok) { setClassifyErr(`Einordnung nicht erreichbar (HTTP ${g.status}). Ist der neue Stand deployt?`); return; }
      const s = await g.json();
      if (!s || !s.remaining) { setClassify(null); await reloadMessages(); return; }
      setClassify({ total: s.total, done: s.classified });
      let remaining = s.remaining;
      let guard = 0;
      while (remaining > 0 && guard < 200) {
        guard++;
        const p = await fetch("/api/mail/classify", { method: "POST" });
        if (!p.ok) { setClassifyErr(`Einordnung fehlgeschlagen (HTTP ${p.status}).`); break; }
        const r = await p.json();
        remaining = r.remaining;
        setClassify({ total: r.total, done: r.classified });
        if (r.error) setClassifyErr(`Datenbank meldet: ${r.error}`);
        if (!r.processed) { if (!r.error) setClassifyErr("Es konnte keine Nachricht eingeordnet werden (0 verarbeitet)."); break; }
      }
      await reloadMessages();
    } catch (e: any) {
      setClassifyErr("Netzwerk-/Serverfehler bei der Einordnung: " + (e?.message || "unbekannt"));
    } finally {
      setTimeout(() => setClassify(null), 1500);
    }
  }
  useEffect(() => {
    if (!connected) return;
    runClassify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ---- Vorschläge lazy laden (nur für zu beantwortende, noch nicht gesendete Mails) ----
  async function ensureSuggestions(m: Msg) {
    if (suggests[m.id]) return;
    if (m.suggested_replies) { setSuggests((s) => ({ ...s, [m.id]: m.suggested_replies })); return; }
    setSuggests((s) => ({ ...s, [m.id]: [] })); // Platzhalter, verhindert Doppelabruf
    setSuggestLoading((s) => ({ ...s, [m.id]: true }));
    const { ok, data } = await fetchJson("/api/reply/suggest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: m.id }), timeoutMs: 45000
    });
    // Nach dem Laden endet der Spinner IMMER (auch bei Fehler/leer). Der Nutzer
    // kann dann "Eigene Antwort" wählen. Fehlerdetails in der KI-Diagnose.
    setSuggests((s) => ({ ...s, [m.id]: ok ? (data.suggestions || []) : [] }));
    setSuggestLoading((s) => ({ ...s, [m.id]: false }));
  }

  // Zähler IMMER aus derselben Quelle wie die Liste (messages), nie aus IMAP-STATUS.
  const unreadInbox = (accId?: string) => msgs.filter((m: any) => !m.is_deleted && (m.folder_type || "inbox") === "inbox" && !m.is_read && (!accId || m.mail_account_id === accId)).length;

  // Ungelesene im AKTUELLEN Kontext (Konto/Ordner/Ansicht + Suche), für das
  // Zähler-Abzeichen am „Ungelesen"-Filter. Berücksichtigt On-Demand-Ordner.
  function unreadFilterCount(): number {
    if (folderItems !== null) return folderItems.filter((it) => !it.is_read).length;
    return msgs.filter((m: any) => !m.is_read && visible(m)).length;
  }

  // Gespeicherte Klassifizierung – Nutzer-Overrides haben immer Vorrang.
  const labelsOf = (m: Msg): string[] => (m.user_labels && m.user_labels.length ? m.user_labels : (m.labels || []));
  const relevanceOf = (m: any): string => m.user_relevance || m.relevance || "normal";
  const typeOf = (m: any): string => m.user_message_type || m.message_type || "unknown";
  const actionOf = (m: any): string => m.user_action_status || m.action_status || "information_only";
  const needsReplyOf = (m: any): boolean => (m.user_needs_reply != null ? m.user_needs_reply : !!m.needs_reply);

  function visible(m: Msg) {
    if (m.is_deleted) return false;
    // Ungelesen-Filter: greift kombinierbar über Konten, Ordner, Ansichten und
    // Suche. Reagiert sofort, sobald is_read (lokal oder per Sync) wechselt.
    if (unreadOnly && (m as any).is_read) return false;
    if (q) {
      const hay = `${m.from_name || ""} ${m.from_address || ""} ${m.subject || ""} ${m.preview || ""}`.toLowerCase();
      if (!hay.includes(searchQuery.toLowerCase())) return false;
    }
    if (sel.view) {
      // Intelligente Ansicht: kontenübergreifend, ordnerunabhängig, aus gespeicherten Daten.
      if ((m as any).folder_type === "trash" || (m as any).folder_type === "spam") return false;
      const rel = relevanceOf(m);
      if (sel.view === "wichtig") return rel === "sehr_wichtig" || rel === "wichtig" || (m as any).semantic_category === "Wichtig";
      if (sel.view === "reply") return needsReplyOf(m) && m.folder_type !== "sent";
      if (sel.view === "Persönlich") return typeOf(m) === "personal_direct" || typeOf(m) === "personal_thread";
      if (sel.view === "Newsletter") return ["newsletter", "marketing", "survey_feedback"].includes(typeOf(m)) || labelsOf(m).includes("Newsletter");
      if (sel.view === "Sicherheit") return labelsOf(m).includes("Sicherheit") || typeOf(m) === "security_alert";
      if (sel.view === "Automatisch") return labelsOf(m).includes("Automatisch") || ["system_notification", "welcome", "auto_confirmation"].includes(typeOf(m));
      if (sel.view === "Niedrig") return rel === "niedrig" || rel === "irrelevant";
      return labelsOf(m).includes(sel.view);
    }
    // Konto + Ordner.
    if (sel.account !== "all" && m.mail_account_id !== sel.account) return false;
    if ((m.folder_type || "inbox") !== sel.ftype) return false;
    return true;
  }

  function foldersFor(accId: string): Folder[] {
    const order = ["inbox", "sent", "drafts", "archive", "spam", "trash", "other"];
    const list = folders.filter((f) => f.account_id === accId);
    // Nutzer-Anzeigeeinstellungen (optional): ausgeblendete Ordner entfernen.
    const visible = list.filter((f: any) => !f.hidden);
    // Deduplizieren: gleicher Anzeigename → nur einmal (behebt doppeltes „Weitere").
    const seen = new Set<string>();
    const deduped = visible.filter((f: any) => {
      const key = ((f.type_override || f.folder_type) + "|" + folderLabel(f)).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    return deduped.sort((a: any, b: any) => {
      const so = (a.sort_order ?? 999) - (b.sort_order ?? 999);
      if (so !== 0) return so;
      return order.indexOf((a.type_override || a.folder_type)) - order.indexOf((b.type_override || b.folder_type));
    });
  }
  // Anzeigename: eigener Name > echter Ordnername (bei „other") > Standardlabel.
  function folderLabel(f: any): string {
    if (f.display_name) return f.display_name;
    const type = f.type_override || f.folder_type;
    if (type === "other" && f.path) {
      const seg = String(f.path).split(/[/.]/).filter(Boolean);
      return seg[seg.length - 1] || FOLDER_LABELS.other;
    }
    return FOLDER_LABELS[type] || type;
  }
  async function selectFolder(account: string, ftype: string, path?: string) {
    const sequence = ++folderSequence.current; setLoadError(null);
    setSel({ account, ftype, path, view: undefined });
    setReading(null); setMobilePane("list");
    if (ftype === "inbox" || ftype === "sent" || !path) { setFolderItems(null); return; }
    // Sofort aus dem Cache zeigen (falls per Hover vorgeladen), dann aktualisieren.
    const cached = getFolderCache(account, path);
    if (cached) { setFolderItems(cached); setFolderLoading(false); }
    else { setFolderLoading(true); setFolderItems([]); }
    try { const items = await fetchFolder(account, path); if (sequence === folderSequence.current) setFolderItems(items); }
    catch (e) { if (sequence === folderSequence.current) setLoadError((e as Error).message); }
    finally { if (sequence === folderSequence.current) setFolderLoading(false); }
  }
  function selectView(view: string) {
    ++folderSequence.current; setLoadError(null);
    setSel({ account: "all", ftype: "inbox", view }); setFolderItems(null); setReading(null); setMobilePane("list");
  }
  async function openFolderItem(it: any, images?: boolean) {
    if (images === undefined) images = autoImages(it);
    const account = it.account_id || it.mail_account_id;
    const path = it.path || it.folder_path;
    const synthetic = { ...it, id: messageContentKey(account,path,it.uid,false), folder_type: sel.ftype, folder_path: path, mail_account_id: account, readonly: true };
    setMobilePane("read");
    const ckey = messageContentKey(account,path,it.uid,images);
    const cached = getMsgContent(ckey);
    setReading({msg:synthetic, loading:!cached, ...cached});
    try {
      if (cached) {
        if (!it.is_read) await requestJson("/api/mail/folder-action",jsonRequest("POST",{account,path,uid:it.uid,action:"read"}));
      } else {
        const data = await requestJson("/api/mail/message?uid="+it.uid+"&account="+encodeURIComponent(account)+"&path="+encodeURIComponent(path)+(images?"&images=1":""));
        setMsgContent(ckey,data);
        setReading((r:any)=>r?.msg.id===synthetic.id?{...r,...data,loading:false}:r);
      }
      setFolderItems(rows=>rows?.map(row=>row.uid===it.uid&&row.path===path?{...row,is_read:true}:row)||rows);
      setReading((r:any)=>r?.msg.id===synthetic.id?{...r,msg:{...r.msg,is_read:true}}:r);
    } catch(e) {
      setReading((r:any)=>r?.msg.id===synthetic.id?{...r,loading:false,error:(e as Error).message}:r);
    }
  }

  async function folderItemAction(m: any, action: string) {
    const key = messageContentKey(m.mail_account_id,m.folder_path,m.uid,false);
    if (actionLocks.current.has(key)) return;
    actionLocks.current.add(key);
    const removes = !["read","unread"].includes(action);
    try {
      await requestJson("/api/mail/folder-action",jsonRequest("POST",{account:m.mail_account_id,path:m.folder_path,uid:m.uid,action}));
      invalidateFolderCache(m.mail_account_id,m.folder_path);
      setFolderItems(rows=>rows?.flatMap(row=>row.uid===m.uid&&row.path===m.folder_path?(removes?[]:[{...row,is_read:action==="read"}]):[row])||rows);
      if(removes){setReading(null);setMobilePane("list");}
      else setReading((r:any)=>r?.msg.id===m.id?{...r,msg:{...r.msg,is_read:action==="read"}}:r);
      notify("Nachricht aktualisiert.");
    } catch(e) { notify((e as Error).message,true); }
    finally { actionLocks.current.delete(key); }
  }

  async function reloadMessages() {
    try { const data = await fetchMessages(); setMsgs(data); setLoadError(null); }
    catch(e) { setLoadError((e as Error).message); }
    finally { setListLoading(false); }
  }

  const syncingRef = useRef(false);
  const lastSyncRef = useRef(0);
  // Bremse gegen zu häufige IMAP-Verbindungen (WEB.DE limitiert das).
  function autoSync() { if (Date.now() - lastSyncRef.current > 60000) manualSync(); }
  async function manualSync(reseed = false, clean = false) {
    if (syncingRef.current) return; // kein paralleler Sync
    syncingRef.current = true;
    lastSyncRef.current = Date.now();
    setStatus((s: any) => ({ ...s, syncing: true }));
    let errors: string[] = [];
    let report: any = null;
    try {
      const qs = clean ? "?clean=1" : reseed ? "?reseed=1" : "";
      const r = await fetch("/api/mail/sync" + qs, { method: "POST" });
      if (r.ok) { const j = await r.json(); errors = j.errors || []; report = j.report || null; }
      else errors = [`Sync-Route HTTP ${r.status}`];
    } catch { errors = ["Netzwerkfehler beim Synchronisieren"]; }
    // Nach dem Sync alle Queries neu laden (Badge + Liste + Übersicht aus einer Quelle).
    await reloadMessages();
    setStatus((s:any) => ({ syncing: false, errors, report, syncedAt: errors.length ? s?.syncedAt : new Date().toISOString() }));
    window.dispatchEvent(new Event("cockpit:mail-changed"));
    syncingRef.current = false;
    if (reseed || clean) runClassify();
  }
  function cleanResync() {
    if (!confirm("Alle gespeicherten Mails werden gelöscht und komplett neu eingelesen. Das korrigiert falsche Kontozuordnungen. Manuelle Labels/Einstufungen auf einzelnen Mails gehen dabei verloren. Fortfahren?")) return;
    manualSync(false, true);
  }
  // Vollständiger, sicherer Abgleich: fehlende Mails nachladen (keine Duplikate).
  async function runBackfill() {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setBackfill({ running: true, label: "Abgleich wird vorbereitet…" });
    const summary: any[] = [];
    try {
      const accs = ((await (await fetch("/api/mail/backfill")).json()).accounts) || [];
      for (const a of accs) {
        const prov = PROVIDERS[a.provider]?.label || a.provider;
        for (const folder of ["inbox", "sent"] as const) {
          const agg: any = { account: a.email, provider: prov, folder, checked: 0, saved: 0, updated: 0, skipped: 0, failed: 0, total: 0 };
          let start = 1; let guard = 0;
          while (guard < 400) {
            guard++;
            const resp = await fetch("/api/mail/backfill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: a.id, folder, startSeq: start }) });
            const r = await resp.json();
            if (!resp.ok || r.error) { agg.failed++; break; }
            agg.total = r.total; agg.checked += r.processed; agg.saved += r.saved; agg.updated += r.updated; agg.skipped += r.skipped; agg.failed += r.failed;
            setBackfill({ running: true, label: `${prov} · ${folder === "inbox" ? "Posteingang" : "Gesendet"}: ${Math.min(agg.checked, r.total)} von ${r.total} geprüft`, summary });
            if (r.next == null) break;
            start = r.next;
            await new Promise((res) => setTimeout(res, 300)); // WEB.DE schonen
          }
          summary.push(agg);
          await reloadMessages();
        }
      }
      setBackfill({ done: true, summary });
    } catch (e: any) {
      setBackfill({ done: true, error: e?.message || "Abgleich fehlgeschlagen", summary });
    } finally {
      syncingRef.current = false;
      await reloadMessages();
      runClassify();
    }
  }

  // Bestehende Mails neu einordnen (Mails bleiben, nur Labels/Relevanz neu).
  async function reclassifyAll() {
    if (!confirm("Alle Mails werden neu eingeordnet (z. B. damit Google-Sicherheitshinweise nicht mehr als dringend gelten). Deine manuellen Einstufungen bleiben erhalten. Fortfahren?")) return;
    setClassifyErr(null);
    try { await fetch("/api/mail/classify?reset=1", { method: "POST" }); } catch {}
    await runClassify();
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

  async function generate(m: Msg, p: { intent?: string; intentLabel?: string; customInstruction?: string; tone?: string; length?: string }) {
    // Eigener Abbruch-Controller je Generierung → "Abbrechen"-Button möglich.
    const ctrl = new AbortController();
    setDrawer((d: any) => ({ ...d, loading: true, error: null, abort: () => ctrl.abort(new DOMException("cancel", "AbortError")) }));
    const { ok, status, data, timedOut, aborted } = await fetchJson("/api/mail/generate-reply", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: m.id, intent: p.intent, intentLabel: p.intentLabel, customInstruction: p.customInstruction, tone: p.tone, length: p.length }),
      timeoutMs: 45000, signal: ctrl.signal
    });
    if (ok) {
      setDrawer((d: any) => d?.msg.id === m.id ? ({
        ...d, mode: "generated", loading: false, error: null, abort: null,
        draft: data.draft, body: data.draft.body, tone: data.draft.tone,
        fromAccountId: d.fromAccountId || m.mail_account_id,
        intent: p.intent, intentLabel: p.intentLabel, customInstruction: p.customInstruction, confirmBinding: false
      }) : d);
      return;
    }
    const error = aborted ? "Abgebrochen."
      : timedOut ? "Die KI hat zu lange gebraucht. Bitte erneut versuchen."
      : status === 0 ? "Keine Verbindung zum Server. Bitte Internet/Deployment prüfen."
      : data.message || "Die KI-Antwort konnte nicht erstellt werden.";
    setDrawer((d: any) => d?.msg.id === m.id ? ({ ...d, loading: false, abort: null, error }) : d);
  }

  async function refine(command: string) {
    if (!drawer) return;
    setDrawer((d: any) => ({ ...d, refining: true, refineError: null }));
    const { ok, data, timedOut, aborted } = await fetchJson("/api/reply/refine", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: drawer.msg.id, command }), timeoutMs: 45000
    });
    if (ok) setDrawer((d: any) => d?.msg.id === drawer.msg.id ? ({ ...d, body: data.body, refining: false }) : d);
    else setDrawer((d: any) => d?.msg.id === drawer.msg.id ? ({ ...d, refining: false, refineError: aborted ? "Abgebrochen." : timedOut ? "Zu lange gebraucht." : (data.message || "Bearbeitung fehlgeschlagen.") }) : d);
  }

  async function changeTone(tone: string) {
    if (!drawer) return;
    setDrawer((d: any) => ({ ...d, tone }));
    await generate(drawer.msg, { intent: drawer.intent, intentLabel: drawer.intentLabel, customInstruction: drawer.customInstruction, tone });
  }

  async function saveEdited() {
    if (!drawer) return;
    await requestJson("/api/reply/refine",jsonRequest("POST",{messageId:drawer.msg.id,editedBody:drawer.body}));
  }

  async function send() {
    if (!drawer || actionLocks.current.has("send")) return;
    actionLocks.current.add("send");
    setDrawer((d:any)=>({...d,sending:true,error:null}));
    try {
      await saveEdited();
      await requestJson("/api/reply/send",jsonRequest("POST",{messageId:drawer.msg.id,confirm:true,fromAccountId:drawer.fromAccountId}));
      setDrawer(null); notify("Antwort versendet."); await reloadMessages();
    } catch(e) { setDrawer((d:any)=>d?{...d,sending:false,error:(e as Error).message}:d); }
    finally { actionLocks.current.delete("send"); }
  }

  async function openReader(m: Msg, images = false) {
    if (!images) images = autoImages(m);
    if (images) rememberImageSender(m);
    setMobilePane("read");
    const ckey = "id:"+m.id+":"+(images?1:0);
    const cached = getMsgContent(ckey);
    setReading({msg:m,loading:!cached,...cached});
    try {
      if (cached) {
        if(!m.is_read) await requestJson("/api/mail/action",jsonRequest("POST",{messageId:m.id,action:"read"}));
      } else {
        const data=await requestJson("/api/mail/message?id="+m.id+(images?"&images=1":""));
        setMsgContent(ckey,data);
        setReading((r:any)=>r?.msg.id===m.id?{...r,...data,loading:false}:r);
      }
      setMsgs(rows=>rows.map(row=>row.id===m.id?{...row,is_read:true}:row));
      setReading((r:any)=>r?.msg.id===m.id?{...r,msg:{...r.msg,is_read:true}}:r);
      window.dispatchEvent(new Event("cockpit:mail-changed"));
    } catch(e) { setReading((r:any)=>r?.msg.id===m.id?{...r,loading:false,error:(e as Error).message}:r); }
  }

  async function mailAction(m: Msg, action: string) {
    if (m.readonly) return folderItemAction(m,action);
    if (actionLocks.current.has(m.id)) return;
    actionLocks.current.add(m.id);
    const removes=["delete","archive","spam"].includes(action);
    const before=m;
    if(removes){setMsgs(rows=>rows.filter(row=>row.id!==m.id));setReading(null);setMobilePane("list");}
    else setMsgs(rows=>rows.map(row=>row.id===m.id?{...row,is_read:action==="read"}:row));
    try {
      const data=await requestJson("/api/mail/action",jsonRequest("POST",{messageId:m.id,action}));
      if(!removes) setReading((r:any)=>r?.msg.id===m.id?{...r,msg:{...r.msg,is_read:action==="read"}}:r);
      notify(data.warning || "Nachricht aktualisiert.",!!data.warning);
      window.dispatchEvent(new Event("cockpit:mail-changed"));
    } catch(e) {
      setMsgs(rows=>[...rows.filter(row=>row.id!==m.id),before].sort((a,b)=>Date.parse(b.received_at||0)-Date.parse(a.received_at||0)));
      notify((e as Error).message,true);
    } finally { actionLocks.current.delete(m.id); }
  }

  async function setReplyFlag(m: Msg, needs: boolean) {
    setMsgs((prev) => prev.map((x) => x.id === m.id ? { ...x, needs_reply: needs, action_status: needs ? "reply_required" : "no_action" } : x));
    setReading((s: any) => s && s.msg.id === m.id ? { ...s, msg: { ...s.msg, needs_reply: needs, user_needs_reply: needs } } : s);
    await fetch("/api/mail/categorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: m.id, needs_reply: needs }) });
  }

  // Nutzerregeln laden (für aktive Zustände der Dauerregel-Buttons).
  useEffect(() => { fetch("/api/rules").then((r) => r.json()).then((j) => setRules(j.rules || [])).catch(() => {}); }, []);

  // Fenster der Liste zurücksetzen, wenn Ordner/Ansicht/Suche wechseln.
  useEffect(() => { setListLimit(50); }, [sel, q]);

  // Dauerregel setzen/entfernen (Toggle). Gibt den neuen Zustand zurück.
  async function toggleRule(scope: "sender" | "domain", value: string, patch: any) {
    const v = value.toLowerCase();
    const existing = rules.find((r) => r.match_type === scope && r.match_value === v
      && (patch.set_label !== undefined ? r.set_label === patch.set_label : true)
      && (patch.set_needs_reply !== undefined ? r.set_needs_reply === patch.set_needs_reply : true));
    if (existing) {
      await fetch("/api/rules", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: existing.id }) });
      setRules((rs) => rs.filter((x) => x.id !== existing.id));
      return false;
    }
    const r = await fetch("/api/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ match_type: scope, match_value: v, ...patch }) });
    const j = await r.json();
    if (r.ok && j.rule) { setRules((rs) => [j.rule, ...rs.filter((x) => !(x.match_type === scope && x.match_value === v && x.set_label === j.rule.set_label && x.set_needs_reply === j.rule.set_needs_reply))]); return true; }
    throw new Error(j.message || j.error || "Regel konnte nicht gespeichert werden");
  }

  // Manuell als beantwortet markieren (falls die App es nicht selbst erkennt).
  async function markAnswered(m: Msg, answered: boolean) {
    const patch: any = answered
      ? { reply_sent_at: new Date().toISOString(), draft_status: "gesendet", needs_reply: false, user_needs_reply: false, action_status: "no_action" }
      : { reply_sent_at: null, draft_status: null, needs_reply: true, user_needs_reply: true, action_status: "reply_required" };
    // In der „Antwort nötig"-Ansicht verschwindet die Mail nach dem Beantworten
    // aus der Liste – dann direkt zur nächsten offenen Mail springen.
    let nextMsg: Msg | null = null;
    if (answered && sel.view === "reply") {
      const all = msgs.filter(visible).sort((a, b) => new Date(b.received_at || 0).getTime() - new Date(a.received_at || 0).getTime());
      const idx = all.findIndex((x) => x.id === m.id);
      if (idx >= 0) nextMsg = all[idx + 1] || all[idx - 1] || null;
    }
    setMsgs((prev) => prev.map((x) => x.id === m.id ? { ...x, ...patch } : x));
    if (answered && sel.view === "reply") {
      if (nextMsg) openReader(nextMsg); else setReading(null);
    } else {
      setReading((s: any) => s && s.msg.id === m.id ? { ...s, msg: { ...s.msg, ...patch } } : s);
    }
    await fetch("/api/mail/categorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: m.id, answered }) });
  }

  async function addLabel(m: Msg, label: string, remove = false) {
    const cur = (m.user_labels && m.user_labels.length ? m.user_labels : (m.labels || [])) as string[];
    const next = remove ? cur.filter((l) => l !== label) : Array.from(new Set([...cur, label]));
    setMsgs((prev) => prev.map((x) => x.id === m.id ? { ...x, user_labels: next } : x));
    setReading((s: any) => s && s.msg.id === m.id ? { ...s, msg: { ...s.msg, user_labels: next } } : s);
    await fetch("/api/mail/categorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: m.id, user_labels: next }) });
  }

  async function categorize(m: Msg, opts: { category?: string; hidden?: boolean; ruleScope?: "sender" | "domain"; relevance?: string; message_type?: string; ruleLabel?: string; ruleNeverReply?: boolean }) {
    // Optimistisch aktualisieren (Nutzer-Override, bleibt nach Neuladen erhalten).
    const patch: any = { classification_source: "user_override" };
    if (opts.category !== undefined) patch.semantic_category = opts.category;
    if (opts.hidden !== undefined) patch.hidden = opts.hidden;
    if (opts.relevance !== undefined) { patch.relevance = opts.relevance; patch.user_relevance = opts.relevance; }
    if (opts.message_type !== undefined) { patch.message_type = opts.message_type; patch.user_message_type = opts.message_type; }
    setMsgs((prev) => prev.map((x) => x.id === m.id ? { ...x, ...patch } : x));
    setReading((s: any) => s && s.msg.id === m.id ? { ...s, msg: { ...s.msg, ...patch } } : s);
    const r = await fetch("/api/mail/categorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: m.id, ...opts }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || j.error || "Speichern fehlgeschlagen"); }
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
        {connected && <button className="btn small ghost" onClick={() => manualSync()} aria-label="Aktualisieren" title="Aktualisieren">↻</button>}
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
            <OverlayScroll className="msidebar-scroll">
            <button className={"mfolder top" + (sel.account === "all" && !sel.view && sel.ftype === "inbox" ? " active" : "")} onClick={() => selectFolder("all", "inbox")}>
              <span className="mf-ic">📥</span><span className="mf-lbl">Alle Postfächer</span>
              {unreadInbox() > 0 && <span className="mf-count">{unreadInbox()}</span>}
            </button>
            {accounts.map((a) => {
              const fl = foldersFor(a.id);
              const open = expanded[a.id] !== false;
              const accUnread = unreadInbox(a.id);
              return (
                <div className="macct" key={a.id}>
                  <button className="macct-h" onClick={() => setExpanded((e) => ({ ...e, [a.id]: !open }))}>
                    <span className={"chev" + (open ? " open" : "")}>›</span>
                    <span className="macct-name">{PROVIDERS[a.provider]?.label || a.provider}</span>
                    {accUnread > 0 && <span className="mf-count">{accUnread}</span>}
                  </button>
                  {open && (
                    <div className="macct-folders">
                      {(fl.length ? fl : DEFAULT_FOLDERS.map((t) => ({ account_id: a.id, path: "", folder_type: t, unread: 0, total: 0 }))).map((f: any) => {
                        const ftype = f.type_override || f.folder_type;
                        return (
                          <button key={f.folder_type + f.path} className={"mfolder" + (sel.account === a.id && sel.ftype === ftype && sel.path === f.path && !sel.view ? " active" : "")} onMouseEnter={() => { if (ftype !== "inbox" && ftype !== "sent" && f.path) prefetchFolder(a.id, f.path); }} onClick={() => selectFolder(a.id, ftype, f.path)}>
                            <span className="mf-ic">{FOLDER_ICONS[ftype] || "📁"}</span>
                            <span className="mf-lbl">{folderLabel(f)}</span>
                            {(ftype === "inbox" ? accUnread : f.unread) > 0 && <span className="mf-count">{ftype === "inbox" ? accUnread : f.unread}</span>}
                          </button>
                        );
                      })}
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
            <button className="btn small" style={{ margin: "12px 8px 4px" }} onClick={() => setShowConnect(true)}>+ Postfach</button>
            <button className="ac-diaglink" style={{ margin: "0 8px 12px", display: "block" }} onClick={() => setMailDiag(true)}>Sync-Diagnose</button>
            </OverlayScroll>
          </div>

          {/* Spalte 2: kompakte Nachrichtenliste */}
          <div className="mlist">
            <div className="mlist-top">
              <button className="mback" onClick={() => setMobilePane("nav")} aria-label="Ordner">☰</button>
              <input className="f-search" placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn small ghost" onClick={() => manualSync()} title="Aktualisieren">↻</button>
            </div>
            {/* Filter: Alle / Ungelesen – kombinierbar mit Suche & Auswahl. */}
            <div className="mlist-filter" role="group" aria-label="Filter">
              <button className={"mfilter" + (!unreadOnly ? " active" : "")} onClick={() => setUnreadOnly(false)} aria-pressed={!unreadOnly}>Alle</button>
              <button className={"mfilter" + (unreadOnly ? " active" : "")} onClick={() => setUnreadOnly(true)} aria-pressed={unreadOnly}>
                Ungelesen{unreadFilterCount() > 0 && <span className="mfilter-count">{unreadFilterCount()}</span>}
              </button>
            </div>
            {loadError && <Notice retry={reloadMessages}>{loadError}</Notice>}
            {classify && (
              <div className="classify-banner">
                <span className="spin" />
                <span>Nachrichten werden eingeordnet: {classify.done} von {classify.total}</span>
              </div>
            )}
            {classifyErr && (
              <div className="filter-banner" style={{ background: "var(--urgent-soft)", borderColor: "rgba(255,105,97,.35)", color: "#ffd9d6" }}>
                <span>Einordnung: {classifyErr}</span>
                <button className="mini-link" onClick={runClassify}>Erneut</button>
              </div>
            )}
            {backfill && backfill.running && (
              <div className="classify-banner"><span className="spin" /><span>{backfill.label}</span></div>
            )}
            {backfill && backfill.done && (
              <div className="sync-banner" style={{ background: "var(--low-soft)", borderColor: "rgba(74,222,128,.3)", color: "#c9f7d8" }}>
                <span>Abgleich fertig: {(backfill.summary || []).reduce((s: number, x: any) => s + x.saved, 0)} nachgeladen, {(backfill.summary || []).reduce((s: number, x: any) => s + x.checked, 0)} geprüft.</span>
                <button className="mini-link" onClick={() => setBackfill(null)}>OK</button>
              </div>
            )}
            {(sel.view || sel.ftype !== "inbox" || sel.account !== "all") && unreadInbox() > 0 && (
              <div className="filter-banner">
                <span>Neue Mails im Posteingang ({unreadInbox()}) sind hier ausgeblendet.</span>
                <button className="mini-link" onClick={() => { setSel({ account: "all", ftype: "inbox" }); setFolderItems(null); }}>Filter zurücksetzen</button>
              </div>
            )}
            <OverlayScroll className="mlist-scroll" onScroll={(el) => {
              if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) setListLimit((n) => n + 40);
            }}>
              {folderItems !== null ? (() => {
                if (folderLoading) return [0, 1, 2, 3].map((i) => <div className="sk-card" key={i} />);
                // Ungelesen-Filter auch in On-Demand-Ordnern (Archiv/Junk/…).
                const fitems = folderItems.filter(it => (!unreadOnly || !it.is_read) && ((it.subject || "")+" "+(it.from_name || "")+" "+(it.from_address || "")).toLowerCase().includes(searchQuery.toLowerCase()));
                if (!fitems.length) return <div className="empty" style={{ padding: 40 }}>{unreadOnly ? "Keine ungelesenen Nachrichten in diesem Ordner." : "Keine Nachrichten in diesem Ordner."}</div>;
                return fitems.map((it) => (
                  <MailRow key={it.uid} m={it} account={accById[it.account_id]} onOpen={() => openFolderItem(it)} selected={reading?.msg?.uid === it.uid} labelsOf={labelsOf} />
                ));
              })() : (() => {
                // Nur sichtbare Nachrichten, sortiert; für Performance gefenstert.
                const all = msgs.filter(visible).sort((a, b) => new Date(b.received_at || 0).getTime() - new Date(a.received_at || 0).getTime());
                if (listLoading || (msgs.length === 0 && status?.syncing)) return [0, 1, 2, 3].map((i) => <div className="sk-card" key={i} />);
                if (!all.length) return <div className="empty" style={{ padding: 40 }}><div className="ic">✦</div>{unreadOnly ? "Keine ungelesenen Nachrichten." : "Keine Nachrichten."}</div>;
                const shown = all.slice(0, listLimit);
                return <>
                  {shown.map((m) => (
                    <MailRow key={m.id} m={m} account={accById[m.mail_account_id]} onOpen={() => openReader(m)} selected={reading?.msg?.id === m.id} labelsOf={labelsOf} />
                  ))}
                  {all.length > shown.length && (
                    <button className="btn small" style={{ margin: "12px auto", display: "block" }} onClick={() => setListLimit((n) => n + 60)}>Weitere {Math.min(60, all.length - shown.length)} anzeigen</button>
                  )}
                </>;
              })()}
            </OverlayScroll>
          </div>

          {/* Spalte 3: dauerhafte Leseansicht */}
          <div className="mread">
            <button className="mback mread-back" onClick={() => setMobilePane("list")} aria-label="Zurück">‹ Liste</button>
            {reading ? (
              <Reader reading={reading} account={accById[reading.msg.mail_account_id]} onClose={() => { setReading(null); setMobilePane("list"); }}
                onReply={(opts: any) => { openDraft(reading.msg, opts); }} suggests={suggests[reading.msg.id]} suggestsLoading={!!suggestLoading[reading.msg.id]} ensure={ensureSuggestions}
                onCategorize={categorize} onCorrect={categorize} onLoadImages={() => reading.msg.readonly ? openFolderItem(reading.msg, true) : openReader(reading.msg, true)} onAction={mailAction} onSetReply={setReplyFlag} onAnswered={markAnswered} onAddLabel={addLabel} rules={rules} onRule={toggleRule} onDiag={() => setDiag(true)} />
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
          accounts={accounts} onDiag={() => setDiag(true)}
        />}
      </aside>

      {diag && <DiagModal onClose={() => setDiag(false)} />}
      {mailDiag && <MailDiagModal onClose={() => setMailDiag(false)} client={{
        loadedTotal: msgs.length,
        visibleCount: msgs.filter(visible).length,
        unreadInboxDb: unreadInbox(),
        sel, report: status?.report, syncedAt: status?.syncedAt, syncing: !!status?.syncing, classifyError: status?.classifyError, errors: status?.errors
      }} onReseed={() => { setMailDiag(false); manualSync(true); }} onClean={() => { setMailDiag(false); cleanResync(); }} onReclassify={() => { setMailDiag(false); reclassifyAll(); }} onBackfill={() => { setMailDiag(false); runBackfill(); }} />}
      {compose && <ComposeModal compose={compose} setCompose={setCompose} accounts={accounts} sendEnabled={sendEnabled} />}
    </>
  );
}

// Owner-Diagnose der Mail-Synchronisierung (keine Passwörter/Tokens/Inhalte).
function MailDiagModal({ onClose, client, onReseed, onClean, onReclassify, onBackfill }: any) {
  const [s, setS] = useState<any>({ loading: true });
  useEffect(() => { fetch("/api/mail/diag").then((r) => r.json()).then((d) => setS({ loading: false, ...d })).catch(() => setS({ loading: false, error: true })); }, []);
  return (
    <>
      <div className="scrim open" onClick={onClose} />
      <div className="modal">
        <div className="dh"><h3>Sync-Diagnose</h3><button className="x" onClick={onClose}>✕</button></div>
        <div className="db">
          {!s.loading && s.schema && (s.schema.missingColumns?.length > 0 || !s.schema.bucketExists) && (
            <div className="note binding-warn" style={{ marginTop: 0 }}>
              <b>Einrichtung unvollständig:</b>
              {s.schema.missingColumns?.length > 0 && <div>Fehlende Spalten in „messages": {s.schema.missingColumns.join(", ")}</div>}
              {!s.schema.bucketExists && <div>Storage-Bucket „documents" fehlt (für Bewerbungsunterlagen/PDF-Upload).</div>}
              <div style={{ marginTop: 4 }}>→ bitte das passende SQL in Supabase ausführen.</div>
            </div>
          )}
          {!s.loading && s.schema && !s.schema.missingColumns?.length && s.schema.bucketExists && (
            <div className="note" style={{ marginTop: 0, color: "var(--ok)" }}>Datenbank & Storage vollständig ✓</div>
          )}
          <div className="label">Diese Ansicht (Client)</div>
          <div className="meta-row">
            <span className="k">Geladene Datensätze</span><span className="v">{client.loadedTotal}</span>
            <span className="k">Sichtbar mit Filter</span><span className="v">{client.visibleCount}</span>
            <span className="k">Ungelesen Posteingang (DB)</span><span className="v">{client.unreadInboxDb}</span>
            <span className="k">Aktiver Filter</span><span className="v">{client.sel.view ? "Ansicht: " + client.sel.view : `Konto: ${client.sel.account} · Ordner: ${client.sel.ftype}`}</span>
            <span className="k">Letzter Sync</span><span className="v">{client.syncing ? "läuft…" : client.syncedAt ? new Date(client.syncedAt).toLocaleTimeString("de-DE") : "—"}</span>
          </div>
          {client.classifyError && <div className="note binding-warn" style={{ marginTop: 8 }}>Einordnung meldet: {client.classifyError}</div>}
          {client.errors && client.errors.length > 0 && (
            <div className="note binding-warn" style={{ marginTop: 8 }}>
              <b>Sync-Fehler:</b>
              {client.errors.map((er: string, i: number) => <div key={i}>{er}</div>)}
            </div>
          )}
          {client.report && client.report.length > 0 && (
            <>
              <div className="label">Letzter Sync-Lauf</div>
              <div className="diag-list">
                {client.report.map((r: any, i: number) => (
                  <div key={i} className={"diag-row" + (r.error || r.skipped ? " bad" : "")}>
                    <span className="diag-kind">{r.email}</span>
                    <span className="diag-meta">{r.error ? "Fehler: " + r.error : `neu ${r.newUids} · gespeichert ${r.saved} · übersprungen ${r.skipped}`}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="label">Server (Datenbank & IMAP)</div>
          {s.loading ? <div className="empty"><span className="spin" /></div> : s.error ? <div className="note binding-warn">Diagnose nicht verfügbar.</div> : (
            <>
              <div className="meta-row">
                <span className="k">Posteingang gespeichert</span><span className="v">{s.db?.inboxTotal}</span>
                <span className="k">davon ungelesen</span><span className="v">{s.db?.inboxUnread}</span>
                <span className="k">noch nicht eingeordnet</span><span className="v">{s.db?.unclassified}</span>
              </div>
              {(s.accounts || []).map((a: any, i: number) => (
                <div className="diag-row" key={i} style={{ marginTop: 6 }}>
                  <span className="diag-kind">{a.email}</span>
                  <span className="diag-meta">UID {a.inbox_last_uid} · IMAP ungelesen {a.imapInboxUnread} · {a.last_synced_at ? new Date(a.last_synced_at).toLocaleTimeString("de-DE") : "nie"}{a.last_error ? " · " + a.last_error : ""}</span>
                </div>
              ))}
            </>
          )}
          <div className="note" style={{ fontSize: 12, marginTop: 12 }}>Keine Passwörter, Tokens oder Mailinhalte werden angezeigt.</div>
        </div>
        <div className="df" style={{ flexWrap: "wrap" }}>
          {onBackfill && <button className="btn btn-primary" onClick={onBackfill} title="Alle Ordner mit dem Server abgleichen und fehlende Mails nachladen (keine Duplikate)">Vollständiger Abgleich</button>}
          {onReclassify && <button className="btn" onClick={onReclassify} title="Alle Mails neu einordnen (Labels/Relevanz), ohne sie zu löschen">Alles neu einordnen</button>}
          {onReseed && <button className="btn" onClick={onReseed} title="Setzt den Sync-Zeiger zurück und holt die letzten ~40 Mails neu">Posteingang neu einlesen</button>}
          {onClean && <button className="btn btn-primary" onClick={onClean} title="Alle Mails löschen und sauber neu einlesen – korrigiert falsche Kontozuordnung">Bereinigt neu einlesen</button>}
          <button className="btn" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </>
  );
}

const MailRow = memo(function MailRow({ m, account, onOpen, selected, labelsOf }: any) {
  const isSent = m.folder_type === "sent";
  const provider = account ? (PROVIDERS[account.provider]?.label || account.provider) : (m.account_display_name || "");
  const labels: string[] = (labelsOf ? labelsOf(m) : (m.labels || [])).filter((l: string) => l !== "Automatisch" && l !== "Persönlich" && l !== "Sonstiges").slice(0, 2);
  const chip = statusChip(m);
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
          {!m.classified_at && !isSent
            ? <span className="mrow-status pending">Wird eingeordnet…</span>
            : chip && <span className={"mrow-status " + chip.tone}>{chip.text}</span>}
          {labels.map((l) => <span key={l} className="mrow-label" style={{ ["--lc" as any]: LABEL_COLORS[l] || "#8a8a8f" }}>{l}</span>)}
        </div>
      </div>
    </div>
  );
});

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

function Reader({ reading, account, onClose, onReply, suggests, suggestsLoading, ensure, onCategorize, onCorrect, onLoadImages, onAction, onSetReply, onAnswered, onAddLabel, rules, onRule, onDiag }: any) {
  const [saving, setSaving] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  async function doSave(key: string, fn: () => Promise<any>) {
    setSaveErr(null); setSaving(key);
    try { await fn(); setSaving("ok"); setTimeout(() => setSaving((s) => s === "ok" ? null : s), 1200); }
    catch (e: any) { setSaving(null); setSaveErr(e?.message || "Speichern fehlgeschlagen"); }
  }
  const ruleActive = (scope: string, value: string, patch: any) => !!(rules || []).find((r: any) => r.match_type === scope && r.match_value === (value || "").toLowerCase()
    && (patch.set_label !== undefined ? r.set_label === patch.set_label : true)
    && (patch.set_needs_reply !== undefined ? r.set_needs_reply === patch.set_needs_reply : true));
  const m = reading.msg;
  const isSent = m.folder_type === "sent";
  const [takingJob, setTakingJob] = useState(false);
  // Ansichtsmodus der geöffneten Mail: standardmäßig "Angepasst" (Dark-Mode-harmonisch).
  const [view, setView] = useState<"angepasst" | "original" | "text">("angepasst");
  useEffect(() => { setView("angepasst"); }, [m.id]); // eslint-disable-line
  // KI-Antwort nur bei echten persönlichen Antwortfällen – nicht bei Umfrage/Newsletter/Rechnung.
  const mtype = m.user_message_type || m.message_type;
  const mneeds = m.user_needs_reply != null ? m.user_needs_reply : m.needs_reply;
  const isPersonal = (mtype === "personal_direct" || mtype === "personal_thread" || mtype === "job_offer" || m.user_needs_reply === true);
  const canReply = isPersonal && mneeds && m.draft_status !== "gesendet" && !isSent;
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
            <div><b>Einordnung:</b> {m.summary || wantSummary(m)}</div>
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
              {["Karate", "Bewerbungen", "Zahlungen", "Abonnements", "Reisen", "Bestellungen", "Schule", "Sicherheit", "Termine", "Persönlich", "Newsletter", "Automatisch"].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
        </div>

        {!isSent && onCorrect && (() => {
          const curType = m.user_message_type || m.message_type;
          const curRel = m.user_relevance || m.relevance;
          const sender = (m.from_address || "").toLowerCase();
          const domain = sender.includes("@") ? sender.split("@")[1] : "";
          const topLabel = labelsOfMsg(m)[0] || "Newsletter";
          return (
          <details className="rd-correct">
            <summary>Einstufung korrigieren</summary>
            <div className="rc-body">
              <div className="rc-row"><span className="rc-k">Relevanz</span>
                <div className="chips">
                  {[["sehr_wichtig", "Sehr wichtig"], ["wichtig", "Wichtig"], ["normal", "Normal"], ["niedrig", "Niedrig"], ["irrelevant", "Irrelevant"]].map(([v, l]) => (
                    <button key={v} className={"chip" + (curRel === v ? " sel" : "")} onClick={() => doSave("rel-" + v, () => onCorrect(m, { relevance: v }))}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="rc-row"><span className="rc-k">Art</span>
                <div className="chips">
                  <button className={"chip" + (curType === "personal_direct" || curType === "personal_thread" ? " sel" : "")} onClick={() => doSave("t-p", () => onCorrect(m, { message_type: "personal_direct" }))}>Persönlich</button>
                  <button className={"chip" + (["system_notification", "welcome", "auto_confirmation", "security_info"].includes(curType) ? " sel" : "")} onClick={() => doSave("t-a", () => onCorrect(m, { message_type: "system_notification" }))}>Automatisch</button>
                  <button className={"chip" + (curType === "newsletter" || curType === "marketing" ? " sel" : "")} onClick={() => doSave("t-n", () => onCorrect(m, { message_type: "newsletter" }))}>Newsletter</button>
                  <button className={"chip" + ((m.user_needs_reply != null ? m.user_needs_reply : m.needs_reply) ? " sel" : "")} onClick={() => doSave("nr", async () => onSetReply(m, !(m.user_needs_reply != null ? m.user_needs_reply : m.needs_reply)))}>{(m.user_needs_reply != null ? m.user_needs_reply : m.needs_reply) ? "Antwort nötig ✓" : "Antwort nötig"}</button>
                </div>
              </div>
              <div className="rc-row"><span className="rc-k">Dauerregel für {m.from_address}</span>
                <div className="chips">
                  <button className={"chip" + (ruleActive("sender", sender, { set_needs_reply: false }) ? " sel" : "")} onClick={() => doSave("r-nr", () => onRule("sender", sender, { set_needs_reply: false }))}>Nie antwortpflichtig</button>
                  <button className={"chip" + (ruleActive("sender", sender, { set_label: topLabel }) ? " sel" : "")} onClick={() => doSave("r-l", () => onRule("sender", sender, { set_label: topLabel }))}>Absender immer „{topLabel}"</button>
                  <button className={"chip" + (ruleActive("sender", sender, { set_label: "Sicherheit" }) ? " sel" : "")} onClick={() => doSave("r-s", () => onRule("sender", sender, { set_label: "Sicherheit" }))}>Absender immer Sicherheit</button>
                  {domain && <button className={"chip" + (ruleActive("domain", domain, { set_label: "Bewerbungen" }) ? " sel" : "")} onClick={() => doSave("r-d", () => onRule("domain", domain, { set_label: "Bewerbungen" }))}>Domain → Bewerbungen</button>}
                </div>
              </div>
              {(saving || saveErr) && (
                <div className={"rc-status" + (saveErr ? " err" : "")}>
                  {saveErr ? saveErr : saving === "ok" ? "Gespeichert ✓" : <><span className="spin" /> Speichern…</>}
                </div>
              )}
            </div>
          </details>
          );
        })()}

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
            <div className="label rd-actions-head">KI-Antwortvorschläge {onDiag && <button className="rd-diaglink" onClick={onDiag} title="KI-Diagnose öffnen">Diagnose</button>}</div>
            <div className="suggests">
              {(suggests && suggests.length ? suggests : []).map((s: any, i: number) => (
                <button key={i} className={"sug" + (s.binding ? " binding" : "")} title={s.explanation} onClick={() => onReply({ intent: s.intent, intentLabel: s.label })}>{s.label}</button>
              ))}
              {suggestsLoading && <span className="sug" style={{ pointerEvents: "none" }}><span className="spin" /></span>}
              {!suggestsLoading && (!suggests || !suggests.length) && <span className="note" style={{ margin: 0, fontSize: 12.5 }}>Keine Vorschläge verfügbar – du kannst frei antworten.</span>}
              <button className="sug custom" onClick={() => onReply({ custom: true })}>Eigene Antwort</button>
            </div>
          </div>
        ) : !isSent && (
          <div className="rd-actions">
            <div className="note" style={{ marginTop: 0 }}>
              {m.summary ? m.summary
                : mtype === "survey_feedback" ? "Automatisierte Feedback-/Umfragemail – keine persönliche Antwort nötig."
                : mtype === "newsletter" || mtype === "marketing" || m.is_bulk ? "Massen-/Newslettermail – keine persönliche Antwort nötig."
                : mtype === "invoice_receipt" ? "Transaktions-/Belegmail – nur zur Information."
                : "Keine persönliche Antwort erwartet."}
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              <button className="chip" onClick={() => onSetReply(m, true)}>Doch Antwort nötig</button>
              <button className="chip" onClick={() => onReply({ custom: true })} title="KI-Antwort trotzdem erstellen">Trotzdem mit KI antworten</button>
              <button className="chip" onClick={() => onCategorize(m, { hidden: true, ruleScope: "sender" })}>Newsletter ausblenden</button>
            </div>
          </div>
        )}
      </div>
      <div className="df">
        {m.readonly ? (
          // On-demand-Ordner (Archiv/Junk/…): passende Verschiebe-Aktionen.
          <>
            {m.folder_type !== "inbox" && <button className="btn btn-primary" onClick={() => onAction(m, "inbox")} title="Zurück in den Posteingang verschieben">{m.folder_type === "spam" ? "Kein Spam · In Posteingang" : "In Posteingang"}</button>}
            {m.folder_type !== "spam" && <button className="btn" onClick={() => onAction(m, "spam")}>Als Spam</button>}
            <button className="btn btn-danger" onClick={() => onAction(m, "delete")}>Löschen</button>
          </>
        ) : (<>
        {canReply && <button className="btn btn-primary" onClick={() => onReply({ custom: true })}>Antworten</button>}
        {!isSent && onAnswered && (
          m.reply_sent_at
            ? <button className="btn btn-answered" onClick={() => onAnswered(m, false)} title="Doch nicht beantwortet – wieder als offen markieren">✓ Beantwortet</button>
            : <button className="btn" onClick={() => onAnswered(m, true)} title="Diese Mail manuell als beantwortet markieren">Beantwortet</button>
        )}
        {!isSent && m.needs_reply && <button className="btn" onClick={() => onSetReply(m, false)} title="Als erledigt/keine Antwort">Keine Antwort nötig</button>}
        <button className="btn" onClick={() => onAction(m, "archive")}>Archivieren</button>
        <button className="btn" onClick={() => onAction(m, "spam")}>Spam</button>
        <button className="btn btn-danger" onClick={() => onAction(m, "delete")}>Löschen</button>
        {!isSent && !m.readonly && (
          <button className="btn" disabled={takingJob} title="Diese Mail als Stellenanzeige in die Bewerbungszentrale übernehmen"
            onClick={async () => {
              setTakingJob(true);
              const { ok, data } = await fetchJson("/api/applications/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "email", messageId: m.id }), timeoutMs: 60000 });
              setTakingJob(false);
              if (ok) window.location.href = "/applications";
              else alert(data.message || "Übernahme fehlgeschlagen.");
            }}>
            {takingJob ? "Übernehme…" : "Als Stelle übernehmen"}
          </button>
        )}
        </>)}
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
      // Antwort robust lesen: Bei Timeout/Serverfehler kommt evtl. eine HTML-
      // Fehlerseite statt JSON – die darf nicht als „Unexpected token" abstürzen.
      const text = await r.text();
      let j: any = {};
      try { j = text ? JSON.parse(text) : {}; } catch { j = {}; }
      if (!r.ok) {
        setErr(j.error || (r.status === 504
          ? "Zeitüberschreitung beim Verbinden. Das Postfach wurde eventuell schon gespeichert – bitte die Seite neu laden und prüfen."
          : `Verbindung fehlgeschlagen (${r.status}).`));
        setBusy(false); return;
      }
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

function DraftPanel({ drawer, setDrawer, sendEnabled, onGenerateCustom, onRefine, onChangeTone, onSend, onRegenerate, accounts, onDiag }: any) {
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
              value={drawer.customInstruction} autoFocus disabled={drawer.loading}
              onChange={(e) => setDrawer((x: any) => ({ ...x, customInstruction: e.target.value }))} />
            {drawer.error && <div className="note binding-warn" style={{ marginTop: 10 }}>{drawer.error} {onDiag && <button className="rd-diaglink" onClick={onDiag}>Diagnose</button>}</div>}
            <div className="df" style={{ padding: "14px 0 0", borderTop: 0 }}>
              <button className="btn btn-primary" disabled={!drawer.customInstruction?.trim() || drawer.loading} onClick={onGenerateCustom}>
                {drawer.loading ? <><span className="spin" /> Erstelle…</> : "Entwurf erstellen"}
              </button>
              {drawer.loading && drawer.abort
                ? <button className="btn" onClick={() => drawer.abort()}>Abbrechen</button>
                : <button className="btn" onClick={() => setDrawer(null)}>Schließen</button>}
            </div>
          </>
        ) : drawer.loading ? (
          <div className="empty">
            <span className="spin" />
            <div style={{ marginTop: 12 }}>Antwort wird formuliert…</div>
            {drawer.abort && <button className="btn" style={{ marginTop: 14 }} onClick={() => drawer.abort()}>Abbrechen</button>}
          </div>
        ) : !d ? (
          // Kein Entwurf und nicht (mehr) am Laden → verständlicher Fehler statt Dauerspinner.
          <div className="empty">
            <div className="note binding-warn" style={{ marginTop: 0 }}>{drawer.error || "Es konnte kein Entwurf erstellt werden."}</div>
            <div className="chips" style={{ marginTop: 12, justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={onRegenerate}>Erneut versuchen</button>
              {onDiag && <button className="btn" onClick={onDiag}>KI-Diagnose</button>}
              <button className="btn" onClick={() => setDrawer(null)}>Schließen</button>
            </div>
          </div>
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
            {drawer.refineError && <div className="note binding-warn">{drawer.refineError}</div>}

            {d.missing_info && <div className="note warn"><b>Fehlende Information:</b> {d.missing_info} — bitte vor dem Senden prüfen.</div>}
            {d.needs_attachment && <div className="note warn"><b>Anhang beachten:</b> In dieser Unterhaltung werden Unterlagen angefordert. Anhänge werden aktuell nicht mitgesendet – bei Bedarf separat verschicken.</div>}
            {d.binding && <div className="note binding-warn"><b>Achtung – verbindliche Antwort:</b> Diese Antwort enthält eine verbindliche oder sensible Entscheidung. Bitte prüfe den Text genau vor dem Senden.</div>}
            {drawer.error && <div className="note binding-warn">{drawer.error} {onDiag && <button className="rd-diaglink" onClick={onDiag}>Diagnose</button>}</div>}
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

// Owner-eigene KI-Diagnose: Konfiguration + letzte Anfragen (Zeit, Erfolg,
// Dauer, Modell, Fehlerkategorie). Keine Schlüssel, keine Mailinhalte.
function DiagModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<any>({ loading: true });
  useEffect(() => {
    (async () => {
      const { ok, data } = await fetchJson("/api/mail/ai-diagnostics", { timeoutMs: 15000 });
      setState(ok ? { loading: false, ...data } : { loading: false, error: true });
    })();
  }, []);
  const catLabel: Record<string, string> = {
    not_configured: "Nicht eingerichtet", auth: "Authentifizierung", rate_limit: "Rate-Limit",
    timeout: "Zeitüberschreitung", overloaded: "Überlastet", api_error: "API-Fehler"
  };
  return (
    <>
      <div className="scrim open" onClick={onClose} />
      <div className="modal">
        <div className="dh"><h3>KI-Diagnose</h3><button className="x" onClick={onClose}>✕</button></div>
        <div className="db">
          {state.loading ? <div className="empty"><span className="spin" /></div> : state.error ? (
            <div className="note binding-warn">Diagnose konnte nicht geladen werden.</div>
          ) : (
            <>
              <div className="meta-row">
                <span className="k">KI-Verbindung</span>
                <span className="v">{state.configured ? "✅ eingerichtet" : "❌ nicht eingerichtet (ANTHROPIC_API_KEY fehlt)"}</span>
                <span className="k">Modell</span><span className="v">{state.model || "—"}</span>
                <span className="k">Versand</span><span className="v">{state.sendEnabled ? "aktiviert" : "deaktiviert"}</span>
              </div>
              <div className="label">Letzte KI-Anfragen</div>
              {(!state.events || !state.events.length) ? (
                <div className="note" style={{ marginTop: 0 }}>Noch keine KI-Anfragen protokolliert. (Tabelle <code>ai_events</code> ggf. per <code>schema_ai.sql</code> anlegen.)</div>
              ) : (
                <div className="diag-list">
                  {state.events.map((e: any, i: number) => (
                    <div key={i} className={"diag-row" + (e.ok ? "" : " bad")}>
                      <span className="diag-ic">{e.ok ? "✅" : "⚠️"}</span>
                      <span className="diag-kind">{e.kind}</span>
                      <span className="diag-meta">{e.created_at ? new Date(e.created_at).toLocaleString("de-DE") : ""} · {e.duration_ms != null ? Math.round(e.duration_ms / 100) / 10 + " s" : "—"}{e.error_category ? " · " + (catLabel[e.error_category] || e.error_category) : ""}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="note" style={{ marginTop: 12, fontSize: 12 }}>Es werden bewusst keine Schlüssel und keine vollständigen Mailinhalte gespeichert.</div>
            </>
          )}
        </div>
        <div className="df"><button className="btn" onClick={onClose}>Schließen</button></div>
      </div>
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
