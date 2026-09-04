import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildGoogleAuthUrl } from "@/lib/googleCalendar";
import { pkceChallenge, randomUrlSafe } from "@/lib/crypto";
import { requireUser } from "@/lib/supabaseServer";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Startet die Google-Anmeldung (nur Kalender lesen). Nur für angemeldete Nutzer.
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.redirect(new URL("/", process.env.APP_BASE_URL));
  if (!env.google.configured()) {
    const u = new URL("/calendar", process.env.APP_BASE_URL);
    u.searchParams.set("google", "not_configured");
    return NextResponse.redirect(u);
  }

  const state = randomUrlSafe(24);
  const verifier = randomUrlSafe(48);
  const challenge = pkceChallenge(verifier);

  const cookieStore = await cookies();
  cookieStore.set("g_oauth", JSON.stringify({ state, verifier, uid: user.id }), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600
  });

  return NextResponse.redirect(buildGoogleAuthUrl(state, challenge));
}
