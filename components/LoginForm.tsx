"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

// Sichere Benutzeranmeldung via Supabase (Magic Link). Datentrennung über RLS.
export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined }
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <div className="login">
      <h1>Cockpit</h1>
      <p>Melde dich an, um dein Live-Outlook-Postfach und den Antwort-Assistenten zu nutzen.</p>
      {sent ? (
        <div className="note">Wir haben dir einen Anmelde-Link an <b>{email}</b> geschickt. Öffne ihn auf diesem Gerät.</div>
      ) : (
        <form onSubmit={submit}>
          <input type="email" required placeholder="deine@mail.de" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn btn-primary" disabled={busy}>{busy ? "Sende…" : "Anmelde-Link senden"}</button>
          {err && <div className="note binding-warn" style={{ marginTop: 12 }}>{err}</div>}
        </form>
      )}
    </div>
  );
}
