import test from "node:test";
import assert from "node:assert/strict";
import { dayDistance, taskBucket } from "../lib/taskDates";
import { mapLimit } from "../lib/concurrency";
import { messageContentKey } from "../lib/mailKeys";
import { requestJson } from "../lib/http";

test("Aufgaben ohne Datum sind nie überfällig", () => {
 assert.equal(dayDistance(null, new Date("2026-09-04T12:00:00")), null);
 assert.equal(taskBucket({status:"offen",due_at:null}, new Date("2026-09-04T12:00:00")), "Ohne Frist");
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
