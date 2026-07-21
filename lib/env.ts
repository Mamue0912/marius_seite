// Zentrale, typisierte Umgebungsvariablen. Wirft früh und deutlich,
// wenn etwas fehlt – aber nur serverseitig (public-Werte sind im Client ok).

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Fehlende Umgebungsvariable: ${name}`);
  return v;
}
function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  appBaseUrl: () => req("APP_BASE_URL").replace(/\/$/, ""),
  ms: {
    clientId: () => req("MS_CLIENT_ID"),
    clientSecret: () => req("MS_CLIENT_SECRET"),
    tenant: () => opt("MS_TENANT", "common"),
    redirectPath: () => opt("MS_REDIRECT_PATH", "/api/auth/microsoft/callback"),
    // Mail.ReadWrite wird für echte Outlook-Entwürfe benötigt; Mail.Send NUR,
    // wenn der Versand ausdrücklich aktiviert ist (ENABLE_SEND=true).
    scopes: () => {
      const base = "openid profile offline_access User.Read Mail.Read Mail.ReadWrite";
      return opt("ENABLE_SEND") === "true" ? base + " Mail.Send" : base;
    }
  },
  enableSend: () => opt("ENABLE_SEND") === "true",
  anthropicKey: () => req("ANTHROPIC_API_KEY"),
  anthropicModel: () => opt("ANTHROPIC_MODEL", "claude-opus-4-8"),
  supabase: {
    url: () => req("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: () => req("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceKey: () => req("SUPABASE_SERVICE_ROLE_KEY")
  },
  tokenEncKey: () => req("TOKEN_ENC_KEY"),
  oauthStateSecret: () => req("OAUTH_STATE_SECRET"),
  cronSecret: () => req("CRON_SECRET"),
  graphClientState: () => req("GRAPH_CLIENT_STATE"),
  fallbackDeltaMinutes: () => parseInt(opt("FALLBACK_DELTA_MINUTES", "5"), 10)
};

export const GRAPH = "https://graph.microsoft.com/v1.0";
export const FOLDERS = ["inbox", "sentitems"] as const;
export type Folder = (typeof FOLDERS)[number];
