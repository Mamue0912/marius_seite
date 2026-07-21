import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAuthUrl } from "@/lib/oauth";
import { pkceChallenge, randomUrlSafe } from "@/lib/crypto";
import { requireUser } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Startet den Microsoft-Login. Nur für angemeldete Cockpit-Nutzer:innen.
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.redirect(new URL("/", process.env.APP_BASE_URL));

  const state = randomUrlSafe(24);
  const verifier = randomUrlSafe(48);
  const challenge = pkceChallenge(verifier);

  // CSRF/State + PKCE-Verifier sicher (httpOnly) im Cookie ablegen.
  cookies().set("ms_oauth", JSON.stringify({ state, verifier, uid: user.id }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600
  });

  return NextResponse.redirect(buildAuthUrl(state, challenge));
}
