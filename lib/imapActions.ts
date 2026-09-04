import { ImapFlow } from "imapflow";
import { MailAccount, accountPassword } from "./mailAccounts";
import { folderType, FolderType } from "./folders";

function client(acc: MailAccount): ImapFlow {
  return new ImapFlow({
    host: acc.imap_host, port: acc.imap_port, secure: (acc as any).imap_secure !== false,
    auth: { user: acc.username, pass: accountPassword(acc) }, logger: false, socketTimeout: 30_000
  });
}

async function findPath(c: ImapFlow, type: FolderType): Promise<string | null> {
  const list = await c.list();
  for (const box of list) {
    const su = Array.isArray((box as any).specialUse) ? (box as any).specialUse.join(" ") : (box as any).specialUse;
    if (folderType(box.path, su) === type) return box.path;
  }
  return null;
}

// Verschiebt/markiert eine Nachricht ECHT über IMAP. Wirft bei Misserfolg,
// damit die UI zurückrollen kann. Gibt den kanonischen Zielordner zurück.
export async function imapAction(acc: MailAccount, sourceMailbox: string, uid: number, action: string): Promise<{ movedTo: FolderType | null; path?: string; uid?: number }> {
  if (!Number.isSafeInteger(uid) || uid <= 0) throw new Error("Ungültige Nachrichten-ID");
  if (action === "trash") action = "delete";
  const c = client(acc);
  await c.connect();
  try {
    const lock = await c.getMailboxLock(sourceMailbox || "INBOX");
    try {
      if (action === "read") { if (!await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true })) throw new Error("Gelesen-Status nicht bestätigt"); return { movedTo: null }; }
      if (action === "unread") { if (!await c.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true })) throw new Error("Gelesen-Status nicht bestätigt"); return { movedTo: null }; }

      // Zurück in den Posteingang (Entarchivieren / „Kein Spam").
      if (action === "inbox") { const moved = await c.messageMove(String(uid), "INBOX", { uid: true }); if (!moved) throw new Error("Verschieben nicht bestätigt"); return { movedTo: "inbox", path: "INBOX", uid: moved.uidMap?.get(uid) }; }

      const targetType: FolderType | null = action === "delete" ? "trash" : action === "archive" ? "archive" : action === "spam" ? "spam" : null;
      if (!targetType) throw new Error("unknown action");
      const target = await findPath(c, targetType);
      if (!target) throw new Error(`Zielordner (${targetType}) nicht gefunden`);
      const moved = await c.messageMove(String(uid), target, { uid: true });
      if (!moved) throw new Error("Verschieben nicht bestätigt");
      return { movedTo: targetType, path: target, uid: moved.uidMap?.get(uid) };
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => {});
  }
}
