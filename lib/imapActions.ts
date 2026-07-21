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
export async function imapAction(acc: MailAccount, sourceMailbox: string, uid: number, action: string): Promise<{ movedTo: FolderType | null }> {
  const c = client(acc);
  await c.connect();
  try {
    const lock = await c.getMailboxLock(sourceMailbox || "INBOX");
    try {
      if (action === "read") { await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); return { movedTo: null }; }
      if (action === "unread") { await c.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true }); return { movedTo: null }; }

      const targetType: FolderType | null = action === "delete" ? "trash" : action === "archive" ? "archive" : action === "spam" ? "spam" : null;
      if (!targetType) throw new Error("unknown action");
      const target = await findPath(c, targetType);
      if (!target) throw new Error(`Zielordner (${targetType}) nicht gefunden`);
      await c.messageMove(String(uid), target, { uid: true });
      return { movedTo: targetType };
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => {});
  }
}
