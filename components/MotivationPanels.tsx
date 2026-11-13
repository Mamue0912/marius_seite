"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { notify } from "@/components/Feedback";
import { api } from "@/lib/motivationStore";

// =====================================================================
//  Erfahrungen (Personal Evidence Database)
// =====================================================================

const STATUS_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: "CONFIRMED", label: "Belegt", hint: "Durch eine Unterlage nachweisbar." },
  { key: "USER_REPORTED", label: "Selbst berichtet", hint: "Stimmt, ist aber nicht extra belegt." },
  { key: "PLANNED", label: "Geplant", hint: "Steht noch bevor. Wird nie als Erfahrung dargestellt." },
  { key: "INFERRED", label: "Vermutet", hint: "Unsicher. Kommt nicht in den Text." },
  { key: "UNKNOWN", label: "Unbekannt", hint: "Kommt nicht in den Text." }
];

const VALUE_KEYS = [
  { key: "excellence", label: "Excellence" },
  { key: "entrepreneurship", label: "Entrepreneurship" },
  { key: "community", label: "Community" },
  { key: "cosmopoliteness", label: "Cosmopoliteness" },
  { key: "courage_commitment", label: "Courage & Commitment" }
];

const FIELDS: { k: string; label: string; hint?: string }[] = [
  { k: "situation", label: "Ausgangssituation" },
  { k: "challenge", label: "Herausforderung" },
  { k: "decision", label: "Meine Entscheidung" },
  { k: "action", label: "Mein Handeln" },
  { k: "result", label: "Überprüfbares Ergebnis" },
  { k: "learning", label: "Was ich daraus gelernt habe" },
  { k: "businessLink", label: "Bezug zu wirtschaftlichen Themen" }
];

export function EvidenceStep({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [gaps, setGaps] = useState<any[]>([]);
  const [contradictions, setContradictions] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [suggestions, setSuggestions] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    const r = await api("/api/motivation/evidence");
    if (r.ok) {
      setItems(r.data.items || []);
      setGaps(r.data.gaps || []);
      setContradictions(r.data.contradictions || []);
      setSelected(r.data.selected || []);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(item: any) {
    setBusy("save");
    const r = await api("/api/motivation/evidence", { method: "PUT", json: item });
    setBusy(null);
    if (!r.ok) { notify(r.message || "Speichern fehlgeschlagen.", true); return; }
    setEdit(null);
    await load();
    onChanged?.();
    notify("Erfahrung gespeichert.");
  }

  async function remove(id: string) {
    if (!confirm("Diese Erfahrung löschen?")) return;
    const r = await api(`/api/motivation/evidence?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) { notify(r.message || "Löschen fehlgeschlagen.", true); return; }
    await load();
    onChanged?.();
  }

  async function suggest() {
    setBusy("suggest");
    const r = await api("/api/motivation/evidence", { method: "POST", timeoutMs: 60000 });
    setBusy(null);
    if (!r.ok) { notify(r.message || "Vorschläge fehlgeschlagen.", true); return; }
    setSuggestions(r.data.suggestions || []);
    if (!r.data.suggestions?.length) notify("Aus den Unterlagen ließ sich nichts Zusätzliches ableiten.");
  }

  if (loading) return <section className="ms-sec"><div className="ac-empty"><span className="spin" /></div></section>;

  return (
    <section className="ms-sec">
      <h3>Deine Erfahrungen</h3>
      <p className="ms-lead">
        Die Grundlage des Schreibens. Jede Erfahrung hat einen Status – er entscheidet, ob und wie sie
        im Text erscheinen darf. Geplantes wird nie als Erlebtes dargestellt, Vermutetes gar nicht verwendet.
      </p>

      <div className="ms-actions left">
        <button className="ac-btn" onClick={suggest} disabled={busy === "suggest"}>
          {busy === "suggest" ? <><span className="spin sm" /> Unterlagen werden gelesen…</> : "Aus meinen Unterlagen vorschlagen"}
        </button>
        <button className="ac-btn" onClick={() => setEdit({ title: "", status: "USER_REPORTED", valueKeys: [] })}>
          + Erfahrung von Hand
        </button>
      </div>

      {contradictions.length > 0 && (
        <div className="ms-gap">
          <b>Widersprüche in deinen Angaben:</b>
          <ul>{contradictions.map((c: any, i: number) => <li key={i}>{c.message}</li>)}</ul>
        </div>
      )}

      {suggestions && (
        <div className="ms-changes">
          <h4>Vorschläge aus den Unterlagen ({suggestions.length})</h4>
          <div className="ms-hint">Nichts wird automatisch übernommen. Prüfe den Status, bevor du speicherst.</div>
          {suggestions.map((s: any, i: number) => (
            <div key={i} className="ms-change">
              <div className="ms-change-h">
                <span>{s.title}</span>
                <span className="ms-change-r">{STATUS_OPTIONS.find((o) => o.key === s.status)?.label || s.status}{s.source ? ` · ${s.source}` : ""}</span>
              </div>
              {s.situation && <p style={{ margin: "0 0 8px", fontSize: 13.5 }}>{s.situation}</p>}
              <button className="ac-btn tiny" onClick={() => { setEdit({ ...s, valueKeys: [] }); setSuggestions(suggestions.filter((_, j) => j !== i)); }}>
                Übernehmen und ergänzen
              </button>
            </div>
          ))}
          <button className="ac-btn tiny" onClick={() => setSuggestions(null)}>Vorschläge schließen</button>
        </div>
      )}

      {items.length === 0 && !edit && (
        <div className="ms-gap">Noch keine Erfahrungen hinterlegt. Am schnellsten geht es über „Aus meinen Unterlagen vorschlagen“.</div>
      )}

      {items.map((it: any) => {
        const gap = gaps.find((g: any) => g.id === it.id);
        const ready = selected.includes(it.title);
        return (
          <div key={it.id} className={"ms-ev" + (ready ? " ready" : "")}>
            <div className="ms-ev-h">
              <span className="ms-ev-t">{it.title}{it.period ? ` · ${it.period}` : ""}</span>
              <span className={"ms-badge s-" + it.status}>{STATUS_OPTIONS.find((o) => o.key === it.status)?.label || it.status}</span>
              {ready && <span className="ms-badge ready">Für den Text ausgewählt</span>}
            </div>
            {it.situation && <p className="ms-ev-p">{it.situation}</p>}
            {gap?.missing?.length > 0 && (
              <div className="ms-hint">Noch offen: {gap.missing.join(", ")}</div>
            )}
            <div className="ms-para-a">
              <button className="ac-btn tiny" onClick={() => setEdit({ ...it })}>Bearbeiten</button>
              <button className="ac-btn tiny" onClick={() => remove(it.id)}>Löschen</button>
            </div>
          </div>
        );
      })}

      {edit && (
        <div className="ac-modal-scrim" onClick={() => setEdit(null)}>
          <div className="ac-modal ms-compare" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Erfahrung bearbeiten">
            <div className="ac-modal-h"><h3>{edit.id ? "Erfahrung bearbeiten" : "Neue Erfahrung"}</h3></div>
            <div className="ac-modal-b">
              <div className="ms-grid">
                <label className="ms-field"><span className="ms-label">Titel</span>
                  <input value={edit.title || ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
                <label className="ms-field"><span className="ms-label">Zeitraum</span>
                  <input value={edit.period || ""} onChange={(e) => setEdit({ ...edit, period: e.target.value })} placeholder="z. B. seit 2023" /></label>
                <label className="ms-field wide"><span className="ms-label">Rolle und tatsächliche Verantwortung</span>
                  <input value={edit.role || ""} onChange={(e) => setEdit({ ...edit, role: e.target.value })} /></label>
                <label className="ms-field wide">
                  <span className="ms-label">Faktenstatus</span>
                  <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                    {STATUS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  <span className="ms-hint">{STATUS_OPTIONS.find((o) => o.key === edit.status)?.hint}</span>
                </label>
                {FIELDS.map((f) => (
                  <label key={f.k} className="ms-field wide">
                    <span className="ms-label">{f.label}</span>
                    <textarea rows={2} value={edit[f.k] || ""} onChange={(e) => setEdit({ ...edit, [f.k]: e.target.value })} />
                  </label>
                ))}
                <div className="ms-field wide">
                  <span className="ms-label">Mögliche Wertebezüge (nur ankreuzen, wenn eine Handlung das wirklich zeigt)</span>
                  <div className="ms-para-a">
                    {VALUE_KEYS.map((v) => {
                      const on = (edit.valueKeys || []).includes(v.key);
                      return (
                        <button key={v.key} type="button" className={"ac-btn tiny" + (on ? " primary" : "")}
                          onClick={() => setEdit({
                            ...edit,
                            valueKeys: on ? (edit.valueKeys || []).filter((k: string) => k !== v.key) : [...(edit.valueKeys || []), v.key]
                          })}>{v.label}</button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            <div className="ac-modal-f">
              <button className="ac-btn primary" onClick={() => save(edit)} disabled={!String(edit.title || "").trim() || busy === "save"}>
                {busy === "save" ? "Wird gespeichert…" : "Speichern"}
              </button>
              <button className="ac-btn" onClick={() => setEdit(null)}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// =====================================================================
//  Gespräch (dynamische Rückfragen)
// =====================================================================

export function InterviewStep({ letterId, onChanged }: { letterId: string; onChanged?: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [progress, setProgress] = useState<any>({ total: 0, answered: 0, skipped: 0, open: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [enough, setEnough] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await api(`/api/motivation/interview?letter=${encodeURIComponent(letterId)}`);
    if (r.ok) {
      setRows(r.data.rows || []);
      setProgress(r.data.progress || {});
      const d: Record<string, string> = {};
      for (const row of r.data.rows || []) if (row.answer) d[row.question_key] = row.answer;
      setDrafts(d);
    }
  }, [letterId]);
  useEffect(() => { void load(); }, [load]);

  async function more() {
    setBusy("more"); setEnough(null);
    const r = await api("/api/motivation/interview", { method: "POST", json: { letterId }, timeoutMs: 60000 });
    setBusy(null);
    if (!r.ok) { notify(r.message || "Es konnten keine Fragen erzeugt werden.", true); return; }
    if (r.data.enough) { setEnough(r.data.reason || "Es liegt genug Material vor."); return; }
    await load();
  }

  async function answer(key: string, skip = false) {
    setBusy(key);
    const r = await api("/api/motivation/interview", {
      method: "PATCH", json: { questionKey: key, answer: drafts[key] || "", skip, letterId }
    });
    setBusy(null);
    if (!r.ok) { notify(r.message || "Speichern fehlgeschlagen.", true); return; }
    await load();
    onChanged?.();
  }

  const open = rows.filter((r) => r.state === "offen");
  const done = rows.filter((r) => r.state !== "offen");

  return (
    <section className="ms-sec">
      <h3>Gespräch</h3>
      <p className="ms-lead">
        Ein paar gezielte Fragen, damit der Text nicht bei Allgemeinplätzen bleibt. Höchstens drei auf einmal,
        jede überspringbar. Es wird nie nach etwas gefragt, das schon bekannt ist.
      </p>

      {progress.total > 0 && (
        <div className="ms-progress">
          <div className="ms-progress-bar">
            <span style={{ width: `${Math.round((progress.answered / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <span className="ms-counts">{progress.answered} beantwortet · {progress.skipped} übersprungen · {progress.open} offen</span>
        </div>
      )}

      <div className="ms-actions left">
        <button className="ac-btn primary" onClick={more} disabled={busy === "more"}>
          {busy === "more" ? <><span className="spin sm" /> Fragen werden überlegt…</> : open.length ? "Weitere Fragen" : "Gespräch starten"}
        </button>
      </div>
      {enough && <div className="ms-srcinfo">{enough}</div>}

      {open.map((q) => (
        <div key={q.question_key} className="ms-q">
          <div className="ms-q-t">{q.question}</div>
          {q.targets && <div className="ms-hint">Bezieht sich auf: {q.targets}</div>}
          <textarea rows={3} className="ms-editor" style={{ minHeight: 90, marginTop: 8 }}
            value={drafts[q.question_key] || ""}
            onChange={(e) => setDrafts({ ...drafts, [q.question_key]: e.target.value })}
            aria-label={q.question} />
          <div className="ms-para-a">
            <button className="ac-btn tiny primary" onClick={() => answer(q.question_key)}
              disabled={!(drafts[q.question_key] || "").trim() || busy === q.question_key}>Antwort speichern</button>
            <button className="ac-btn tiny" onClick={() => answer(q.question_key, true)} disabled={busy === q.question_key}>Überspringen</button>
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <>
          <h4>Bereits beantwortet</h4>
          {done.map((q) => (
            <div key={q.question_key} className="ms-q">
              <div className="ms-q-t">{q.question}</div>
              <div className="ms-hint">{q.state === "uebersprungen" ? "Übersprungen" : "Beantwortet"}</div>
              <textarea rows={2} className="ms-editor" style={{ minHeight: 70, marginTop: 8 }}
                value={drafts[q.question_key] || ""}
                onChange={(e) => setDrafts({ ...drafts, [q.question_key]: e.target.value })}
                aria-label={q.question} />
              <button className="ac-btn tiny" onClick={() => answer(q.question_key)} disabled={busy === q.question_key}>
                Antwort ändern
              </button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

// =====================================================================
//  Bewertung, Faktencheck, Interview-Vorbereitung
// =====================================================================

export function ReviewPanel({ letterId, body }: { letterId: string; body: string }) {
  const [review, setReview] = useState<any>(null);
  const [facts, setFacts] = useState<any>(null);
  const [prep, setPrep] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(kind: "review" | "factcheck" | "prep") {
    setBusy(kind);
    const url = kind === "prep" ? "/api/motivation/interview-prep" : "/api/motivation/review";
    const json: any = kind === "prep" ? { letterId, body } : { letterId, body, mode: kind === "factcheck" ? "factcheck" : "review" };
    const r = await api(url, { json, timeoutMs: 60000 });
    setBusy(null);
    if (!r.ok) { notify(r.message || "Die Prüfung ist fehlgeschlagen.", true); return; }
    if (kind === "review") setReview(r.data);
    else if (kind === "factcheck") setFacts(r.data);
    else setPrep(r.data);
  }

  return (
    <>
      <h4>Kritische Bewertung</h4>
      <div className="ms-actions left">
        <button className="ac-btn" onClick={() => run("review")} disabled={busy === "review" || !body.trim()}>
          {busy === "review" ? <><span className="spin sm" /> Wird bewertet…</> : "Text bewerten lassen"}
        </button>
        <button className="ac-btn" onClick={() => run("factcheck")} disabled={busy === "factcheck" || !body.trim()}>
          {busy === "factcheck" ? <><span className="spin sm" /> Prüft Fakten…</> : "Faktencheck"}
        </button>
        <button className="ac-btn" onClick={() => run("prep")} disabled={busy === "prep" || !body.trim()}>
          {busy === "prep" ? <><span className="spin sm" /> Fragen werden erzeugt…</> : "Interview-Vorbereitung"}
        </button>
      </div>

      {review && (
        <>
          {review.summary && <div className="ms-srcinfo" style={{ background: "var(--surface-2)", borderColor: "var(--line-2)", color: "var(--ink-2)" }}>{review.summary}</div>}
          <div className="ms-rubric">
            {review.scores?.map((s: any) => (
              <div key={s.key} className="ms-rub-row">
                <span className="ms-rub-l">{s.label}</span>
                <span className="ms-rub-bar"><span style={{ width: `${s.score * 10}%` }} className={s.score < 6 ? "low" : s.score < 8 ? "mid" : "high"} /></span>
                <span className="ms-rub-n">{s.score}/10</span>
              </div>
            ))}
          </div>
          <div className="ms-hint">{review.disclaimer}</div>

          {review.scores?.filter((s: any) => s.score < 8).map((s: any) => (
            <div key={s.key} className="ms-change">
              <div className="ms-change-h"><span>{s.label} · {s.score}/10</span></div>
              <p style={{ margin: "0 0 6px", fontSize: 13.5 }}>{s.justification}</p>
              {s.quote && <p className="ms-quote">„{s.quote}“</p>}
              {s.suggestion && <p style={{ margin: 0, fontSize: 13.5 }}><b>Vorschlag:</b> {s.suggestion}</p>}
            </div>
          ))}

          {review.compliance?.length > 0 && (
            <>
              <h4>Pflichtprüfung</h4>
              <ul className="ms-checklist">
                {review.compliance.map((c: any, i: number) => (
                  <li key={i} className={c.status}>
                    <span className="ms-ck-ic">{c.status === "ok" ? "✓" : c.status === "fehlt" ? "✕" : "•"}</span>
                    <span><b>{c.label}</b>{c.hint ? <> – {c.hint}</> : null}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {review.generic?.length > 0 && (
            <>
              <h4>Austauschbare Sätze</h4>
              <div className="ms-hint">Diese Sätze könnten in jeder Bewerbung stehen. Ersetze sie durch eine konkrete Einzelheit.</div>
              <ul className="ms-checklist">
                {review.generic.map((g: any, i: number) => (
                  <li key={i} className="fehlt"><span className="ms-ck-ic">!</span>
                    <span><i>„{g.sentence}“</i></span></li>
                ))}
              </ul>
            </>
          )}

          {review.depth?.message && <div className="ms-gap"><b>Datenlage:</b> {review.depth.message}</div>}

          {review.style?.length > 0 && (
            <>
              <h4>Sprachliche Auffälligkeiten</h4>
              <ul className="ms-checklist">
                {review.style.map((s: any, i: number) => (
                  <li key={i} className="manuell"><span className="ms-ck-ic">•</span>
                    <span><b>„{s.phrase}“</b> ({s.count}×) – {s.hint}</span></li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {facts && (
        <>
          <h4>Faktencheck</h4>
          {facts.verdict && <div className="ms-srcinfo" style={{ background: "var(--surface-2)", borderColor: "var(--line-2)", color: "var(--ink-2)" }}>{facts.verdict}</div>}
          <ul className="ms-checklist">
            {(facts.claims || []).map((c: any, i: number) => (
              <li key={i} className={c.status === "belegt" ? "ok" : "fehlt"}>
                <span className="ms-ck-ic">{c.status === "belegt" ? "✓" : "✕"}</span>
                <span><b>{c.claim}</b><br />{c.status === "belegt" ? "Belegt" : c.status === "falsch_dargestellt" ? "Falsch dargestellt" : "Nicht belegt"} – {c.note}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {prep && (
        <>
          <h4>Mögliche Fragen im Auswahlgespräch</h4>
          {prep.verdict && <div className="ms-srcinfo" style={{ background: "var(--surface-2)", borderColor: "var(--line-2)", color: "var(--ink-2)" }}>{prep.verdict}</div>}
          <ul className="ms-checklist">
            {(prep.probes || []).map((p: any, i: number) => (
              <li key={i} className={p.risk === "hoch" ? "fehlt" : "manuell"}>
                <span className="ms-ck-ic">{p.risk === "hoch" ? "!" : "?"}</span>
                <span><b>{p.question}</b><br />Anlass: {p.basis}</span>
              </li>
            ))}
          </ul>
          {prep.weakSpots?.length > 0 && (
            <div className="ms-gap">
              <b>Hier könnte es im Gespräch dünn werden:</b>
              <ul>{prep.weakSpots.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </>
  );
}
