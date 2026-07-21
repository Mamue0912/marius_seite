import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

// Service-Role-Client: NUR serverseitig verwenden. Umgeht RLS und schreibt
// Nachrichten/Tokens. Niemals im Browser importieren.
let _admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(env.supabase.url(), env.supabase.serviceKey(), {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return _admin;
}
