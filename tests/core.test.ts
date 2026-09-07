import test from "node:test";
import assert from "node:assert/strict";
import { dayDistance, taskBucket } from "../lib/taskDates";
import { mapLimit } from "../lib/concurrency";
import { messageContentKey } from "../lib/mailKeys";
import { requestJson } from "../lib/http";
import { extractCalendarData, parseIcsEvents, normalizeColor, readableText, verifyIcloud, IcloudAuthError, hrefInside } from "../lib/icloudCalendar";
import { calendarEventTaskRecord, staleExternalIds } from "../lib/calendarTaskSync";
import { safeInternalPath } from "../lib/safeNavigation";
import { isPrivateAddress, resolvePublicNetworkEndpoint } from "../lib/safeRemote";
import { taskDueDate, taskNote, taskPriorityRank, taskTitle, validTaskPriority, validTaskStatus } from "../lib/taskValidation";

test("Aufgaben ohne Datum sind nie überfällig", () => {
 assert.equal(dayDistance(null, new Date("2026-09-04T12:00:00")), null);
 assert.equal(taskBucket({status:"offen",due_at:null}, new Date("2026-09-04T12:00:00")), "Ohne Datum");
});
test("Datumsgruppen vergleichen Kalendertage", () => {
 const now=new Date("2026-03-29T12:00:00+02:00");
 assert.equal(taskBucket({status:"offen",due_at:"2026-03-28"},now),"Überfällig");
 assert.equal(taskBucket({status:"offen",due_at:"2026-03-29"},now),"Heute");
 assert.equal(taskBucket({status:"offen",due_at:"2026-04-05"},now),"Diese Woche");
});
test("Mail-Cache-Schlüssel trennen Konto, Ordner und Bildmodus",()=>{
 assert.notEqual(messageContentKey("a","INBOX",5,false),messageContentKey("b","INBOX",5,false));
 assert.notEqual(messageContentKey("a","INBOX",5,false),messageContentKey("a","INBOX",5,true));
});
test("Begrenzte Parallelität bewahrt Reihenfolge",async()=>{
 let active=0,peak=0;
 const result=await mapLimit([1,2,3,4,5],2,async value=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return value*2;});
 assert.deepEqual(result,[2,4,6,8,10]);assert.equal(peak,2);
});
test("API-Fehler werden nicht als leere Daten verschluckt",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({message:"Server nicht erreichbar"}),{status:502,headers:{"content-type":"application/json"}});
 await assert.rejects(()=>requestJson("/test"),/Server nicht erreichbar/);
 globalThis.fetch=original;
});
test("iCloud-ICS: UTC-Termin, ganztägig und gefaltete Zeilen", () => {
 const ics = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:abc-1",
  "DTSTART:20260904T140000Z",
  "DTEND:20260904T153000Z",
  "SUMMARY:Karate-Training mit sehr lang",
  " em Titel",
  "LOCATION:Dojo Ost",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:abc-2",
  "DTSTART;VALUE=DATE:20260905",
  "DTEND;VALUE=DATE:20260906",
  "SUMMARY:Ganztägig",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:abc-3",
  "DTSTART:20260906T120000Z",
  "STATUS:CANCELLED",
  "SUMMARY:Abgesagt",
  "END:VEVENT",
  "END:VCALENDAR"
 ].join("\r\n");
 const evs = parseIcsEvents(ics);
 assert.equal(evs.length, 2);
 assert.equal(evs[0].start, "2026-09-04T14:00:00.000Z");
 assert.equal(evs[0].allDay, false);
 assert.equal(evs[0].summary, "Karate-Training mit sehr langem Titel");
 assert.equal(evs[0].location, "Dojo Ost");
 assert.equal(evs[1].allDay, true);
 assert.equal(evs[1].start, "2026-09-05");
});
test("iCloud-Farben: ARGB/8-stellig wird auf #RRGGBB gekürzt", () => {
 assert.equal(normalizeColor("#FF2968FF"), "#FF2968");
 assert.equal(normalizeColor("#1abc9c"), "#1abc9c");
 assert.equal(normalizeColor("kaputt"), "#e8863c");
 assert.equal(readableText("#ffffff"), "#1a1a1a");
 assert.equal(readableText("#101010"), "#ffffff");
});

test("Auth redirects stay inside the application", () => {
 assert.equal(safeInternalPath("/mail?unread=1"), "/mail?unread=1");
 assert.equal(safeInternalPath("https://evil.example/path"), "/");
 assert.equal(safeInternalPath("//evil.example/path"), "/");
});

test("Private and reserved network targets are recognized", () => {
 for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.4", "::1", "fc00::1", "2001:db8::1"]) {
  assert.equal(isPrivateAddress(address), true, address);
 }
 assert.equal(isPrivateAddress("8.8.8.8"), false);
 assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
});

test("Mail endpoints pin a validated public IP address", async () => {
 const endpoint = await resolvePublicNetworkEndpoint("8.8.8.8");
 assert.deepEqual(endpoint, { address: "8.8.8.8", family: 4, hostname: "8.8.8.8", servername: undefined });
 await assert.rejects(() => resolvePublicNetworkEndpoint("127.0.0.1"), /private_remote_host/);
});

test("Task input and priorities are validated consistently", () => {
 assert.equal(taskTitle("  Zeugnis senden  "), "Zeugnis senden");
 assert.equal(taskNote("  heute  "), "heute");
 assert.equal(taskDueDate(null), null);
 assert.equal(validTaskPriority("dringend"), true);
 assert.equal(validTaskPriority("sofort"), false);
 assert.equal(validTaskStatus("warten"), true);
 assert.ok(taskPriorityRank("dringend") > taskPriorityRank("hoch"));
 assert.throws(() => taskTitle("   "));
 assert.throws(() => taskDueDate("kein-datum"));
});


test("iCloud-CalDAV extrahiert escaped XML und CDATA", () => {
  const escaped = "<d:response><c:calendar-data>BEGIN:VCALENDAR&amp;END:VCALENDAR</c:calendar-data></d:response>";
  const cdata = "<d:response><c:calendar-data><![CDATA[BEGIN:VCALENDAR\r\nEND:VCALENDAR]]></c:calendar-data></d:response>";
  assert.deepEqual(extractCalendarData(escaped), ["BEGIN:VCALENDAR&END:VCALENDAR"]);
  assert.deepEqual(extractCalendarData(cdata), ["BEGIN:VCALENDAR\r\nEND:VCALENDAR"]);
});


test("iCloud-Serieninstanzen behalten ihre Wiederholungskennung", () => {
  const events = parseIcsEvents(["BEGIN:VCALENDAR","BEGIN:VEVENT","UID:serie-1","RECURRENCE-ID;TZID=Europe/Berlin:20260907T180000","DTSTART;TZID=Europe/Berlin:20260907T190000","DTEND;TZID=Europe/Berlin:20260907T200000","SUMMARY:Training","DESCRIPTION:Kata","END:VEVENT","END:VCALENDAR"].join("\r\n"));
  assert.equal(events[0].recurrenceId, "2026-09-07T16:00:00.000Z");
  assert.equal(events[0].start, "2026-09-07T17:00:00.000Z");
  assert.equal(events[0].description, "Kata");
});

test("Kalenderaufgaben bewahren Ganztagsdatum und ermitteln Löschkandidaten", () => {
  const row = calendarEventTaskRecord("user-1", { id:"icloud:cal:uid:master", title:"Ganztag", start:"2026-09-07", end:"2026-09-08", allDay:true, location:null, calendar:"Privat", color:"#fff", textColor:"#000", htmlLink:null, source:"icloud" });
  assert.equal(row.starts_at, "2026-09-07T12:00:00.000Z");
  assert.equal(row.source, "icloud_calendar");
  assert.deepEqual(staleExternalIds([{external_id:"a"},{external_id:"b"}], ["b","c"]), ["a"]);
});

test("iCloud folgt Apple-Weiterleitungen und behält die Anmeldung", async () => {
 const original = globalThis.fetch;
 const seen: Array<{ url: string; auth: string | null }> = [];
 const dav = (xml: string) => new Response(xml, { status: 207, headers: { "content-type": "application/xml" } });
 globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input);
  seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
  if (seen.length === 1) return new Response(null, { status: 302, headers: { location: "https://p52-caldav.icloud.com/" } });
  if (url === "https://p52-caldav.icloud.com/") {
   return dav('<multistatus xmlns="DAV:"><response><href>/</href><propstat><prop><current-user-principal><href>/123/principal/</href></current-user-principal></prop></propstat></response></multistatus>');
  }
  if (url.endsWith("/123/principal/")) {
   return dav('<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/123/principal/</href><propstat><prop><C:calendar-home-set><href>https://p52-caldav.icloud.com/123/calendars/</href></C:calendar-home-set></prop></propstat></response></multistatus>');
  }
  return dav('<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/"><response><href>/123/calendars/privat/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>Privat</displayname><A:calendar-color>#FF2968FF</A:calendar-color><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></prop></propstat></response></multistatus>');
 }) as any;
 try {
  const result = await verifyIcloud("person@icloud.com", "abcd-efgh-ijkl-mnop");
  assert.equal(result.calendars, 1);
  assert.equal(result.home, "https://p52-caldav.icloud.com/123/calendars/");
  // Entscheidend: auch nach der Weiterleitung auf den Shard-Host wird die
  // Anmeldung weiterhin mitgesendet.
  assert.ok(seen.length >= 2);
  assert.ok(seen.every((entry) => (entry.auth || "").startsWith("Basic ")));
  assert.ok(seen[1].url.startsWith("https://p52-caldav.icloud.com/"));
 } finally { globalThis.fetch = original; }
});
test("iCloud meldet fehlende Berechtigung (403) als Zugangsproblem", async () => {
 const original = globalThis.fetch;
 globalThis.fetch = (async () => new Response("nope", { status: 403 })) as any;
 try {
  await assert.rejects(() => verifyIcloud("person@icloud.com", "abcd"), (error: unknown) => error instanceof IcloudAuthError);
 } finally { globalThis.fetch = original; }
});

test("iCloud weicht auf /.well-known/caldav aus, wenn der Stamm 403 liefert", async () => {
 const original = globalThis.fetch;
 const seen: string[] = [];
 const dav = (xml: string) => new Response(xml, { status: 207, headers: { "content-type": "application/xml" } });
 globalThis.fetch = (async (input: any) => {
  const url = String(input);
  seen.push(url);
  // Apple lehnt den Serverstamm ab, erlaubt aber den Discovery-Pfad.
  if (url === "https://caldav.icloud.com/") return new Response("forbidden", { status: 403 });
  if (url === "https://caldav.icloud.com/.well-known/caldav") {
   return dav('<multistatus xmlns="DAV:"><response><href>/</href><propstat><prop><current-user-principal><href>/77/principal/</href></current-user-principal></prop></propstat></response></multistatus>');
  }
  if (url.endsWith("/77/principal/")) {
   return dav('<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/77/principal/</href><propstat><prop><C:calendar-home-set><href>https://p11-caldav.icloud.com/77/calendars/</href></C:calendar-home-set></prop></propstat></response></multistatus>');
  }
  return dav('<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/77/calendars/privat/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>Privat</displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></prop></propstat></response></multistatus>');
 }) as any;
 try {
  const result = await verifyIcloud("person@icloud.com", "abcd-efgh-ijkl-mnop");
  assert.equal(result.calendars, 1);
  assert.ok(seen.includes("https://caldav.icloud.com/.well-known/caldav"), "Fallback-Pfad muss versucht werden");
 } finally { globalThis.fetch = original; }
});

test("iCloud ignoriert leere 404-Platzhalter und greift nicht auf das ganze Dokument zurück", () => {
 // Apple liefert nicht gefundene Eigenschaften als leere Platzhalter in einem
 // eigenen propstat. Frueher fing das Muster diesen Platzhalter mit ein bzw.
 // fiel auf das ganze Dokument zurueck - und lieferte dann die Principal-URL
 // aus dem <response>-href. Ein Depth-1-PROPFIND darauf ergibt bei Apple 403.
 const xml = [
  '<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">',
  '<response><href>/123/principal/</href>',
  '<propstat><prop><C:calendar-home-set/></prop><status>HTTP/1.1 404 Not Found</status></propstat>',
  '<propstat><prop><C:calendar-home-set><href>https://p52-caldav.icloud.com/123/calendars/</href></C:calendar-home-set></prop><status>HTTP/1.1 200 OK</status></propstat>',
  '</response></multistatus>'
 ].join("");
 assert.equal(hrefInside(xml, "calendar-home-set"), "https://p52-caldav.icloud.com/123/calendars/");
 // Fehlt die Eigenschaft ganz, darf NICHT die Antwort-URL zurueckkommen.
 const missing = '<multistatus xmlns="DAV:"><response><href>/123/principal/</href><propstat><prop/></propstat></response></multistatus>';
 assert.equal(hrefInside(missing, "calendar-home-set"), null);
});

test("iCloud faellt bei 403 auf die Abfrage ohne <expand> zurueck", async () => {
 const original = globalThis.fetch;
 const bodies: string[] = [];
 const dav = (xml: string) => new Response(xml, { status: 207, headers: { "content-type": "application/xml" } });
 globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input);
  const body = String(init?.body || "");
  if (url === "https://caldav.icloud.com/") {
   return dav('<multistatus xmlns="DAV:"><response><href>/</href><propstat><prop><current-user-principal><href>/9/principal/</href></current-user-principal></prop></propstat></response></multistatus>');
  }
  if (url.endsWith("/9/principal/")) {
   return dav('<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/9/principal/</href><propstat><prop><C:calendar-home-set><href>https://p1-caldav.icloud.com/9/calendars/</href></C:calendar-home-set></prop></propstat></response></multistatus>');
  }
  if (url === "https://p1-caldav.icloud.com/9/calendars/") {
   return dav('<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/9/calendars/privat/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>Privat</displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></prop></propstat></response></multistatus>');
  }
  // REPORT auf den Kalender: Apple verweigert <expand> mit 403.
  bodies.push(body);
  if (body.includes("expand")) return new Response("forbidden", { status: 403 });
  return dav('<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/9/calendars/privat/a.ics</href><propstat><prop><C:calendar-data>BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x-1\r\nDTSTART:20260907T100000Z\r\nDTEND:20260907T110000Z\r\nSUMMARY:Training\r\nEND:VEVENT\r\nEND:VCALENDAR</C:calendar-data></prop></propstat></response></multistatus>');
 }) as any;
 try {
  const result = await verifyIcloud("person@icloud.com", "abcd-efgh-ijkl-mnop");
  assert.equal(result.calendars, 1);
  // Beide Varianten wurden versucht: erst mit, dann ohne Erweiterung.
  assert.ok(bodies.some((b) => b.includes("expand")), "erst mit expand");
  assert.ok(bodies.some((b) => !b.includes("expand")), "dann ohne expand");
 } finally { globalThis.fetch = original; }
});
