"use client";
import Icon from "./Icon";
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
    try {
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined
      }
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
    } catch { setErr("Anmeldung derzeit nicht möglich. Bitte erneut versuchen."); }
    finally { setBusy(false); }
  }

  return (
    <div className="login">
      <Icon name="overview" size={28} /><h1>Willkommen im Cockpit</h1>
      <p>E-Mails, Bewerbungen und Aufgaben an einem Ort. Melde dich mit deinem persönlichen Link an.</p>
      {sent ? (
        <div className="note">Wir haben dir einen Anmelde-Link an <b>{email}</b> geschickt. Öffne ihn auf diesem Gerät.</div>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="login-email">E-Mail-Adresse</label><input id="login-email" autoComplete="email" type="email" required placeholder="deine@mail.de" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn btn-primary" disabled={busy}>{busy ? "Sende…" : "Anmelde-Link senden"}</button>
          {err && <div role="alert" className="note binding-warn" style={{ marginTop: 12 }}>{err}</div>}
        </form>
      )}
    </div>
  );
}
