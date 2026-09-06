import { ImapFlow } from "imapflow";
import { classify } from "./classify";
import { supabaseAdmin } from "./supabaseAdmin";
import { MailAccount, accountPassword } from "./mailAccounts";
import { folderType, FolderType } from "./folders";
import { loadRules, applyRules } from "./rules";
import { classifyEmail } from "./anthropic";
import { detectType } from "./messageType";
import { classifyMessage } from "./classify2";
import { resolvePublicNetworkEndpoint } from "./safeRemote";

const HEADER_FIELDS = ["list-unsubscribe", "list-id", "precedence", "auto-submitted", "feedback-id", "x-feedback-id", "reply-to", "return-path"];

function parseHeaders(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

const SEED_COUNT = 150;      // Erstsync / Neu-Einlesen Posteingang (mehr Verlauf)
const SENT_SEED = 40;        // Gesendet je Lauf (idempotent per Message-ID)
const CLASSIFY_CAP = 12;     // max. KI-Klassifizierungen pro Lauf

async function makeClient(acc: MailAccount): Promise<ImapFlow> {
  const endpoint = await resolvePublicNetworkEndpoint(acc.imap_host);
  return new ImapFlow({
    host: endpoint.address,
    servername: endpoint.servername,
    port: acc.imap_port,
    secure: (acc as any).imap_secure !== false,
    auth: { user: acc.username, pass: accountPassword(acc) },
    logger: false,
    socketTimeout: 45_000
  });
}

export async function verifyLogin(acc: MailAccount): Promise<void> {
  const client = await makeClient(acc);
  await client.connect();
  await client.logout();
}

// Findet den echten Ordnernamen für einen kanonischen Typ (z. B. Gesendet).
async function findMailbox(client: ImapFlow, type: FolderType): Promise<{ path: string } | null> {
  const list = await client.list();
  for (const box of list) {
    const su = Array.isArray((box as any).specialUse) ? (box as any).specialUse.join(" ") : (box as any).specialUse;
    if (folderType(box.path, su) === type) return { path: box.path };
  }
  return null;
}

export interface SyncResult {
  processed: number; saved: number; skipped: number;
  newUids: number[]; skippedUids: number[];
}

export interface BackfillBatch {
  total: number; processed: number; saved: number; updated: number; skipped: number; failed: number;
  next: number | null; // nächste Sequenznummer oder null (fertig)
}

// Sicherer Backfill: prüft einen Sequenzbereich eines Ordners, lädt NUR
// fehlende Nachrichten nach (keine Duplikate), aktualisiert Gelesen-Status
// vorhandener, ohne Nutzer-Klassifizierungen zu überschreiben.
export async function backfillBatch(acc: MailAccount, ftype: "inbox" | "sent", startSeq: number, batch: number): Promise<BackfillBatch> {
  const admin = supabaseAdmin();
  const client = await makeClient(acc);
  const rules = await loadRules(acc.user_id).catch(() => []);
  const res: BackfillBatch = { total: 0, processed: 0, saved: 0, updated: 0, skipped: 0, failed: 0, next: null };
  await client.connect();
  try {
    const path = ftype === "inbox" ? "INBOX" : (await findMailbox(client, "sent"))?.path;
    if (!path) return res;
    const lock = await client.getMailboxLock(path);
    try {
      const box: any = client.mailbox;
      const exists = Number(box?.exists || 0);
      res.total = exists;
      if (exists === 0 || startSeq > exists) return res;
      const end = Math.min(startSeq + batch - 1, exists);
      const msgs: any[] = [];
      for await (const msg of client.fetch(`${startSeq}:${end}`, { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true, headers: HEADER_FIELDS })) {
        msgs.push(msg);
      }
      const gidOf = (m: any) => `${acc.id}:${m.envelope?.messageId || `uid-${ftype}-${m.uid}`}`;
      const gids = msgs.map(gidOf);
      const { data: existing, error: existingError } = await admin.from("messages").select("graph_id").eq("user_id", acc.user_id).in("graph_id", gids);
      if (existingError) throw new Error("Vorhandene Nachrichten konnten nicht geprüft werden.");
      const existSet = new Set((existing || []).map((item: any) => item.graph_id));
      for (const msg of msgs) {
        res.processed++;
        const gid = gidOf(msg);
        try {
          if (existSet.has(gid)) {
            // Nur Gelesen-/Flag-Status auffrischen (keine Reklassifizierung).
            const flags: Set<string> = msg.flags instanceof Set ? msg.flags : new Set(msg.flags || []);
            const { error } = await admin.from("messages").update({ is_read: ftype === "sent" ? true : flags.has("\\Seen"), is_flagged: flags.has("\\Flagged") }).eq("user_id", acc.user_id).eq("graph_id", gid);
            if (error) throw new Error("Nachrichtenstatus konnte nicht gespeichert werden.");
            res.updated++; res.skipped++;
          } else {
            await upsertMessage(acc, msg, ftype, path, rules);
            res.saved++;
          }
        } catch { res.failed++; }
      }
      res.next = end >= exists ? null : end + 1;
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return res;
}

// Hauptsync: Posteingang (inkrementell) + Gesendet (Seed), dann KI-Kategorien.
export async function syncInbox(acc: MailAccount, options: {classify?:boolean} = {}): Promise<SyncResult> {
  const admin = supabaseAdmin();
  const client = await makeClient(acc);
  const result: SyncResult = { processed: 0, saved: 0, skipped: 0, newUids: [], skippedUids: [] };
  // Nutzerregeln einmal laden und auf jede neue Mail anwenden (Vorrang vor KI).
  const rules = await loadRules(acc.user_id).catch(() => []);

  await client.connect();
  try {
    // ----- Posteingang (inkrementell via UID-Cursor) -----
    const lock = await client.getMailboxLock("INBOX");
    try {
      const box: any = client.mailbox;
      const uidValidity = Number(box?.uidValidity || 0);
      const exists = Number(box?.exists || 0);
      let lastUid = Number(acc.inbox_last_uid || 0);
      if (acc.inbox_uidvalidity && Number(acc.inbox_uidvalidity) !== uidValidity) lastUid = 0;
      // Cursor nur über den lückenlos erfolgreich gespeicherten Anfang vorrücken,
      // damit eine einzelne fehlgeschlagene Nachricht NIE übersprungen wird.
      let advanceUid = lastUid;
      let blocked = false;

      if (exists > 0) {
        const range = lastUid > 0 ? `${lastUid + 1}:*` : `${Math.max(1, exists - SEED_COUNT + 1)}:*`;
        const opts = lastUid > 0 ? { uid: true as const } : undefined;
        for await (const msg of client.fetch(range, { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true, headers: HEADER_FIELDS }, opts)) {
          const uid = Number(msg.uid);
          if (lastUid > 0 && uid <= lastUid) continue;
          result.newUids.push(uid);
          result.processed++;
          try {
            await upsertMessage(acc, msg, "inbox", "INBOX", rules);
            result.saved++;
            if (!blocked && uid > advanceUid) advanceUid = uid;
          } catch (e) {
            result.skipped++;
            result.skippedUids.push(uid);
            blocked = true; // ab hier Cursor nicht weiter vorrücken → Retry nächster Lauf
            console.error(`upsertMessage uid=${uid} (${acc.email}):`, (e as Error).message);
          }
        }
      }

      // ----- Gelesen-Status (\Seen) externer Apps übernehmen -----
      // Wird eine Mail außerhalb des Cockpits (z. B. iPhone-Mail, WEB.DE- oder
      // iCloud-Weboberfläche) gelesen oder wieder auf ungelesen gesetzt, so
      // ändert sich das IMAP-Flag \Seen. Der inkrementelle Abruf oben sieht nur
      // NEUE UIDs, daher gleichen wir hier zusätzlich die Flags aller lokal
      // gespeicherten Posteingangs-Mails ab und schreiben Abweichungen nach Supabase.
      // Beidseitig: gelesen -> is_read=true, ungelesen -> is_read=false.
      await reconcileSeenFlags(acc, client, exists);

      const { error: accountUpdateError } = await admin.from("mail_accounts").update({
        inbox_uidvalidity: uidValidity,
        inbox_last_uid: advanceUid,
        last_synced_at: new Date().toISOString(),
        status: "connected",
        last_error: result.skipped > 0 ? `${result.skipped} Nachricht(en) konnten nicht gespeichert werden` : null
      }).eq("id", acc.id).eq("user_id", acc.user_id);
      if (accountUpdateError) throw new Error("Synchronisierungsstand konnte nicht gespeichert werden.");
    } finally {
      lock.release();
    }

    // ----- Gesendet (Seed je Lauf; Dedupe über Message-ID) -----
    try {
      const sent = await findMailbox(client, "sent");
      if (sent) {
        const slock = await client.getMailboxLock(sent.path);
        try {
          const sbox: any = client.mailbox;
          const sexists = Number(sbox?.exists || 0);
          if (sexists > 0) {
            const start = Math.max(1, sexists - SENT_SEED + 1);
            for await (const msg of client.fetch(`${start}:*`, { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true, headers: HEADER_FIELDS })) {
              try { await upsertMessage(acc, msg, "sent", sent.path, rules); result.saved++; }
              catch (e) { result.skipped++; console.error("upsertMessage (sent):", (e as Error).message); }
              result.processed++;
            }
          }
        } finally {
          slock.release();
        }
      }
    } catch (e) {
      console.error("Sent-Sync übersprungen:", (e as Error).message);
    }

    // ----- Ordnerliste je Konto (echte IMAP-Ordner + Zähler) -----
    try {
      await syncFolders(acc, client);
    } catch (e) {
      console.error("Ordnerliste übersprungen:", (e as Error).message);
    }
  } finally {
    await client.logout().catch(() => {});
  }

  // ----- KI-Kategorien + Regeln (getrennt, gedeckelt) -----
  try {
    if (options.classify !== false) await classifyNew(acc);
  } catch (e) {
    console.error("Klassifizierung übersprungen:", (e as Error).message);
  }

  return result;
}

// Liest die echten Ordner des Kontos aus und speichert Typ + Zähler.
async function syncFolders(acc: MailAccount, client: ImapFlow): Promise<void> {
  const admin = supabaseAdmin();
  const list = await client.list();
  const rows: any[] = [];
  for (const box of list) {
    if ((box as any).flags && Array.from((box as any).flags).includes("\\Noselect")) continue;
    const su = Array.isArray((box as any).specialUse) ? (box as any).specialUse.join(" ") : (box as any).specialUse;
    const ftype = folderType(box.path, su);
    let unread = 0, total = 0;
    try {
      const st: any = await client.status(box.path, { unseen: true, messages: true });
      unread = Number(st?.unseen || 0); total = Number(st?.messages || 0);
    } catch { /* Zähler optional */ }
    rows.push({ user_id: acc.user_id, account_id: acc.id, path: box.path, folder_type: ftype, unread, total, updated_at: new Date().toISOString() });
  }
  if (rows.length) {
    const { error } = await admin.from("mail_folders").upsert(rows, { onConflict: "account_id,path" });
    if (error) throw new Error("Ordnerliste konnte nicht gespeichert werden.");
  }
}

// Gleicht den \Seen-Status aller lokal gespeicherten Posteingangs-Mails mit
// Supabase ab. Erwartet, dass INBOX bereits (per Lock) ausgewählt ist.
// Schreibt NUR echte Abweichungen (minimale Realtime-Änderungen), damit
// Ungelesen-Punkt, Ordnerzähler, Dashboard-Badge, intelligente Ansichten und
// „Alle Postfächer" sofort und einheitlich aktualisiert werden.
async function reconcileSeenFlags(acc: MailAccount, client: ImapFlow, exists: number): Promise<void> {
  if (!exists || exists <= 0) return;
  const admin = supabaseAdmin();
  // Reconcile every persisted inbox UID, including old unread mail. Only flags
  // cross the IMAP connection; bodies are never downloaded here.
  const stored: string[] = [];
  for (let offset=0;;offset+=1000) {
    const {data,error}=await admin.from("messages").select("web_link")
      .eq("user_id",acc.user_id).eq("mail_account_id",acc.id).eq("folder_type","inbox").eq("is_deleted",false).order("id").range(offset,offset+999);
    if(error) throw new Error("Gelesen-Abgleich konnte nicht geladen werden.");
    stored.push(...(data||[]).map(row=>row.web_link||"").filter(link=>/^imap-uid:\\d+$/.test(link)));
    if(!data||data.length<1000) break;
  }
  const uids=Array.from(new Set(stored.map(link=>link.slice(9))));
  if(!uids.length) return;
  const seenLinks: string[] = [];
  const unseenLinks: string[] = [];
  for (let offset=0;offset<uids.length;offset+=250) {
  for await (const msg of client.fetch(uids.slice(offset,offset+250).join(","), { uid: true, flags: true }, {uid:true})) {
    if (!msg.uid) continue;
    const flags: Set<string> = msg.flags instanceof Set ? msg.flags : new Set(msg.flags || []);
    (flags.has("\\Seen") ? seenLinks : unseenLinks).push(`imap-uid:${msg.uid}`);
  }
  }
  const chunk = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };
  // Extern gelesen -> is_read = true (nur bisher ungelesene Datensätze).
  for (const part of chunk(seenLinks, 150)) {
    const {error} = await admin.from("messages").update({ is_read: true })
      .eq("mail_account_id", acc.id).eq("folder_type", "inbox").eq("is_read", false)
      .eq("user_id",acc.user_id).in("web_link", part);
    if(error) throw new Error("Gelesen-Status konnte nicht gespeichert werden.");
  }
  // Extern auf ungelesen gesetzt -> is_read = false (nur bisher gelesene).
  for (const part of chunk(unseenLinks, 150)) {
    const {error} = await admin.from("messages").update({ is_read: false })
      .eq("mail_account_id", acc.id).eq("folder_type", "inbox").eq("is_read", true)
      .eq("user_id",acc.user_id).in("web_link", part);
    if(error) throw new Error("Gelesen-Status konnte nicht gespeichert werden.");
  }
}

function hasAttachments(bodyStructure: any): boolean {
  if (!bodyStructure) return false;
  const walk = (node: any): boolean => {
    if (!node) return false;
    if (node.disposition && String(node.disposition).toLowerCase() === "attachment") return true;
    if (Array.isArray(node.childNodes)) return node.childNodes.some(walk);
    return false;
  };
  return walk(bodyStructure);
}

async function upsertMessage(acc: MailAccount, msg: any, ftype: FolderType, mailbox: string, rules: any[] = []): Promise<void> {
  const admin = supabaseAdmin();
  const env = msg.envelope || {};
  const addrList = (arr: any[]) => (arr || []).map((a: any) => a.address).filter(Boolean).join(", ");
  const fromAddr = env.from?.[0]?.address || null;
  const fromName = env.from?.[0]?.name || null;
  const received = msg.internalDate ? new Date(msg.internalDate).toISOString() : env.date ? new Date(env.date).toISOString() : null;
  const flags: Set<string> = msg.flags instanceof Set ? msg.flags : new Set(msg.flags || []);
  const isRead = flags.has("\\Seen");
  const isFlagged = flags.has("\\Flagged");
  const rfcMessageId = env.messageId || null;
  // Dedup-Schlüssel IMMER kontospezifisch: dieselbe Mail an mehrere eigene
  // Konten (gleiche Message-ID) darf NICHT zu einem Datensatz zusammenfallen,
  // sonst wechselt die Kontozuordnung je nach Sync-Reihenfolge.
  const graphId = `${acc.id}:${rfcMessageId || `uid-${ftype}-${msg.uid}`}`;
  const references = Array.isArray(env.references) ? env.references.join(" ") : env.references || null;
  // Thread-ID: erster Bezug (Ursprungsnachricht) oder eigene Message-ID (unpräfixiert).
  const threadId = env.inReplyTo || (references ? references.split(/\s+/)[0] : null) || rfcMessageId || graphId;

  const base = {
    folder: ftype, from_address: fromAddr, from_name: fromName,
    subject: env.subject ?? null, preview: null as string | null,
    is_read: isRead, importance: null as string | null, received_at: received
  };
  const c = classify(base as any);

  // Header-basierte Signale (Massenmail/Unsubscribe) + mehrdimensionale
  // Klassifizierung (Labels, Typ, Handlungsbedarf, Relevanz, Zusammenfassung).
  const headers = parseHeaders(msg.headers);
  const t = detectType({ headers, from_address: fromAddr, subject: env.subject, folder: ftype });
  const cls = classifyMessage({
    from_address: fromAddr, from_name: fromName, reply_to: addrList(env.replyTo),
    subject: env.subject, preview: null,
    is_bulk: t.is_bulk, has_list_unsub: t.has_list_unsub, folder_type: ftype,
    in_thread: !!env.inReplyTo
  });
  // Bucket-Kategorie aus dem Typ ableiten.
  let bucket = "info";
  if (ftype === "sent") bucket = "warten";
  else if (["newsletter", "marketing", "survey_feedback"].includes(cls.message_type)) bucket = "newsletter";
  else if (cls.needs_reply) bucket = cls.priority === "hoch" || cls.priority === "dringend" ? "sofort" : "heute";
  else bucket = "info";

  const row: any = {
    user_id: acc.user_id,
    account_id: null,
    mail_account_id: acc.id,
    account_display_name: (acc as any).display_name || acc.email,
    graph_id: graphId,
    message_id: rfcMessageId,
    in_reply_to: env.inReplyTo || null,
    message_refs: references,
    thread_id: threadId,
    conversation_id: threadId,
    internet_message_id: rfcMessageId,
    folder: ftype,
    folder_type: ftype,
    original_folder_name: mailbox,
    from_name: fromName, from_address: fromAddr,
    to_recipients: addrList(env.to) || null,
    cc_addresses: addrList(env.cc) || null,
    bcc_addresses: addrList(env.bcc) || null,
    reply_to_addresses: addrList(env.replyTo) || null,
    subject: env.subject ?? null, preview: null,
    received_at: received,
    sent_at: ftype === "sent" ? received : null,
    is_read: ftype === "sent" ? true : isRead,
    is_flagged: isFlagged,
    has_attachments: hasAttachments(msg.bodyStructure),
    importance: null,
    needs_reply: cls.needs_reply,
    message_type: cls.message_type,
    is_bulk: t.is_bulk,
    has_list_unsub: t.has_list_unsub,
    action_status: cls.action_status,
    priority: cls.priority,
    relevance: cls.relevance,
    summary: cls.summary,
    classified_at: new Date().toISOString(),
    classification_source: "auto",
    deadline_at: c.deadline_at,
    detected_task: c.detected_task,
    category: bucket,
    labels: cls.labels,
    status: c.status,
    web_link: `imap-uid:${msg.uid}`,
    last_modified_at: null,
    last_synced_at: new Date().toISOString(),
    hidden: c.hidden,
    is_deleted: false
  };

  // Nutzerregeln anwenden (Absender/Domain immer Label/Kategorie, nie antwortpflichtig …).
  if (ftype !== "sent" && rules.length) {
    const rr = applyRules(rules, { from_address: fromAddr, mail_account_id: acc.id });
    if (rr.matched) {
      if (rr.label) row.labels = Array.from(new Set([...(row.labels || []), rr.label]));
      if (rr.category) row.semantic_category = rr.category;
      if (rr.hidden) row.hidden = true;
      if (rr.needs_reply === false) { row.needs_reply = false; row.action_status = "no_action"; }
      if (rr.needs_reply === true) { row.needs_reply = true; row.action_status = "reply_required"; }
      row.classification_source = "rule";
    }
  }

  const { error } = await admin.from("messages").upsert(row, { onConflict: "user_id,graph_id" });
  if (error) throw new Error("Nachricht konnte nicht gespeichert werden.");
}

// KI-Kategorien + Regeln für neue Posteingangs-Nachrichten (gedeckelt).
async function classifyNew(acc: MailAccount): Promise<void> {
  const admin = supabaseAdmin();
  const rules = await loadRules(acc.user_id);

  const { data: pending, error: pendingError } = await admin
    .from("messages")
    .select("id,from_name,from_address,to_recipients,subject,preview,mail_account_id,has_attachments,user_category_override")
    .eq("user_id", acc.user_id)
    .eq("mail_account_id", acc.id)
    .eq("folder_type", "inbox")
    .is("semantic_category", null)
    .order("received_at", { ascending: false })
    .limit(CLASSIFY_CAP);
  if (pendingError) throw new Error("Zu klassifizierende Nachrichten konnten nicht geladen werden.");

  for (const m of pending || []) {
    // 1) Nutzerregeln zuerst (Vorrang).
    const r = applyRules(rules, m);
    if (r.matched) {
      const { error } = await admin.from("messages").update({
        semantic_category: r.category || "Sonstiges",
        classification_source: "rule",
        classification_confidence: 1,
        hidden: r.hidden || undefined
      }).eq("id", m.id).eq("user_id", acc.user_id);
      if (error) throw new Error("Regel-Klassifizierung konnte nicht gespeichert werden.");
      continue;
    }
    // 2) Nutzer hat manuell überschrieben → übernehmen.
    if (m.user_category_override) {
      const { error } = await admin.from("messages").update({
        semantic_category: m.user_category_override, classification_source: "user", classification_confidence: 1
      }).eq("id", m.id).eq("user_id", acc.user_id);
      if (error) throw new Error("Nutzer-Klassifizierung konnte nicht gespeichert werden.");
      continue;
    }
    // 3) KI-Klassifizierung.
    try {
      const res = await classifyEmail({
        from_name: m.from_name, from_address: m.from_address, to: m.to_recipients,
        subject: m.subject, body: m.preview, accountLabel: (acc as any).display_name || acc.email
      });
      // Nur die INHALTS-Kategorie von der KI; Antwortbedarf/Priorität bleiben
      // header-basiert (verhindert, dass Umfragen als antwortpflichtig gelten).
      const { error } = await admin.from("messages").update({
        semantic_category: res.category,
        classification_confidence: res.confidence,
        classification_source: "ai"
      }).eq("id", m.id).eq("user_id", acc.user_id);
      if (error) throw new Error("KI-Klassifizierung konnte nicht gespeichert werden.");
    } catch (e) {
      console.error("classifyEmail:", (e as Error).message);
    }
  }
}
