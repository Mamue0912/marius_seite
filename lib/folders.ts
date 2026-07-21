// Bildet unterschiedliche Anbieter-Ordnernamen auf eine gemeinsame Oberfläche
// ab, ohne die tatsächliche Ordnerstruktur beim Anbieter zu verändern.

export type FolderType = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash" | "other";

export const FOLDER_LABEL: Record<FolderType, string> = {
  inbox: "Posteingang",
  sent: "Gesendet",
  drafts: "Entwürfe",
  archive: "Archiv",
  spam: "Spam",
  trash: "Papierkorb",
  other: "Weitere"
};

// Ordnung für die Anzeige.
export const FOLDER_ORDER: FolderType[] = ["inbox", "sent", "drafts", "archive", "spam", "trash", "other"];

// IMAP-Sonderrollen (RFC 6154 / \Sent, \Junk …) haben Vorrang, sonst per Name.
export function folderType(name: string, specialUse?: string | null): FolderType {
  const su = (specialUse || "").toLowerCase();
  if (su.includes("sent")) return "sent";
  if (su.includes("draft")) return "drafts";
  if (su.includes("junk")) return "spam";
  if (su.includes("trash")) return "trash";
  if (su.includes("archive")) return "archive";

  const n = name.toLowerCase();
  if (n === "inbox") return "inbox";
  if (/(sent|gesendet|gesendete)/.test(n)) return "sent";
  if (/(draft|entw)/.test(n)) return "drafts";
  if (/(junk|spam)/.test(n)) return "spam";
  if (/(trash|deleted|papierkorb|gel[oö]scht)/.test(n)) return "trash";
  if (/(archiv)/.test(n)) return "archive";
  return "other";
}
