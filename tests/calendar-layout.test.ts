import test from "node:test";
import assert from "node:assert/strict";
import { daySlot, packDay } from "../components/CalendarView";

const event=(start:string,end:string|null)=>({id:start,title:"Termin",start,end,allDay:false,location:null,calendar:"Privat",color:"#fff",textColor:"#000",htmlLink:null}) as any;

test("Tagesraster bewahrt frühe und über Mitternacht laufende Termine",()=>{
 const early=daySlot(event("2026-10-03T05:15:00","2026-10-03T06:30:00"),"2026-10-03");
 assert.equal(early?.from,315);
 assert.equal(early?.to,390);
 const overnight=daySlot(event("2026-10-03T23:30:00","2026-10-04T01:00:00"),"2026-10-03");
 assert.equal(overnight?.from,1410);
 assert.equal(overnight?.to,1440);
 const continuation=daySlot(event("2026-10-03T23:30:00","2026-10-04T01:00:00"),"2026-10-04");
 assert.equal(continuation?.from,0);
 assert.equal(continuation?.to,60);
});
test("Parallele Termine bleiben als getrennte Ebenen sichtbar",()=>{
 const packed=packDay([
  {e:event("2026-10-03T09:00:00","2026-10-03T12:00:00"),from:540,to:720},
  {e:event("2026-10-03T10:00:00","2026-10-03T10:30:00"),from:600,to:630}
 ]);
 assert.equal(packed.length,2);
 assert.notEqual(packed[0].depth,packed[1].depth);
});