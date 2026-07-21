import { classify } from "./classify";
import { Folder } from "./env";
import { graphGet } from "./graph";
import { supabaseAdmin } from "./supabaseAdmin";
import { getValidAccessToken, MsAccount } from "./tokens";

const SELECT =
  "id,conversationId,internetMessageId,subject,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime,isRead,importance,webLink,lastModifiedDateTime";

function deltaStartUrl(folder: Folder): string {
  return `/me/mailFolders/${folder}/messages/delta?$select=${SELECT}&$top=50`;
}

// Führt eine Delta-Synchronisierung für einen Ordner aus. Verwendet den
// gespeicherten deltaLink (nur Änderungen). Ohne deltaLink = Erstsync.
// Gibt die Anzahl verarbeiteter Nachrichten zurück.
export async function runDelta(account: MsAccount, folder: Folder): Promise<number> {
  const admin = supabaseAdmin();
  const accessToken = await getValidAccessToken(account);

  const { data: st } = await admin
    .from("sync_state")
    .select("delta_link")
    .eq("account_id", account.id)
    .eq("folder", folder)
    .maybeSingle();

  let url = st?.delta_link || deltaStartUrl(folder);
  let processed = 0;
  let deltaLink: string | null = null;

  // Seiten durchlaufen bis @odata.deltaLink kommt.
  for (let guard = 0; guard < 100; guard++) {
    const page: any = await graphGet(accessToken, url);
    const values: any[] = page.value || [];
    for (const m of values) {
      await upsertMessage(account, folder, m);
      processed++;
    }
    if (page["@odata.nextLink"]) {
      url = page["@odata.nextLink"];
      continue;
    }
    deltaLink = page["@odata.deltaLink"] || null;
    break;
  }

  await admin.from("sync_state").upsert(
    {
      user_id: account.user_id,
      account_id: account.id,
      folder,
      delta_link: deltaLink,
      last_delta_at: new Date().toISOString()
    },
    { onConflict: "account_id,folder" }
  );

  return processed;
}

async function upsertMessage(account: MsAccount, folder: Folder, m: any): Promise<void> {
  const admin = supabaseAdmin();

  // Gelöschte/verschobene Nachricht: Graph liefert { id, '@removed': {...} }
  if (m["@removed"]) {
    await admin
      .from("messages")
      .update({ is_deleted: true, last_synced_at: new Date().toISOString() })
      .eq("user_id", account.user_id)
      .eq("graph_id", m.id);
    return;
  }

  const fromAddr = m.from?.emailAddress?.address ?? null;
  const fromName = m.from?.emailAddress?.name ?? null;
  const to = (m.toRecipients || [])
    .map((r: any) => r.emailAddress?.address)
    .filter(Boolean)
    .join(", ");

  const base = {
    folder,
    from_address: fromAddr,
    from_name: fromName,
    subject: m.subject ?? null,
    preview: m.bodyPreview ?? null,
    is_read: m.isRead ?? null,
    importance: m.importance ?? null,
    received_at: m.receivedDateTime ?? null
  };
  const c = classify(base);

  const row = {
    user_id: account.user_id,
    account_id: account.id,
    graph_id: m.id,
    conversation_id: m.conversationId ?? null,
    internet_message_id: m.internetMessageId ?? null,
    folder,
    from_name: fromName,
    from_address: fromAddr,
    to_recipients: to || null,
    subject: m.subject ?? null,
    preview: m.bodyPreview ?? null,
    received_at: m.receivedDateTime ?? null,
    sent_at: m.sentDateTime ?? null,
    is_read: m.isRead ?? null,
    importance: m.importance ?? null,
    needs_reply: c.needs_reply,
    deadline_at: c.deadline_at,
    detected_task: c.detected_task,
    category: c.category,
    status: c.status,
    web_link: m.webLink ?? null,
    last_modified_at: m.lastModifiedDateTime ?? null,
    last_synced_at: new Date().toISOString(),
    hidden: c.hidden,
    is_deleted: false
  };

  // Idempotent über (user_id, graph_id) → keine Duplikate, auch bei
  // mehrfachen Webhook-Benachrichtigungen.
  await admin.from("messages").upsert(row, { onConflict: "user_id,graph_id" });
}
