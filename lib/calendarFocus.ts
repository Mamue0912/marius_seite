import type { CalendarEvent } from "./googleCalendar";

export type CalendarFocusKind = "task"|"deadline"|"important_event"|"routine"|"training"|"travel"|"holiday"|"informational"|"personal"|"possible";
export type CalendarFocusDecision = { kind: CalendarFocusKind; focus: boolean; confidence: number; reason: string };

const LABELS: Record<CalendarFocusKind,string> = {
  task:"Aufgabe", deadline:"Frist", important_event:"Wichtiger Termin", routine:"Routine",
  training:"Training", travel:"Urlaub oder Reise", holiday:"Ferien oder Feiertag",
  informational:"Information", personal:"Persönlicher Termin", possible:"Möglicherweise"
};
const ACTIVE = new Set<CalendarFocusKind>(["task","deadline","important_event"]);
const fold = (value?: string|null) => (value||"").toLocaleLowerCase("de").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ß/g,"ss");
const any = (value:string, words:string[]) => words.some((word)=>value.includes(word));
function durationDays(e:CalendarEvent) {
  if(!e.end) return 0;
  const a=new Date(e.start).getTime(), b=new Date(e.end).getTime();
  return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,(b-a)/86400000):0;
}

export function classifyCalendarFocus(event:CalendarEvent):CalendarFocusDecision {
  const title=fold(event.title).trim(), description=fold(event.description), calendar=fold(event.calendar), combined=`${title} ${description}`;
  const recurring=!!event.recurring||!!event.recurrenceInstance||!!event.recurrenceRule;
  if(/feiertag|ferien|holiday|birthday|geburtstag|namenstag/.test(calendar))
    return {kind:"holiday",focus:false,confidence:1,reason:"Der Kalender enthält reine Ferien-, Feiertags- oder Geburtstagsinformationen."};
  if(any(title,["ferien","feiertag","bruckentag","neujahr","silvester","karfreitag","ostermontag","ostersonntag","himmelfahrt","pfingsten","fronleichnam","reformationstag","allerheiligen","weihnachten","heiligabend","tag der deutschen einheit"]))
    return {kind:"holiday",focus:false,confidence:1,reason:"Ferien und Feiertage sind Kalenderinformationen ohne eigene Handlung."};
  if(any(title,["skiurlaub","urlaub","reisezeitraum","dienstreise","klassenfahrt","camping","abwesenheit"])||/\b(flug|hotel|reise)\b/.test(title))
    return {kind:"travel",focus:false,confidence:.96,reason:"Der Eintrag beschreibt Urlaub, Reise oder Abwesenheit und keine Aufgabe."};
  if(any(title,["geburtstag","jahrestag"])&&!any(combined,["geschenk","anrufen","gratulieren","organisieren"]))
    return {kind:"informational",focus:false,confidence:.95,reason:"Der Eintrag erinnert an ein Datum, enthält aber keine konkrete Handlung."};
  if(any(combined,["feedbackbogen","abgabe","abgeben","abgabefrist","bewerbungsfrist","deadline","einreichen","einsenden","ruckmeldung bis","antwort bis","fallig","frist","antrag stellen"]))
    return {kind:"deadline",focus:true,confidence:.98,reason:recurring?"Die Wiederholung enthält eine konkrete Abgabe oder Rückmeldung und bleibt deshalb handlungsrelevant.":"Der Eintrag nennt eine konkrete Abgabe, Rückmeldung oder Frist."};
  if(any(combined,["vorbereiten","fertigstellen","erledigen","bearbeiten","ausfullen","abschicken","anmelden","besorgen","uberweisen","bezahlen","kundigen","lernen","athletikplan","hausaufgabe","to-do","todo"]))
    return {kind:"task",focus:true,confidence:.94,reason:"Titel oder Beschreibung enthalten eine konkrete auszuführende Handlung."};
  if(any(combined,["bewerbungsgesprach","vorstellungsgesprach","assessment","interview","prufung","klausur","praktikumsbeginn","arbeitseinsatz","turnier","wettkampf","meisterschaft","kadertraining","sichtung","punica"]))
    return {kind:"important_event",focus:true,confidence:.92,reason:"Der Termin ist eine besondere Maßnahme oder erfordert aktive Teilnahme beziehungsweise Vorbereitung."};
  if(any(title,["karate","training","trainerstunde","fitness","lauftraining"]))
    return {kind:"training",focus:false,confidence:recurring?.98:.82,reason:recurring?"Ein regelmäßiges Training ist eine Routine ohne zusätzliche Abgabe.":"Der Termin ist als Training eingeordnet und enthält keinen besonderen Handlungsbedarf."};
  if(recurring) return {kind:"routine",focus:false,confidence:.82,reason:"Der Serientermin enthält keine konkrete Abgabe, Vorbereitung oder besondere Maßnahme."};
  if(any(combined,["zur information","info","vormerkung","blocker","erinnerung ohne aktion"]))
    return {kind:"informational",focus:false,confidence:.9,reason:"Der Eintrag ist ausdrücklich informativ und verlangt keine Handlung."};
  if(event.allDay&&durationDays(event)>=1.5)
    return {kind:"informational",focus:false,confidence:.75,reason:"Der mehrtägige Ganztagseintrag enthält keinen erkennbaren Handlungsauftrag."};
  if(any(combined,["termin","arzt","zahnarzt","treffen","essen","feier","party"]))
    return {kind:"personal",focus:false,confidence:.72,reason:"Der persönliche Termin enthält keine erkennbare Aufgabe oder Frist."};
  return {kind:"possible",focus:false,confidence:.4,reason:"Es ist keine eindeutige Handlung erkennbar. Der Eintrag wird deshalb nur als mögliche Aufgabe angeboten."};
}
export const calendarFocusLabel=(kind:CalendarFocusKind)=>LABELS[kind];
export const isFocusKind=(kind:CalendarFocusKind)=>ACTIVE.has(kind);
export const automaticFocusCategory=(kind:CalendarFocusKind)=>`Kalender · ${LABELS[kind]}`;
export const manualFocusCategory=(kind:CalendarFocusKind|"hidden")=>`Fokus · ${kind==="hidden"?"Ausgeblendet":LABELS[kind]}`;
export const isManualFocusCategory=(category?:string|null)=>(category||"").startsWith("Fokus · ");
export function focusKindFromCategory(category?:string|null):CalendarFocusKind|null {
  const label=(category||"").replace(/^(?:Kalender|Fokus) · /,"");
  return (Object.entries(LABELS) as Array<[CalendarFocusKind,string]>).find(([,value])=>value===label)?.[0]||null;
}
export function calendarFocusSignature(title?:string|null,calendar?:string|null):string {
  const t=fold(title).replace(/\b(?:19|20)\d{2}\b/g," ").replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g," ")
    .replace(/\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|januar|februar|marz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").trim();
  return `${fold(calendar).replace(/[^a-z0-9]+/g," ").trim()}::${t}`;
}
type TaskLike={title?:string|null;note?:string|null;source?:string|null;status?:string|null;category?:string|null;calendar_name?:string|null;all_day?:boolean;starts_at?:string|null;ends_at?:string|null};
function taskDecision(task:TaskLike) {
  return classifyCalendarFocus({id:"",title:task.title||"",description:task.note||null,start:task.starts_at||new Date().toISOString(),end:task.ends_at||null,allDay:!!task.all_day,location:null,calendar:task.calendar_name||"",color:"",textColor:"",htmlLink:null});
}
export function calendarTaskReason(task:TaskLike):string {
  if(isManualFocusCategory(task.category)) return "Diese Einordnung wurde von dir festgelegt und bleibt bei der Synchronisierung erhalten.";
  const kind=focusKindFromCategory(task.category);
  const reasons:Record<CalendarFocusKind,string>={
    task:"Der Kalendereintrag enthält eine konkrete Handlung.",deadline:"Der Kalendereintrag enthält eine Abgabe oder Frist.",
    important_event:"Der Termin ist besonders und kann Vorbereitung oder aktive Teilnahme verlangen.",routine:"Regelmäßiger Termin ohne zusätzliche Abgabe.",
    training:"Normales Training ohne besonderen Handlungsbedarf.",travel:"Reise oder Abwesenheit ohne eigene Aufgabe.",holiday:"Ferien- oder Feiertagsinformation.",
    informational:"Informative Kalenderangabe ohne Handlungsauftrag.",personal:"Persönlicher Termin ohne erkennbare Aufgabe.",
    possible:"Der Handlungsbedarf ist nicht eindeutig und sollte geprüft werden."
  };
  return kind?reasons[kind]:taskDecision(task).reason;
}
export function calendarTaskIsInFocus(task:TaskLike):boolean {
  if(task.status==="ignoriert"||task.status==="erledigt") return false;
  if(task.source!=="icloud_calendar") return true;
  if(isManualFocusCategory(task.category)) return task.category!==manualFocusCategory("hidden");
  const kind=focusKindFromCategory(task.category);
  return kind?isFocusKind(kind):taskDecision(task).focus;
}