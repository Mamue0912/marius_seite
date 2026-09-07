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
test("Vollständig verschachtelte Termine werden übereinander dargestellt",()=>{
 const packed=packDay([
  {e:event("2026-10-03T09:00:00","2026-10-03T12:00:00"),from:540,to:720},
  {e:event("2026-10-03T10:00:00","2026-10-03T10:30:00"),from:600,to:630}
 ]);
 assert.equal(packed.length,2);
 assert.notEqual(packed[0].depth,packed[1].depth);
 assert.equal(packed[0].columns,1);
 assert.equal(packed[1].columns,1);
});
test("Teilweise überlappende Termine stehen nebeneinander",()=>{
 const packed=packDay([
  {e:event("2026-09-10T19:45:00","2026-09-10T21:00:00"),from:1185,to:1260},
  {e:event("2026-09-10T20:00:00","2026-09-10T23:00:00"),from:1200,to:1380}
 ]);
 assert.equal(packed.length,2);
 assert.equal(packed[0].columns,2);
 assert.equal(packed[1].columns,2);
 assert.notEqual(packed[0].column,packed[1].column);
 assert.equal(packed[0].depth,0);
 assert.equal(packed[1].depth,0);
});
test("Ein früher beginnender langer Termin umschließt den kürzeren",()=>{
 const packed=packDay([
  {e:event("2026-09-10T19:45:00","2026-09-10T21:00:00"),from:1185,to:1260},
  {e:event("2026-09-10T19:00:00","2026-09-10T23:00:00"),from:1140,to:1380}
 ]);
 const inner=packed.find((item)=>item.from===1185)!;
 assert.equal(inner.columns,1);
 assert.equal(inner.depth,1);
});