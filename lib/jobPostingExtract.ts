const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref", "referrer",
  "tracking", "trackingid", "campaign", "campaignid", "source", "pk_campaign", "pk_kwd"
]);

export type ExtractedJobFields = {
  title: string | null;
  company: string | null;
  location: string | null;
  employmentType: string | null;
  startDate: string | null;
  deadline: string | null;
  tasks: string[];
  requirements: string[];
  qualifications: string[];
  contact: string | null;
  applicationMethod: string | null;
  companyDescription: string | null;
};

export type JobPageExtraction = {
  canonicalUrl: string;
  fields: ExtractedJobFields;
  text: string;
  analysisText: string;
  isJobPosting: boolean;
  confidence: number;
  obstacle: "consent" | "challenge" | "dynamic" | null;
  expired: boolean;
};

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, code: string) => {
    if (code[0] === "#") {
      const hex = code[1]?.toLowerCase() === "x";
      const point = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : " ";
    }
    return named[code.toLowerCase()] ?? " ";
  });
}

function cleanText(value: unknown, max = 6000): string {
  if (value == null) return "";
  const raw = Array.isArray(value) ? value.join("\n") : String(value);
  return decodeEntities(raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim().slice(0, max);
}

function unique(values: string[], max = 30): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map((item) => cleanText(item, 800)).filter(Boolean)) {
    const key = value.toLocaleLowerCase("de");
    if (!seen.has(key)) { seen.add(key); out.push(value); }
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeJobUrl(raw: string): string {
  let input = String(raw || "").trim().replace(/^[<(\[\{"'\s]+|[>)\]\}"'\s.,;]+$/g, "");
  if (!input) throw new Error("empty_url");
  if (input.length > 4096) throw new Error("url_too_long");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `https://${input}`;
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("invalid_url"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname.includes(".")) throw new Error("invalid_url");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) url.searchParams.delete(key);
  }
  const sorted = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  url.search = "";
  for (const [key, value] of sorted) url.searchParams.append(key, value);
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function canonicalJobUrl(raw: string, base?: string): string {
  try { return normalizeJobUrl(base ? new URL(raw, base).toString() : raw); }
  catch { return normalizeJobUrl(base || raw); }
}

function parseAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag))) out[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  return out;
}

function metaValue(html: string, names: string[]): string | null {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = parseAttributes(tag);
    if (wanted.has((attrs.name || attrs.property || "").toLowerCase()) && attrs.content) return cleanText(attrs.content, 1000) || null;
  }
  return null;
}

function canonicalFromHtml(html: string, fallback: string): string {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attrs = parseAttributes(tag);
    if ((attrs.rel || "").toLowerCase().split(/\s+/).includes("canonical") && attrs.href) {
      try { return canonicalJobUrl(attrs.href, fallback); } catch { /* ungültiges Canonical ignorieren */ }
    }
  }
  return normalizeJobUrl(fallback);
}

function jobObjects(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) { for (const item of value) jobObjects(item, out); return out; }
  if (!value || typeof value !== "object") return out;
  const object = value as Record<string, unknown>;
  const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  if (types.some((type) => String(type || "").toLowerCase() === "jobposting")) out.push(object);
  for (const nested of Object.values(object)) if (nested && typeof nested === "object") jobObjects(nested, out);
  return out;
}

function jsonLdJobs(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const source = match[1].trim().replace(/^<!--|-->$/g, "");
    try { jobObjects(JSON.parse(source), out); }
    catch { try { jobObjects(JSON.parse(decodeEntities(source)), out); } catch { /* Sichtbarer Text bleibt als Rückfall. */ } }
  }
  return out;
}

function objectName(value: unknown): string {
  if (typeof value === "string") return cleanText(value, 500);
  if (value && typeof value === "object") return cleanText((value as Record<string, unknown>).name, 500);
  return "";
}

function locationText(value: unknown): string {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return unique(entries.map((entry) => {
    if (typeof entry === "string") return entry;
    if (!entry || typeof entry !== "object") return "";
    const object = entry as Record<string, unknown>;
    const address = (object.address && typeof object.address === "object" ? object.address : object) as Record<string, unknown>;
    return [address.streetAddress, address.postalCode, address.addressLocality, address.addressRegion, address.addressCountry]
      .map((item) => cleanText(item, 200)).filter(Boolean).join(", ");
  })).join(" · ");
}

function listValue(...values: unknown[]): string[] {
  const raw: string[] = [];
  for (const value of values) {
    if (Array.isArray(value)) raw.push(...value.map(String));
    else if (value != null) raw.push(...cleanText(value, 8000).split(/\n|(?:\s*[•·▪]\s*)/));
  }
  return unique(raw);
}

function structuredFields(job: Record<string, unknown> | undefined): ExtractedJobFields {
  if (!job) return emptyFields();
  const organization = job.hiringOrganization as Record<string, unknown> | undefined;
  const contact = job.applicationContact || job.contactPoint;
  return {
    title: cleanText(job.title, 500) || null,
    company: objectName(organization) || null,
    location: locationText(job.jobLocation || job.applicantLocationRequirements) || (job.jobLocationType === "TELECOMMUTE" ? "Remote" : null),
    employmentType: cleanText(job.employmentType, 500) || null,
    startDate: cleanText(job.jobStartDate || job.startDate, 200) || null,
    deadline: cleanText(job.validThrough, 200) || null,
    tasks: listValue(job.responsibilities),
    requirements: listValue(job.experienceRequirements, job.educationRequirements),
    qualifications: listValue(job.qualifications, job.skills),
    contact: objectName(contact) || null,
    applicationMethod: cleanText(job.applicationInstructions || job.directApply, 1000) || null,
    companyDescription: cleanText(organization?.description, 2000) || null
  };
}

function emptyFields(): ExtractedJobFields {
  return { title:null, company:null, location:null, employmentType:null, startDate:null, deadline:null, tasks:[], requirements:[], qualifications:[], contact:null, applicationMethod:null, companyDescription:null };
}

function visiblePageText(html: string): string {
  let source = html
    .replace(/<(script|style|noscript|svg|canvas|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header|aside|dialog)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*(?:id|class)\s*=\s*["'][^"']*(?:cookie|consent|newsletter|navigation|breadcrumb|social|footer|header)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|li|h[1-6])\s*>/gi, "\n");
  source = source.replace(/<[^>]+>/g, " ");
  return cleanText(source, 40000);
}

function fillFromMeta(fields: ExtractedJobFields, html: string): ExtractedJobFields {
  const pageTitle = metaValue(html, ["og:title", "twitter:title"])
    || cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 500) || null;
  const description = metaValue(html, ["description", "og:description", "twitter:description"]);
  return {
    ...fields,
    title: fields.title || pageTitle,
    company: fields.company || metaValue(html, ["og:site_name", "application-name"]),
    companyDescription: fields.companyDescription || description
  };
}

function labelledValue(text: string, label: string): string | null {
  const match = new RegExp("(?:^|\\n)\\s*(?:" + label + ")\\s*:?\\s*(?:\\n\\s*)?([^\\n]{2,240})", "i").exec(text);
  return cleanText(match?.[1], 240) || null;
}

function fillFromVisible(fields: ExtractedJobFields, text: string): ExtractedJobFields {
  return {
    ...fields,
    location: fields.location || labelledValue(text, "Location|Standort|Arbeitsort"),
    employmentType: fields.employmentType || labelledValue(text, "Employment Type|Beschäftigungsart|Vertragsart"),
    startDate: fields.startDate || labelledValue(text, "Start Date|Beginn|Start"),
    deadline: fields.deadline || labelledValue(text, "Application Deadline|Bewerbungsfrist|Frist"),
    applicationMethod: fields.applicationMethod || (/apply now|jetzt bewerben|online bewerben/i.test(text) ? "Online über die Originalseite" : null)
  };
}
function labelled(fields: ExtractedJobFields, text: string, url: string, expired: boolean): string {
  const line = (label: string, value: string | null | string[]) => `${label}: ${Array.isArray(value) ? (value.length ? value.join(" | ") : "nicht angegeben") : value || "nicht angegeben"}`;
  return [
    "Strukturierte Angaben der Originalseite:",
    line("Stellenbezeichnung", fields.title), line("Unternehmen", fields.company), line("Standort", fields.location),
    line("Beschäftigungsart", fields.employmentType), line("Beginn", fields.startDate), line("Bewerbungsfrist", fields.deadline),
    line("Aufgaben", fields.tasks), line("Voraussetzungen", fields.requirements), line("Qualifikationen", fields.qualifications),
    line("Ansprechpartner", fields.contact), line("Bewerbungsweg", fields.applicationMethod), line("Unternehmensbeschreibung", fields.companyDescription),
    "Original-Link: " + url, "Status: " + (expired ? "Bewerbungsfrist ist abgelaufen" : "keine abgelaufene Frist erkannt"), "", "Relevanter Seiteninhalt:", text
  ].join("\n").slice(0, 24000);
}

export function extractJobPostingPage(html: string, finalUrl: string): JobPageExtraction {
  const jobs = jsonLdJobs(html);
  let fields = fillFromMeta(jobs[0] ? structuredFields(jobs[0]) : emptyFields(), html);
  const text = visiblePageText(html);
  fields = fillFromVisible(fields, text);
  const lower = `${fields.title || ""} ${text}`.toLocaleLowerCase("de");
  const signals = [
    /stellen(?:angebot|anzeige|beschreibung)|job posting|vacanc|karriere|career/,
    /aufgaben|deine rolle|ihre rolle|responsibilit/,
    /anforderungen|voraussetzungen|dein profil|ihr profil|qualifications?/,
    /bewerb(?:ung|en)|apply|application/,
    /wir suchen|stellenbezeichnung|beschäftigungsart|employment type/
  ].filter((pattern) => pattern.test(lower)).length;
  const challenge = /captcha|cloudflare|access denied|zugriff verweigert|verify you are human|unusual traffic/i.test(lower);
  const consent = text.length < 1200 && /cookie|consent|datenschutz(?:einstellungen)?|privacy preferences/i.test(lower);
  const confidence = jobs.length ? 1 : Math.min(0.9, signals / 5);
  const isJobPosting = jobs.length > 0 || (signals >= 3 && text.length >= 180);
  const obstacle = challenge ? "challenge" : consent ? "consent" : text.length < 350 ? "dynamic" : null;
  const canonicalUrl = canonicalFromHtml(html, finalUrl);
  const deadlineTime = fields.deadline ? new Date(fields.deadline).getTime() : Number.NaN;
  const expired = Number.isFinite(deadlineTime) && deadlineTime < Date.now();
  return { canonicalUrl, fields, text, analysisText: labelled(fields, text, canonicalUrl, expired), isJobPosting, confidence, obstacle, expired };
}

