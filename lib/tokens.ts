import { decrypt, encrypt } from "./crypto";
import { refreshTokens } from "./oauth";
import { supabaseAdmin } from "./supabaseAdmin";

export interface MsAccount {
  id: string;
  user_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  status: string;
}

// Liefert ein gültiges Access-Token. Erneuert bei Bedarf via Refresh-Token
// und speichert die neuen (verschlüsselten) Tokens. Setzt bei invalid_grant
// den Kontostatus auf needs_reauth.
export async function getValidAccessToken(account: MsAccount): Promise<string> {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token_enc && exp - now > 60_000) {
    return decrypt(account.access_token_enc);
  }
  if (!account.refresh_token_enc) {
    await markReauth(account.id);
    throw new Error("Kein Refresh-Token vorhanden – erneute Anmeldung nötig.");
  }
  try {
    const refreshToken = decrypt(account.refresh_token_enc);
    const t = await refreshTokens(refreshToken);
    const newExpiry = new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString();
    await supabaseAdmin()
      .from("ms_accounts")
      .update({
        access_token_enc: encrypt(t.access_token),
        // Microsoft rotiert Refresh-Tokens: neues speichern, sonst altes behalten.
        refresh_token_enc: t.refresh_token ? encrypt(t.refresh_token) : account.refresh_token_enc,
        token_expires_at: newExpiry,
        status: "connected",
        updated_at: new Date().toISOString()
      })
      .eq("id", account.id);
    return t.access_token;
  } catch (e: any) {
    if (e?.oauthError === "invalid_grant" || e?.oauthError === "interaction_required") {
      await markReauth(account.id);
    }
    throw e;
  }
}

async function markReauth(accountId: string) {
  await supabaseAdmin()
    .from("ms_accounts")
    .update({ status: "needs_reauth", updated_at: new Date().toISOString() })
    .eq("id", accountId);
}
