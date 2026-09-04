import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeGoogleCode, decodeIdToken } from "@/lib/googleCalendar";
import { encrypt, timingSafeEqual } from "@/lib/crypto";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(status: string, reason?: string): URL {
  const u = new URL("/calendar", process.env.APP_BASE_URL);
  u.searchParams.set("google", status);
  if (reason) u.searchParams.set("reason", reason.slice(0, 300));
  return u;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthErr = url.searchParams.get("error");
  if (oauthErr) return NextResponse.redirect(back("error", url.searchParams.get("error_description") || oauthErr));
  if (!code || !state) return NextResponse.redirect(back("error"));

  const cookieStore = await cookies();
  const raw = cookieStore.get("g_oauth")?.value;
  cookieStore.delete("g_oauth");
  if (!raw) return NextResponse.redirect(back("state"));

  let stored: { state: string; verifier: string; uid: string };
  try { stored = JSON.parse(raw); } catch { return NextResponse.redirect(back("state")); }
  if (!timingSafeEqual(stored.state, state)) return NextResponse.redirect(back("state"));

  const user = await requireUser();
  if (!user || user.id !== stored.uid) return NextResponse.redirect(back("session"));

  try {
    const tok = await exchangeGoogleCode(code, stored.verifier);
    const profile = decodeIdToken(tok.id_token);
    const sub = profile.sub || profile.email || user.id;
    const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();

    await supabaseAdmin().from("google_accounts").upsert({
      user_id: user.id,
      google_sub: sub,
      email: profile.email || null,
      display_name: profile.name || null,
      access_token_enc: encrypt(tok.access_token),
      refresh_token_enc: tok.refresh_token ? encrypt(tok.refresh_token) : null,
      token_expires_at: expiresAt,
      scopes: tok.scope,
      status: "connected",
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id,google_sub" });

    return NextResponse.redirect(back("connected"));
  } catch (e) {
    const msg = (e as Error).message || "unknown";
    console.error("Google OAuth callback failed:", msg);
    return NextResponse.redirect(back("error", msg));
  }
}
