import { hmac } from "./crypto";
import { env, Folder, FOLDERS } from "./env";
import { graphDelete, graphPatch, graphPost } from "./graph";
import { supabaseAdmin } from "./supabaseAdmin";
import { getValidAccessToken, MsAccount } from "./tokens";

// Graph-Nachrichten-Abos: max. Laufzeit ~4230 Minuten. Wir setzen etwas
// darunter und verlängern per Cron deutlich vor Ablauf.
const EXPIRATION_MINUTES = 4000;

function resourceFor(folder: Folder): string {
  return `/me/mailFolders('${folder}')/messages`;
}
function clientStateFor(accountId: string, folder: Folder): string {
  // Pro Konto/Ordner abgeleitet – wird bei jedem Webhook geprüft.
  return hmac(env.graphClientState(), `${accountId}:${folder}`);
}
function expiry(): string {
  return new Date(Date.now() + EXPIRATION_MINUTES * 60_000).toISOString();
}
function notificationUrl(): string {
  return env.appBaseUrl() + "/api/webhooks/microsoft-graph";
}

// Stellt sicher, dass für alle relevanten Ordner ein aktives Abo existiert.
export async function ensureSubscriptions(account: MsAccount): Promise<void> {
  const admin = supabaseAdmin();
  const accessToken = await getValidAccessToken(account);

  for (const folder of FOLDERS) {
    const { data: existing } = await admin
      .from("graph_subscriptions")
      .select("*")
      .eq("account_id", account.id)
      .eq("folder", folder)
      .eq("status", "active")
      .maybeSingle();

    if (existing && new Date(existing.expires_at).getTime() - Date.now() > 60 * 60_000) {
      continue; // noch > 1h gültig
    }
    if (existing) {
      // vorhandenes, bald ablaufendes Abo verlängern
      try {
        await renewSubscription(accessToken, existing.subscription_id);
        await admin
          .from("graph_subscriptions")
          .update({ expires_at: expiry(), last_renewed_at: new Date().toISOString() })
          .eq("id", existing.id);
        continue;
      } catch {
        // Verlängerung fehlgeschlagen → neu erstellen
        await admin.from("graph_subscriptions").update({ status: "expired" }).eq("id", existing.id);
      }
    }
    await createSubscription(account, folder, accessToken);
  }
}

async function createSubscription(account: MsAccount, folder: Folder, accessToken: string): Promise<void> {
  const clientState = clientStateFor(account.id, folder);
  const sub: any = await graphPost(accessToken, "/subscriptions", {
    changeType: "created,updated,deleted",
    notificationUrl: notificationUrl(),
    lifecycleNotificationUrl: notificationUrl(),
    resource: resourceFor(folder),
    expirationDateTime: expiry(),
    clientState
  });
  await supabaseAdmin().from("graph_subscriptions").insert({
    user_id: account.user_id,
    account_id: account.id,
    subscription_id: sub.id,
    resource: resourceFor(folder),
    folder,
    client_state: clientState,
    expires_at: sub.expirationDateTime || expiry(),
    last_renewed_at: new Date().toISOString(),
    status: "active"
  });
}

async function renewSubscription(accessToken: string, subscriptionId: string): Promise<void> {
  await graphPatch(accessToken, `/subscriptions/${subscriptionId}`, { expirationDateTime: expiry() });
}

// Von Cron genutzt: alle bald ablaufenden Abos verlängern, verlorene neu anlegen.
export async function renewAllExpiring(): Promise<{ renewed: number; recreated: number }> {
  const admin = supabaseAdmin();
  // Fenster von 30 Stunden: Auf dem Hobby-Plan läuft der Cron nur EINMAL täglich.
  // Abos leben ~66 h (EXPIRATION_MINUTES). Mit 30-h-Vorlauf erneuert der tägliche
  // Lauf jedes Abo rechtzeitig (immer > 1 Tag Puffer bis zum Ablauf).
  const soon = new Date(Date.now() + 30 * 60 * 60_000).toISOString();
  const { data: subs } = await admin
    .from("graph_subscriptions")
    .select("*")
    .eq("status", "active")
    .lt("expires_at", soon);

  let renewed = 0;
  let recreated = 0;
  for (const s of subs || []) {
    const account = await loadAccount(s.account_id);
    if (!account) continue;
    try {
      const token = await getValidAccessToken(account);
      await renewSubscription(token, s.subscription_id);
      await admin
        .from("graph_subscriptions")
        .update({ expires_at: expiry(), last_renewed_at: new Date().toISOString() })
        .eq("id", s.id);
      renewed++;
    } catch {
      await admin.from("graph_subscriptions").update({ status: "expired" }).eq("id", s.id);
      try {
        await ensureSubscriptions(account);
        recreated++;
      } catch {
        /* im nächsten Lauf erneut versuchen */
      }
    }
  }
  return { renewed, recreated };
}

export async function deleteSubscriptions(account: MsAccount): Promise<void> {
  const admin = supabaseAdmin();
  const { data: subs } = await admin.from("graph_subscriptions").select("*").eq("account_id", account.id);
  let token: string | null = null;
  try {
    token = await getValidAccessToken(account);
  } catch {
    token = null;
  }
  for (const s of subs || []) {
    if (token) {
      try {
        await graphDelete(token, `/subscriptions/${s.subscription_id}`);
      } catch {
        /* egal – Abo läuft ohnehin ab */
      }
    }
    await admin.from("graph_subscriptions").delete().eq("id", s.id);
  }
}

async function loadAccount(accountId: string): Promise<MsAccount | null> {
  const { data } = await supabaseAdmin().from("ms_accounts").select("*").eq("id", accountId).maybeSingle();
  return (data as MsAccount) || null;
}

export { clientStateFor };
