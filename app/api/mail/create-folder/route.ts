import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccount, MailAccount, accountPassword } from "@/lib/mailAccounts";
import { folderType } from "@/lib/folders";
import { friendlyMailError } from "@/lib/mailErrors";
import { resolvePublicNetworkEndpoint } from "@/lib/safeRemote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Erstellt einen ECHTEN IMAP-Ordner auf dem Server (z. B. „Archiv" bei WEB.DE).
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { account, name } = await req.json().catch(() => ({}));
  const folderName = String(name || "").trim();
  if (!account || !folderName) return NextResponse.json({ error: "bad_request", message: "Kein Ordnername." }, { status: 400 });
  if (folderName.length > 60 || /[\r\n\t]/.test(folderName)) return NextResponse.json({ error: "bad_name", message: "Ungültiger Ordnername." }, { status: 400 });

  const acc = await loadMailAccount(account);
  if (!acc || (acc as any).user_id !== user.id) return NextResponse.json({ error: "no_account" }, { status: 403 });
  const a = acc as MailAccount;

  let endpoint;
  try {
    endpoint = await resolvePublicNetworkEndpoint(a.imap_host);
  } catch {
    return NextResponse.json({ error: "invalid_host", message: "Die Mailserver-Adresse ist nicht zulässig oder nicht erreichbar." }, { status: 400 });
  }
  const client = new ImapFlow({
    host: endpoint.address, servername: endpoint.servername, port: a.imap_port, secure: (a as any).imap_secure !== false,
    auth: { user: a.username, pass: accountPassword(a) }, logger: false, socketTimeout: 30_000
  });
  try {
    await client.connect();
    // Existiert schon?
    const list = await client.list();
    const exists = list.find((b) => b.path.toLowerCase() === folderName.toLowerCase() || b.path.split(/[/.]/).pop()?.toLowerCase() === folderName.toLowerCase());
    let path: string = exists?.path || "";
    if (!path) {
      const created: any = await client.mailboxCreate(folderName);
      path = created?.path || folderName;
    }
    // In die Cockpit-Ordnerliste aufnehmen (Typ automatisch bestimmt).
    const ftype = folderType(path, null);
    const { error: storageError } = await supabaseAdmin().from("mail_folders").upsert({
      user_id: user.id, account_id: a.id, path, folder_type: ftype, unread: 0, total: 0, updated_at: new Date().toISOString()
    }, { onConflict: "account_id,path" });
    return NextResponse.json({
      ok: true,
      path,
      folder_type: ftype,
      existed: !!exists,
      warning: storageError ? "Der Ordner wurde auf dem Mailserver erstellt, konnte aber noch nicht in der lokalen Ordnerliste gespeichert werden." : undefined
    });
  } catch (e) {
    return NextResponse.json({ error: "create_failed", message: friendlyMailError(e as Error) }, { status: 502 });
  } finally {
    await client.logout().catch(() => {});
  }
}
