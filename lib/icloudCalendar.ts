import { decrypt } from "./crypto";
import type { CalendarEvent } from "./googleCalendar";

// iCloud-Kalender über CalDAV (nur Lesen). Ablauf:
//   1) current-user-principal ermitteln
//   2) calendar-home-set des Principals holen
//   3) Kalender (VEVENT) im Home auflisten (mit Name + Farbe)
//   4) je Kalender calendar-query REPORT mit <expand> → wiederkehrende Termine
//      kommen bereits als Einzelinstanzen in UTC zurück (keine RRULE/Zeitzonen-
//      Auflösung nötig).
// Das app-spezifische Passwort liegt verschlüsselt in public.icloud_accounts.

const ROOT = "https://caldav.icloud.com";
const UA = "Cockpit/1.0 (CalDAV; nur Lesen)";
const NS_D = 'xmlns:d="DAV:"';
const NS_C = 'xmlns:c="urn:ietf:params:xml:ns:caldav"';
const NS_A = 'xmlns:a="http://apple.com/ns/ical/"';

export interface IcloudAccount {
  id: string;
  user_id: string;
  apple_id: string;
  app_password_enc: string;
  calendar_home_url: string | null;
  status: string;
}

function authHeader(appleId: string, appPassword: string): string {
  return "Basic " + Buffer.from(`${appleId}:${appPassword}`).toString("base64");
}

// ---- HTTP-Helfer (CalDAV nutzt PROPFIND/REPORT) ---------------------------

async function davRequest(
  url: string,
  method: "PROPFIND" | "REPORT",
  auth: string,
  depth: "0" | "1",
  body: string
): Promise<string> {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: auth,
      depth,
      "content-type": "application/xml; charset=utf-8",
      "user-agent": UA
    },
    body,
    cache: "no-store"
  });
  if (res.status === 401) throw new IcloudAuthError("Apple-ID oder app-spezifisches Passwort ist ungültig.");
  if (res.status !== 207 && res.status !== 200) {
    const t = await res.text().catch(() => "");
    throw new Error(`CalDAV ${method} ${res.status}: ${t.slice(0, 180)}`);
  }
  return res.text();
}

export class IcloudAuthError extends Error {}

// ---- XML-Extraktion (bewusst tolerant ggü. Namensraum-Präfixen) -----------

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// Ersten <href> innerhalb des Elements, dessen Name `contains` enthält.
function hrefInside(xml: string, contains: string): string | null {
  const block = new RegExp(
    `<[^>]*${contains}[^>]*>([\\s\\S]*?)</[^>]*${contains}[^>]*>`,
    "i"
  ).exec(xml);
  const scope = block ? block[1] : xml;
  const href = /<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i.exec(scope);
  return href ? decodeEntities(href[1].trim()) : null;
}

// Ein Multistatus-Dokument in einzelne <response>-Blöcke zerlegen.
function responses(xml: string): string[] {
  return (xml.match(/<[^>]*response[^>]*>[\s\S]*?<\/[^>]*response[^>]*>/gi) || []);
}

function tagText(xml: string, tag: string): string | null {
  const m = new RegExp(`<[^>]*${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*${tag}[^>]*>`, "i").exec(xml);
  return m ? decodeEntities(m[1].trim()) : null;
}

// ---- Discovery ------------------------------------------------------------

async function discoverHome(appleId: string, appPassword: string): Promise<string> {
  const auth = authHeader(appleId, appPassword);

  const principalXml = await davRequest(
    ROOT + "/",
    "PROPFIND",
    auth,
    "0",
    `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS_D}><d:prop><d:current-user-principal/></d:prop></d:propfind>`
  );
  const principalHref = hrefInside(principalXml, "current-user-principal");
  if (!principalHref) throw new Error("CalDAV: Principal-URL nicht gefunden.");
  const principalUrl = new URL(principalHref, ROOT).toString();

  const homeXml = await davRequest(
    principalUrl,
    "PROPFIND",
    auth,
    "0",
    `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS_D} ${NS_C}><d:prop><c:calendar-home-set/></d:prop></d:propfind>`
  );
  const homeHref = hrefInside(homeXml, "calendar-home-set");
  if (!homeHref) throw new Error("CalDAV: Kalender-Home nicht gefunden.");
  return new URL(homeHref, principalUrl).toString();
}

interface CalCollection {
  url: string;
  name: string;
  color: string;
}

async function listCalendars(homeUrl: string, auth: string): Promise<CalCollection[]> {
  const xml = await davRequest(
    homeUrl,
    "PROPFIND",
    auth,
    "1",
    `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS_D} ${NS_C} ${NS_A}><d:prop>` +
      `<d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/>` +
      `</d:prop></d:propfind>`
  );
  const out: CalCollection[] = [];
  for (const r of responses(xml)) {
    // Nur echte Kalender-Collections …
    if (!/<[^>]*resourcetype[^>]*>[\s\S]*?calendar[\s\S]*?<\/[^>]*resourcetype[^>]*>/i.test(r)) continue;
    // … die VEVENT unterstützen (Reminders-Listen sind VTODO und entfallen hier).
    const comps = /<[^>]*supported-calendar-component-set[^>]*>([\s\S]*?)<\/[^>]*supported-calendar-component-set[^>]*>/i.exec(r);
    if (comps && !/name="VEVENT"/i.test(comps[1])) continue;
    const href = /<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i.exec(r);
    if (!href) continue;
    const url = new URL(decodeEntities(href[1].trim()), homeUrl).toString();
    if (url.replace(/\/$/, "") === homeUrl.replace(/\/$/, "")) continue; // Home selbst überspringen
    const name = tagText(r, "displayname") || "iCloud";
    const rawColor = tagText(r, "calendar-color") || "#e8863c";
    out.push({ url, name, color: normalizeColor(rawColor) });
  }
  return out;
}

// Apple liefert Farben teils als #RRGGBBAA (8-stellig) → auf #RRGGBB kürzen.
export function normalizeColor(c: string): string {
  const h = c.trim();
  if (/^#[0-9a-f]{8}$/i.test(h)) return h.slice(0, 7);
  if (/^#[0-9a-f]{6}$/i.test(h)) return h;
  if (/^#[0-9a-f]{3}$/i.test(h)) return h;
  return "#e8863c";
}

// Guten Kontrast-Text (schwarz/weiß) zu einer Hex-Hintergrundfarbe wählen.
export function readableText(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? "#1a1a1a" : "#ffffff";
}

// ---- ICS-Parsing (erwartet dank <expand> UTC-Einzelinstanzen) -------------

// CalDAV-Zeitstempel: YYYYMMDDTHHMMSSZ  bzw. Datum: YYYYMMDD
function toIso(value: string, isDate: boolean): string | null {
  if (isDate || /^\d{8}$/.test(value)) {
    if (!/^\d{8}$/.test(value)) return null;
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) return null;
  const base = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  // Mit Z: echte UTC-Zeit. Ohne Z (Fallback, sollte bei expand nicht auftreten):
  // als lokale Wandzeit interpretieren.
  return m[7] ? new Date(base + "Z").toISOString() : base;
}

interface ParsedEvent {
  uid: string; summary: string; location: string | null;
  start: string; end: string | null; allDay: boolean;
}

// Öffentlich für Unit-Tests: parst ein (bereits entfaltetes) iCalendar-Dokument.
export function parseIcsEvents(ics: string): ParsedEvent[] {
  // Zeilenfortsetzungen (RFC 5545 folding) zusammenführen.
  const text = ics.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const events: ParsedEvent[] = [];
  const blocks = text.split(/BEGIN:VEVENT/).slice(1);
  for (const raw of blocks) {
    const body = raw.split(/END:VEVENT/)[0];
    let uid = "", summary = "(ohne Titel)", location: string | null = null;
    let start: string | null = null, end: string | null = null, allDay = false;
    for (const line of body.split("\n")) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const left = line.slice(0, idx);
      const value = line.slice(idx + 1).trim();
      const name = left.split(";")[0].toUpperCase();
      const isDate = /VALUE=DATE(?!-)/i.test(left);
      if (name === "UID") uid = value;
      else if (name === "SUMMARY") summary = unescapeText(value) || "(ohne Titel)";
      else if (name === "LOCATION") location = unescapeText(value) || null;
      else if (name === "DTSTART") { start = toIso(value, isDate); if (isDate) allDay = true; }
      else if (name === "DTEND") { end = toIso(value, isDate); }
    }
    if (start) events.push({ uid: uid || start, summary, location, start, end, allDay });
  }
  return events;
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function calDavStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function fetchCalendarEvents(
  cal: CalCollection,
  auth: string,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const start = calDavStamp(timeMin), end = calDavStamp(timeMax);
  const body =
    `<?xml version="1.0" encoding="utf-8"?><c:calendar-query ${NS_D} ${NS_C}>` +
    `<d:prop><c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
    `<c:time-range start="${start}" end="${end}"/>` +
    `</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const xml = await davRequest(cal.url, "REPORT", auth, "1", body);

  const text = readableText(cal.color);
  const out: CalendarEvent[] = [];
  const datas = xml.match(/<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/gi) || [];
  for (const d of datas) {
    const inner = /<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/i.exec(d);
    if (!inner) continue;
    for (const ev of parseIcsEvents(decodeEntities(inner[1]))) {
      out.push({
        id: `icloud:${ev.uid}:${ev.start}`,
        title: ev.summary,
        start: ev.start,
        end: ev.end,
        allDay: ev.allDay,
        location: ev.location,
        calendar: cal.name,
        color: cal.color,
        textColor: text,
        htmlLink: null
      });
    }
  }
  return out;
}

// ---- Öffentliche API ------------------------------------------------------

// Zugangsdaten prüfen und Kalender-Home ermitteln (für den Verbinden-Flow).
export async function verifyIcloud(appleId: string, appPassword: string): Promise<{ home: string; calendars: number }> {
  const home = await discoverHome(appleId, appPassword);
  const cals = await listCalendars(home, authHeader(appleId, appPassword));
  return { home, calendars: cals.length };
}

// Termine im Zeitfenster [timeMin, timeMax) über alle VEVENT-Kalender holen.
export async function fetchIcloudEvents(
  account: IcloudAccount,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const appPassword = decrypt(account.app_password_enc);
  const auth = authHeader(account.apple_id, appPassword);
  const home = account.calendar_home_url || (await discoverHome(account.apple_id, appPassword));
  const cals = await listCalendars(home, auth);
  const chunks = await Promise.all(
    cals.map((c) => fetchCalendarEvents(c, auth, timeMin, timeMax).catch(() => [] as CalendarEvent[]))
  );
  const all = chunks.flat();
  all.sort((a, b) => a.start.localeCompare(b.start));
  return all;
}
