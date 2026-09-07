import { createHash } from "crypto";
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
// Schlichter, konventioneller User-Agent. Freitext mit Sonderzeichen kann von
// Schutzmechanismen auf Serverseite abgelehnt werden (403).
const UA = "Cockpit/1.0";
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
  excluded_calendar_keys?: string[] | null;
  last_synced_at?: string | null;
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
  body: string,
  stage = "CalDAV"
): Promise<string> {
  // Apple leitet caldav.icloud.com auf einen Shard-Host (pNN-caldav.icloud.com)
  // um. Beim automatischen Folgen entfernt fetch den Authorization-Header, weil
  // der Zielhost ein anderer ist – Apple antwortet dann mit 401. Deshalb folgen
  // wir der Weiterleitung selbst und senden die Anmeldung erneut mit.
  let target = url;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(target, {
      method,
      headers: {
        authorization: auth,
        depth,
        "content-type": "application/xml; charset=utf-8",
        "user-agent": UA
      },
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(20_000)
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`${stage}: Apple hat weitergeleitet, aber kein Ziel genannt (${res.status}).`);
      target = new URL(location, target).toString();
      continue;
    }
    // 401 und 403 bedeuten Unterschiedliches und führen zu unterschiedlichen
    // Schritten: 401 = Anmeldung abgelehnt (Passwort), 403 = angemeldet, aber
    // Zugriff gesperrt. Deshalb getrennt melden, jeweils mit Stufe und Status.
    if (res.status === 401) {
      throw new IcloudAuthError(
        `${stage}: Apple hat die Anmeldung abgelehnt (401). Bitte ein neues app-spezifisches Passwort erzeugen und die vollständige Apple-ID verwenden.`
      );
    }
    if (res.status === 403) {
      throw new IcloudAuthError(
        `${stage}: Apple hat den Zugriff verweigert (403). Die Anmeldung war gültig, aber der Kalenderzugriff ist gesperrt.`
      );
    }
    if (res.status !== 207 && res.status !== 200) {
      // Bewusst ohne Antwortinhalt: der Status genügt zur Einordnung und es
      // können keine Kontodaten nach außen gelangen.
      throw new Error(`${stage}: Apple antwortete mit Status ${res.status}.`);
    }
    return res.text();
  }
  throw new Error(`${stage}: Zu viele Weiterleitungen von Apple.`);
}

export class IcloudAuthError extends Error {}

// ---- XML-Extraktion (bewusst tolerant ggü. Namensraum-Präfixen) -----------

export function decodeDavEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// Ersten <href> innerhalb des Elements `contains` liefern.
//
// Zwei Fallstricke, die hier bewusst vermieden werden:
//  - Apple schickt im 404-Teil der Antwort leere Platzhalter (<C:calendar-home-set/>).
//    Ein Muster wie <[^>]*name[^>]*> matcht diese mit und fängt dadurch einen
//    viel zu großen Bereich ein. Deshalb werden nur Elemente MIT Inhalt gesucht.
//  - Findet sich das Element nicht, darf NICHT auf das ganze Dokument
//    ausgewichen werden: Sonst gewinnt der <href> des <response>-Elements
//    (die angefragte URL selbst) und wir folgen der falschen Adresse.
export function hrefInside(xml: string, contains: string): string | null {
  const re = new RegExp(
    `<(?:[a-z_][\\w.-]*:)?${contains}\\b[^>]*(?<!/)>([\\s\\S]*?)</(?:[a-z_][\\w.-]*:)?${contains}\\s*>`,
    "gi"
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const href = /<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i.exec(match[1]);
    if (href) {
      const value = decodeDavEntities(href[1].trim());
      if (value) return value;
    }
  }
  return null;
}

// Ein Multistatus-Dokument in einzelne <response>-Blöcke zerlegen.
function responses(xml: string): string[] {
  return (xml.match(/<(?:[a-z_][\w.-]*:)?response\b[^>]*>[\s\S]*?<\/(?:[a-z_][\w.-]*:)?response\s*>/gi) || []);
}

function tagText(xml: string, tag: string): string | null {
  const m = new RegExp(`<[^>]*${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*${tag}[^>]*>`, "i").exec(xml);
  return m ? decodeDavEntities(m[1].trim()) : null;
}

// ---- Discovery ------------------------------------------------------------

async function discoverHome(appleId: string, appPassword: string): Promise<string> {
  const auth = authHeader(appleId, appPassword);

  const principalBody = `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS_D}><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
  // Erst der Serverstamm, sonst der standardisierte Discovery-Pfad.
  const candidates = [ROOT + "/", ROOT + "/.well-known/caldav"];
  let principalHref: string | null = null;
  let principalBase = ROOT;
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      const xml = await davRequest(candidate, "PROPFIND", auth, "0", principalBody, "Anmeldung bei Apple");
      const found = hrefInside(xml, "current-user-principal");
      if (found) { principalHref = found; principalBase = candidate; break; }
      lastError = new Error("Anmeldung bei Apple: Antwort enthielt kein Benutzerkonto (Principal).");
    } catch (error) {
      // Auch 401/403 nicht sofort aufgeben: Apple lehnt den Serverstamm für
      // manche Konten ab, während der Standard-Discovery-Pfad funktioniert.
      // Erst wenn alle Wege scheitern, wird der letzte Fehler gemeldet.
      lastError = error as Error;
    }
  }
  if (!principalHref) {
    throw lastError || new Error("Apple hat kein Benutzerkonto (Principal) zurückgegeben.");
  }
  const principalUrl = new URL(principalHref, principalBase).toString();

  const homeXml = await davRequest(
    principalUrl,
    "PROPFIND",
    auth,
    "0",
    `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS_D} ${NS_C}><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
    "Kalenderliste abrufen"
  );
  const homeHref = hrefInside(homeXml, "calendar-home-set");
  if (!homeHref) throw new Error("Apple hat keinen Kalenderbereich (calendar-home-set) zurückgegeben.");
  const homeUrl = new URL(homeHref, principalUrl).toString();
  // Sicherung: Zeigt das Ergebnis wieder auf den Principal, wurde die falsche
  // Adresse gelesen. Ein Depth-1-PROPFIND darauf beantwortet Apple mit 403 –
  // das wäre als "Zugriff gesperrt" missverständlich.
  if (homeUrl.replace(/\/$/, "") === principalUrl.replace(/\/$/, "")) {
    throw new Error("Kalenderbereich konnte nicht bestimmt werden (Antwort verwies auf das Benutzerkonto).");
  }
  return homeUrl;
}

interface CalCollection {
  key: string;
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
      `</d:prop></d:propfind>`,
    "Kalenderliste abrufen"
  );
  const out: CalCollection[] = [];
  for (const r of responses(xml)) {
    // Nur echte Kalender-Collections …
    if (!/<[^>]*resourcetype[^>]*>[\s\S]*?calendar[\s\S]*?<\/[^>]*resourcetype[^>]*>/i.test(r)) continue;
    // … die VEVENT unterstützen (Reminders-Listen sind VTODO und entfallen hier).
    const comps = /<[^>]*supported-calendar-component-set[^>]*>([\s\S]*?)<\/[^>]*supported-calendar-component-set[^>]*>/i.exec(r);
    if (comps && !/\bname\s*=\s*["']VEVENT["']/i.test(comps[1])) continue;
    const href = /<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i.exec(r);
    if (!href) continue;
    const url = new URL(decodeDavEntities(href[1].trim()), homeUrl).toString();
    if (url.replace(/\/$/, "") === homeUrl.replace(/\/$/, "")) continue; // Home selbst überspringen
    const name = tagText(r, "displayname") || "iCloud";
    const rawColor = tagText(r, "calendar-color") || "#e8863c";
    const key = createHash("sha256").update(url).digest("hex").slice(0, 16);
    out.push({ key, url, name, color: normalizeColor(rawColor) });
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

function zonedTimeToIso(parts: string[], timeZone: string): string | null {
  const [year, month, day, hour, minute, second] = parts.map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const shown = Object.fromEntries(formatter.formatToParts(new Date(utcGuess)).map((part) => [part.type, part.value]));
    const shownAsUtc = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), Number(shown.hour), Number(shown.minute), Number(shown.second));
    const first = utcGuess - (shownAsUtc - utcGuess);
    const again = Object.fromEntries(formatter.formatToParts(new Date(first)).map((part) => [part.type, part.value]));
    const againAsUtc = Date.UTC(Number(again.year), Number(again.month) - 1, Number(again.day), Number(again.hour), Number(again.minute), Number(again.second));
    return new Date(first - (againAsUtc - utcGuess)).toISOString();
  } catch { return null; }
}

// CalDAV-Zeitstempel: UTC, Datum oder lokale Zeit mit TZID.
function toIso(value: string, isDate: boolean, timeZone?: string | null): string | null {
  if (isDate || /^\d{8}$/.test(value)) {
    if (!/^\d{8}$/.test(value)) return null;
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) return null;
  const base = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (m[7]) return new Date(base + "Z").toISOString();
  if (timeZone) {
    const normalized = timeZone.match(/(Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[^/;]+$/)?.[0] || timeZone;
    return zonedTimeToIso(m.slice(1, 7), normalized) || base;
  }
  return base;
}

interface ParsedEvent {
  uid: string; summary: string; description: string | null; location: string | null;
  recurrenceId: string | null;
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
    let uid = "", summary = "(ohne Titel)", description: string | null = null, location: string | null = null;
    let recurrenceId: string | null = null, status: string | null = null;
    let start: string | null = null, end: string | null = null, allDay = false;
    for (const line of body.split("\n")) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const left = line.slice(0, idx);
      const value = line.slice(idx + 1).trim();
      const name = left.split(";")[0].toUpperCase();
      const isDate = /VALUE=DATE(?!-)/i.test(left);
      const timeZone = /(?:^|;)TZID=(?:"([^"]+)"|([^;:]+))/i.exec(left);
      const tzid = timeZone?.[1] || timeZone?.[2] || null;
      if (name === "UID") uid = value;
      else if (name === "SUMMARY") summary = unescapeText(value) || "(ohne Titel)";
      else if (name === "DESCRIPTION") description = unescapeText(value) || null;
      else if (name === "LOCATION") location = unescapeText(value) || null;
      else if (name === "RECURRENCE-ID") recurrenceId = toIso(value, isDate, tzid) || value;
      else if (name === "STATUS") status = value.toUpperCase();
      else if (name === "DTSTART") { start = toIso(value, isDate, tzid); if (isDate) allDay = true; }
      else if (name === "DTEND") { end = toIso(value, isDate, tzid); }
    }
    if (start && status !== "CANCELLED") events.push({ uid: uid || start, summary, description, location, recurrenceId, start, end, allDay });
  }
  return events;
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

// Apple liefert calendar-data je nach Server XML-escaped oder als CDATA.
export function extractCalendarData(xml: string): string[] {
  const out: string[] = [];
  const re = /<(?:[a-z_][\w.-]*:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:[a-z_][\w.-]*:)?calendar-data\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    let value = match[1].trim();
    const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/i.exec(value);
    if (cdata) value = cdata[1];
    out.push(decodeDavEntities(value));
  }
  return out;
}

function calDavStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function calendarQuery(start: string, end: string, expand: boolean): string {
  const data = expand
    ? `<c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data>`
    : `<c:calendar-data/>`;
  return (
    `<?xml version="1.0" encoding="utf-8"?><c:calendar-query ${NS_D} ${NS_C}>` +
    `<d:prop>${data}</d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
    `<c:time-range start="${start}" end="${end}"/>` +
    `</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`
  );
}

async function fetchCalendarEvents(
  cal: CalCollection,
  auth: string,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const start = calDavStamp(timeMin), end = calDavStamp(timeMax);
  let xml: string;
  try {
    xml = await davRequest(cal.url, "REPORT", auth, "1", calendarQuery(start, end, true));
  } catch (error) {
    if (error instanceof IcloudAuthError) throw error;
    // Manche Apple-Kalender lehnen die Erweiterung wiederkehrender Termine ab.
    // Die normale Abfrage liefert weiterhin Einzeltermine und Serien-Master.
    xml = await davRequest(cal.url, "REPORT", auth, "1", calendarQuery(start, end, false));
  }

  const text = readableText(cal.color);
  const out: CalendarEvent[] = [];
  for (const data of extractCalendarData(xml)) {
    for (const ev of parseIcsEvents(data)) {
      out.push({
        // RECURRENCE-ID bleibt beim Verschieben einer Serieninstanz stabil.
        // Einmalige Termine verwenden die UID und ändern ihre ID daher ebenfalls nicht.
        id: `icloud:${cal.key}:${ev.uid}:${ev.recurrenceId || "master"}`,
        title: ev.summary,
        start: ev.start,
        end: ev.end,
        allDay: ev.allDay,
        location: ev.location,
        calendar: cal.name,
        color: cal.color,
        textColor: text,
        htmlLink: null,
        description: ev.description,
        source: "icloud"
      });
    }
  }
  return out;
}

// ---- Öffentliche API ------------------------------------------------------

// Zugangsdaten prüfen und Kalender-Home ermitteln (für den Verbinden-Flow).
export async function verifyIcloud(appleId: string, appPassword: string): Promise<{ home: string; calendars: number }> {
  const home = await discoverHome(appleId, appPassword);
  const auth = authHeader(appleId, appPassword);
  const cals = await listCalendars(home, auth);
  if (!cals.length) throw new Error("Apple hat keine Kalender mit Terminzugriff zurückgegeben.");
  const now = new Date();
  const min = new Date(now); min.setDate(min.getDate() - 1);
  const max = new Date(now); max.setDate(max.getDate() + 1);
  await Promise.all(cals.map((cal) => fetchCalendarEvents(cal, auth, min.toISOString(), max.toISOString())));
  return { home, calendars: cals.length };
}

// Termine im Zeitfenster [timeMin, timeMax) über alle VEVENT-Kalender holen.
export interface IcloudSnapshot {
  events: CalendarEvent[];
  calendarCount: number;
  selectedCalendarCount: number;
}

export async function fetchIcloudSnapshot(
  account: IcloudAccount,
  timeMin: string,
  timeMax: string
): Promise<IcloudSnapshot> {
  const appPassword = decrypt(account.app_password_enc);
  const auth = authHeader(account.apple_id, appPassword);
  const home = account.calendar_home_url || (await discoverHome(account.apple_id, appPassword));
  const cals = await listCalendars(home, auth);
  if (!cals.length) throw new Error("Keine iCloud-Kalender mit Terminen gefunden.");
  const excluded = new Set(account.excluded_calendar_keys || []);
  const selected = cals.filter((calendar) => !excluded.has(calendar.key));
  if (!selected.length) return { events: [], calendarCount: cals.length, selectedCalendarCount: 0 };
  // Nur ein vollständiger Abruf darf den späteren Löschabgleich auslösen.
  const chunks = await Promise.all(selected.map((calendar) => fetchCalendarEvents(calendar, auth, timeMin, timeMax)));
  const byId = new Map<string, CalendarEvent>();
  for (const event of chunks.flat()) byId.set(event.id, event);
  const events = [...byId.values()].sort((a, b) => a.start.localeCompare(b.start));
  return { events, calendarCount: cals.length, selectedCalendarCount: selected.length };
}

export async function fetchIcloudEvents(account: IcloudAccount, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  return (await fetchIcloudSnapshot(account, timeMin, timeMax)).events;
}
