import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "./env";

// Auth-gebundener Server-Client (liest die Nutzer-Session aus Cookies).
// Für Route Handler / Server Components, um auth.uid() zu bestimmen.
export function supabaseServer() {
  const cookieStore = cookies();
  return createServerClient(env.supabase.url(), env.supabase.anonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // In Server Components ist set nicht immer erlaubt – Middleware übernimmt Refresh.
        }
      }
    }
  });
}

export async function requireUser() {
  const supabase = supabaseServer();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user;
}
