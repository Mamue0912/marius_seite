import { env } from "./env";
import { decrypt, encrypt } from "./crypto";
import { supabaseAdmin } from "./supabaseAdmin";

// Google OAuth 2.0 (Authorization Code + PKCE) und Calendar-API (nur Lesen).
// Tokens werden verschlüsselt in public.google_accounts gespeichert.

function redirectUri(): string {
  return env.appBaseUrl() + env.google.redirectPath();
}

export function buildGoogleAuthUrl(state: string, codeChallenge: string): string {
  const p = new URLSearchParams({
    client_id: env.google.clientId(),
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: env.google.scopes(),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    // offline + consent → wir erhalten einen Refresh-Token (auch bei Re-Auth).
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.google.clientId(),
      client_secret: env.google.clientSecret(),
      ...body
    }).toString()
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(`Google-OAuth-Fehler: ${json.error || res.status}`) as Error & { oauthError?: string };
    err.oauthError = json.error;
    throw err;
  }
  return json as GoogleTokenResponse;
}

export function exchangeGoogleCode(code: string, codeVerifier: string): Promise<GoogleTokenResponse> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: codeVerifier
  });
}

export function refreshGoogleTokens(refreshToken: string): Promise<GoogleTokenResponse> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

// Minimale Profil-Infos aus dem id_token (JWT) lesen – ohne Signaturprüfung,
// wir vertrauen dem gerade selbst abgeholten Token vom Google-Token-Endpoint.
export function decodeIdToken(idToken?: string): { sub?: string; email?: string; name?: string } {
  if (!idToken) return {};
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return { sub: json.sub, email: json.email, name: json.name };
  } catch {
    return {};
  }
}

export interface GoogleAccount {
  id: string;
  user_id: string;
  email: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  status: string;
}

// Gültiges Access-Token liefern; bei Bedarf per Refresh-Token erneuern und
// die neuen (verschlüsselten) Tokens speichern.
export async function getValidGoogleToken(account: GoogleAccount): Promise<string> {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token_enc && exp - now > 60_000) return decrypt(account.access_token_enc);
  if (!account.refresh_token_enc) {
    await markGoogleReauth(account.id);
    throw new Error("Kein Google-Refresh-Token vorhanden – erneute Anmeldung nötig.");
  }
  try {
    const t = await refreshGoogleTokens(decrypt(account.refresh_token_enc));
    const newExpiry = new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString();
    await supabaseAdmin().from("google_accounts").update({
      access_token_enc: encrypt(t.access_token),
      // Google gibt beim Refresh i. d. R. keinen neuen Refresh-Token zurück.
      refresh_token_enc: t.refresh_token ? encrypt(t.refresh_token) : account.refresh_token_enc,
      token_expires_at: newExpiry,
      status: "connected",
      updated_at: new Date().toISOString()
    }).eq("id", account.id);
    return t.access_token;
  } catch (e: any) {
    if (e?.oauthError === "invalid_grant") await markGoogleReauth(account.id);
    throw e;
  }
}

async function markGoogleReauth(accountId: string) {
  await supabaseAdmin().from("google_accounts")
    .update({ status: "needs_reauth", updated_at: new Date().toISOString() })
    .eq("id", accountId);
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;      // ISO (dateTime) oder YYYY-MM-DD (all-day)
  end: string | null;
  allDay: boolean;
  location: string | null;
  calendar: string;   // Kalendername zur Herkunft
  color: string;      // Hintergrundfarbe (Hex) – wie im Google-Kalender
  textColor: string;  // gut lesbare Textfarbe (Hex)
  htmlLink: string | null;
  // Serientermin: gehoert in den Kalender, aber nicht in Aufgaben & Fristen.
  recurring?: boolean;
  // Einzelne Instanz einer Serie (im Gegensatz zum Serien-Master).
  recurrenceInstance?: boolean;
  description?: string | null;
  source?: "google" | "icloud";
  taskId?: string | null;
}

// Guten Kontrast-Text (schwarz/weiß) zu einer Hex-Hintergrundfarbe wählen.
function readableText(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  // relative Helligkeit (YIQ)
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? "#1a1a1a" : "#ffffff";
}

// Termine über alle sichtbaren Kalender im Zeitfenster [timeMin, timeMax) holen –
// inkl. der echten Google-Farben (Ereignis-colorId bzw. Kalenderfarbe).
export async function fetchGoogleEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const headers = { authorization: `Bearer ${accessToken}` };

  // Kalenderliste + globale Farbpalette parallel holen.
  const [listRes, colorsRes] = await Promise.all([
    fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader", { headers }),
    fetch("https://www.googleapis.com/calendar/v3/colors", { headers })
  ]);
  if (!listRes.ok) throw new Error(`Kalenderliste fehlgeschlagen (${listRes.status}).`);
  const list = await listRes.json();
  const colors = colorsRes.ok ? await colorsRes.json() : { event: {}, calendar: {} };
  const eventColors: Record<string, { background: string }> = colors.event || {};
  const calendars: any[] = (list.items || []).filter((c: any) => c.selected !== false);

  const all: CalendarEvent[] = [];
  await Promise.all(calendars.map(async (cal: any) => {
    const calColor: string = cal.backgroundColor || "#5E5CE6";
    const p = new URLSearchParams({
      timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250"
    });
    const evRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${p.toString()}`,
      { headers }
    );
    if (!evRes.ok) return; // einzelnen Kalender überspringen statt alles zu kippen
    const data = await evRes.json();
    for (const ev of data.items || []) {
      if (ev.status === "cancelled") continue;
      const allDay = !!ev.start?.date;
      // Ereignis-eigene Farbe (colorId) hat Vorrang, sonst Kalenderfarbe.
      const color = (ev.colorId && eventColors[ev.colorId]?.background) || calColor;
      all.push({
        id: ev.id,
        title: ev.summary || "(ohne Titel)",
        start: ev.start?.dateTime || ev.start?.date,
        end: ev.end?.dateTime || ev.end?.date || null,
        allDay,
        location: ev.location || null,
        calendar: cal.summaryOverride || cal.summary || "Kalender",
        color,
        textColor: readableText(color),
        htmlLink: ev.htmlLink || null,
        description: ev.description || null,
        source: "google"
      });
    }
  }));
  all.sort((a, b) => a.start.localeCompare(b.start));
  return all;
}
