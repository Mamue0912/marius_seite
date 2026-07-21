import { ImapFlow } from "imapflow";
import { classify } from "./classify";
import { supabaseAdmin } from "./supabaseAdmin";
import { MailAccount, accountPassword } from "./mailAccounts";
import { folderType, FolderType } from "./folders";
import { loadRules, applyRules } from "./rules";
import { classifyEmail } from "./anthropic";
import { detectType } from "./messageType";

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

const SEED_COUNT = 40;       // Erstsync Posteingang
const SENT_SEED = 25;        // Gesendet je Lauf (idempotent per Message-ID)
const CLASSIFY_CAP = 12;     // max. KI-Klassifizierungen pro Lauf

function makeClient(acc: MailAccount): ImapFlow {
  return new ImapFlow({
    host: acc.imap_host,
    port: acc.imap_port,
    secure: (acc as any).imap_secure !== false,
    auth: { user: acc.username, pass: accountPassword(acc) },
    logger: false,
    socketTimeout: 45_000
  });
}

export async function verifyLogin(acc: MailAccount): Promise<void> {
  const client = makeClient(acc);
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

// Hauptsync: Posteingang (inkrementell) + Gesendet (Seed), dann KI-Kategorien.
export async function syncInbox(acc: MailAccount): Promise<number> {
  const admin = supabaseAdmin();
  const client = makeClient(acc);
  let processed = 0;

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
      let maxUid = lastUid;

      if (exists > 0) {
        const range = lastUid > 0 ? `${lastUid + 1}:*` : `${Math.max(1, exists - SEED_COUNT + 1)}:*`;
        const opts = lastUid > 0 ? { uid: true as const } : undefined;
        for await (const msg of client.fetch(range, { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true, headers: HEADER_FIELDS }, opts)) {
          if (lastUid > 0 && Number(msg.uid) <= lastUid) continue;
          await upsertMessage(acc, msg, "inbox", "INBOX");
          processed++;
          if (Number(msg.uid) > maxUid) maxUid = Number(msg.uid);
        }
      }
      await admin.from("mail_accounts").update({
        inbox_uidvalidity: uidValidity, inbox_last_uid: maxUid,
        last_synced_at: new Date().toISOString(), status: "connected", last_error: null
      }).eq("id", acc.id);
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
              await upsertMessage(acc, msg, "sent", sent.path);
              processed++;
            }
          }
        } finally {
          slock.release();
        }
      }
    } catch (e) {
      console.error("Sent-Sync übersprungen:", (e as Error).message);
    }
  } finally {
    await client.logout().catch(() => {});
  }

  // ----- KI-Kategorien + Regeln (getrennt, gedeckelt) -----
  try {
    await classifyNew(acc);
  } catch (e) {
    console.error("Klassifizierung übersprungen:", (e as Error).message);
  }

  return processed;
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

async function upsertMessage(acc: MailAccount, msg: any, ftype: FolderType, mailbox: string): Promise<void> {
  const admin = supabaseAdmin();
  const env = msg.envelope || {};
  const addrList = (arr: any[]) => (arr || []).map((a: any) => a.address).filter(Boolean).join(", ");
  const fromAddr = env.from?.[0]?.address || null;
  const fromName = env.from?.[0]?.name || null;
  const received = msg.internalDate ? new Date(msg.internalDate).toISOString() : env.date ? new Date(env.date).toISOString() : null;
  const flags: Set<string> = msg.flags instanceof Set ? msg.flags : new Set(msg.flags || []);
  const isRead = flags.has("\\Seen");
  const isFlagged = flags.has("\\Flagged");
  const messageId = env.messageId || `imap-${acc.id}-${ftype}-${msg.uid}`;
  const references = Array.isArray(env.references) ? env.references.join(" ") : env.references || null;
  // Thread-ID: erster Bezug (Ursprungsnachricht) oder eigene Message-ID.
  const threadId = env.inReplyTo || (references ? references.split(/\s+/)[0] : null) || messageId;

  const base = {
    folder: ftype, from_address: fromAddr, from_name: fromName,
    subject: env.subject ?? null, preview: null as string | null,
    is_read: isRead, importance: null as string | null, received_at: received
  };
  const c = classify(base as any);

  // Header-basierte Typ-/Antwortbewertung (Massenmail/Umfrage erkennen).
  const headers = parseHeaders(msg.headers);
  const t = detectType({ headers, from_address: fromAddr, subject: env.subject, folder: ftype });
  // Bucket-Kategorie aus dem Typ ableiten.
  let bucket = "info";
  if (ftype === "sent") bucket = "warten";
  else if (t.message_type === "newsletter_marketing" || t.message_type === "survey_feedback" || t.message_type === "automated_bulk") bucket = "newsletter";
  else if (t.needs_reply) bucket = t.priority === "hoch" || t.priority === "dringend" ? "sofort" : "heute";
  else bucket = "info";

  const row: any = {
    user_id: acc.user_id,
    account_id: null,
    mail_account_id: acc.id,
    account_display_name: (acc as any).display_name || acc.email,
    graph_id: messageId,
    message_id: env.messageId || null,
    in_reply_to: env.inReplyTo || null,
    message_refs: references,
    thread_id: threadId,
    conversation_id: threadId,
    internet_message_id: env.messageId || null,
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
    needs_reply: t.needs_reply,
    message_type: t.message_type,
    is_bulk: t.is_bulk,
    has_list_unsub: t.has_list_unsub,
    action_status: t.action_status,
    priority: t.priority,
    deadline_at: c.deadline_at,
    detected_task: c.detected_task,
    category: bucket,
    status: c.status,
    web_link: `imap-uid:${msg.uid}`,
    last_modified_at: null,
    last_synced_at: new Date().toISOString(),
    hidden: c.hidden,
    is_deleted: false
  };

  await admin.from("messages").upsert(row, { onConflict: "user_id,graph_id" });
}

// KI-Kategorien + Regeln für neue Posteingangs-Nachrichten (gedeckelt).
async function classifyNew(acc: MailAccount): Promise<void> {
  const admin = supabaseAdmin();
  const rules = await loadRules(acc.user_id);

  const { data: pending } = await admin
    .from("messages")
    .select("id,from_name,from_address,to_recipients,subject,preview,mail_account_id,has_attachments,user_category_override")
    .eq("user_id", acc.user_id)
    .eq("mail_account_id", acc.id)
    .eq("folder_type", "inbox")
    .is("semantic_category", null)
    .order("received_at", { ascending: false })
    .limit(CLASSIFY_CAP);

  for (const m of pending || []) {
    // 1) Nutzerregeln zuerst (Vorrang).
    const r = applyRules(rules, m);
    if (r.matched) {
      await admin.from("messages").update({
        semantic_category: r.category || "Sonstiges",
        classification_source: "rule",
        classification_confidence: 1,
        hidden: r.hidden || undefined
      }).eq("id", m.id);
      continue;
    }
    // 2) Nutzer hat manuell überschrieben → übernehmen.
    if (m.user_category_override) {
      await admin.from("messages").update({
        semantic_category: m.user_category_override, classification_source: "user", classification_confidence: 1
      }).eq("id", m.id);
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
      await admin.from("messages").update({
        semantic_category: res.category,
        classification_confidence: res.confidence,
        classification_source: "ai"
      }).eq("id", m.id);
    } catch (e) {
      console.error("classifyEmail:", (e as Error).message);
    }
  }
}
