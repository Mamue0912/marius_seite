import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJobUrl, extractJobPostingPage, normalizeJobUrl } from "../lib/jobPostingExtract";

const structured = [
 "<!doctype html><html><head>",
 '<link rel="canonical" href="https://jobs.example.com/position/42?utm_source=mail">',
 '<script type="application/ld+json">',
 JSON.stringify({
  "@context":"https://schema.org","@type":"JobPosting","title":"Werkstudent Softwareentwicklung",
  "hiringOrganization":{"@type":"Organization","name":"Beispiel GmbH","description":"Software für Bildung."},
  "jobLocation":{"address":{"streetAddress":"Musterweg 1","postalCode":"20095","addressLocality":"Hamburg","addressCountry":"DE"}},
  "employmentType":"PART_TIME","validThrough":"2026-10-31","responsibilities":["Web-App pflegen","Tests schreiben"],
  "qualifications":["TypeScript"],"experienceRequirements":"Erste Projekterfahrung"
 }),
 "</script></head><body><nav>Navigation</nav><main><h1>Werkstudent Softwareentwicklung</h1><h2>Aufgaben</h2><p>Du pflegst unsere Web-App.</p><h2>Dein Profil</h2><p>Du kennst TypeScript.</p><p>Jetzt bewerben</p></main><footer>Newsletter</footer></body></html>"
].join("");

test("Stellen-URLs werden validiert, normalisiert und von Tracking befreit",()=>{
 assert.equal(normalizeJobUrl(" jobs.example.com/position/42?utm_source=mail&jobId=7&fbclid=x#top "),"https://jobs.example.com/position/42?jobId=7");
 assert.equal(normalizeJobUrl("https://jobs.example.com/p?a=2&a=1"),"https://jobs.example.com/p?a=1&a=2");
 assert.throws(()=>normalizeJobUrl("javascript:alert(1)"));
 assert.throws(()=>normalizeJobUrl("https://example.com/"+("x".repeat(5000))),/url_too_long/);
});

test("Unternehmens-Karriereseite liefert strukturierte Stellenfelder",()=>{
 const result=extractJobPostingPage(structured,"https://jobs.example.com/position/42?ref=x");
 assert.equal(result.isJobPosting,true);
 assert.equal(result.fields.title,"Werkstudent Softwareentwicklung");
 assert.equal(result.fields.company,"Beispiel GmbH");
 assert.match(result.fields.location||"",/Hamburg/);
 assert.equal(result.fields.employmentType,"PART_TIME");
 assert.equal(result.fields.deadline,"2026-10-31");
 assert.deepEqual(result.fields.tasks,["Web-App pflegen","Tests schreiben"]);
 assert.equal(result.canonicalUrl,"https://jobs.example.com/position/42");
 assert.doesNotMatch(result.text,/Newsletter|Navigation/);
});

test("Stellenportal ohne JSON-LD wird anhand des relevanten Inhalts erkannt",()=>{
 const html="<html><head><title>Praktikum Marketing bei Nord GmbH</title><meta name='description' content='Praktikumsstelle in Hamburg'></head><body><main><h1>Praktikum Marketing</h1><h2>Deine Aufgaben</h2><p>Du planst Kampagnen und unterstützt das Team.</p><h2>Dein Profil</h2><p>Du studierst Kommunikation.</p><h2>Bewerbung</h2><p>Bewirb dich online für dieses Stellenangebot.</p></main></body></html>";
 const result=extractJobPostingPage(html,"https://portal.example/jobs/987?utm_campaign=x");
 assert.equal(result.isJobPosting,true);
 assert.equal(result.fields.company,null);
 assert.equal(result.fields.deadline,null);
 assert.equal(result.canonicalUrl,"https://portal.example/jobs/987");
});

test("Nicht erreichbarer dynamischer Inhalt und Consent werden differenziert",()=>{
 const dynamic=extractJobPostingPage("<html><body><div id='app'></div><script src='app.js'></script></body></html>","https://jobs.example.com/1");
 assert.equal(dynamic.isJobPosting,false);
 assert.equal(dynamic.obstacle,"dynamic");
 const consent=extractJobPostingPage("<html><body><h1>Datenschutzeinstellungen</h1><p>Bitte Cookie Consent bestätigen.</p></body></html>","https://jobs.example.com/2");
 assert.equal(consent.isJobPosting,false);
 assert.equal(consent.obstacle,"consent");
});

test("Beliebige Webseiten werden nicht als Stellenanzeige akzeptiert und fehlende Werte bleiben leer",()=>{
 const result=extractJobPostingPage("<html><head><title>Unternehmensnachrichten</title></head><body><main><h1>Sommerfest</h1><p>Wir berichten aus unserem Unternehmen.</p></main></body></html>","https://www.example.com/news");
 assert.equal(result.isJobPosting,false);
 assert.equal(result.fields.company,null);
 assert.equal(result.fields.deadline,null);
 assert.deepEqual(result.fields.requirements,[]);
});

test("Canonical- und Trackingvarianten ergeben dieselbe Stellenidentität",()=>{
 const a=canonicalJobUrl("/position/42?utm_medium=email","https://jobs.example.com/index");
 const b=normalizeJobUrl("https://jobs.example.com/position/42?fbclid=abc");
 assert.equal(a,b);
});
test("Abgelaufene Ausschreibungen bleiben erkennbar, werden aber markiert",()=>{
 const html=structured.replace("2026-10-31","2020-01-01");
 assert.equal(extractJobPostingPage(html,"https://jobs.example.com/position/42").expired,true);
});
