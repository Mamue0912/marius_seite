import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode } from "@/lib/oauth";
import { encrypt, timingSafeEqual } from "@/lib/crypto";
import { graphGet } from "@/lib/graph";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ensureSubscriptions } from "@/lib/subscriptions";
import { runDelta } from "@/lib/sync";
import { FOLDERS } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function home(err?: string): URL {
  const u = new URL("/", process.env.APP_BASE_URL);
  if (err) u.searchParams.set("outlook", err);
  return u;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthErr = url.searchParams.get("error");
  if (oauthErr) return NextResponse.redirect(home("error"));
  if (!code || !state) return NextResponse.redirect(home("error"));

  const raw = cookies().get("ms_oauth")?.value;
  cookies().delete("ms_oauth");
  if (!raw) return NextResponse.redirect(home("state"));

  let stored: { state: string; verifier: string; uid: string };
  try {
    stored = JSON.parse(raw);
  } catch {
    return NextResponse.redirect(home("state"));
  }
  // CSRF: State muss exakt übereinstimmen.
  if (!timingSafeEqual(stored.state, state)) return NextResponse.redirect(home("state"));

  const user = await requireUser();
  if (!user || user.id !== stored.uid) return NextResponse.redirect(home("session"));

  try {
    const tok = await exchangeCode(code, stored.verifier);
    const me: any = await graphGet(tok.access_token, "/me");
    const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();

    const { data: account } = await supabaseAdmin()
      .from("ms_accounts")
      .upsert(
        {
          user_id: user.id,
          ms_user_principal: me.userPrincipalName || me.mail || me.id,
          ms_home_account: me.id,
          display_name: me.displayName,
          email: me.mail || me.userPrincipalName,
          access_token_enc: encrypt(tok.access_token),
          refresh_token_enc: tok.refresh_token ? encrypt(tok.refresh_token) : null,
          token_expires_at: expiresAt,
          scopes: tok.scope,
          status: "connected",
          updated_at: new Date().toISOString()
        },
        { onConflict: "user_id,ms_user_principal" }
      )
      .select()
      .single();

    if (account) {
      // Erstsync + Live-Abos. Fehler hier nicht fatal – Cron/Fallback holt nach.
      try {
        for (const f of FOLDERS) await runDelta(account as any, f);
        await ensureSubscriptions(account as any);
      } catch (e) {
        console.error("Initial sync/subscription failed:", (e as Error).message);
      }
    }
    return NextResponse.redirect(home("connected"));
  } catch (e) {
    console.error("OAuth callback failed:", (e as Error).message);
    return NextResponse.redirect(home("error"));
  }
}
