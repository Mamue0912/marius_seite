# Outlook Live Sync — Setup

Live-Synchronisierung eines Outlook-Postfachs ins Cockpit über **Microsoft Graph**
(OAuth + Delta-Queries + Change-Notifications/Webhooks), mit **Supabase**
(Postgres, Realtime, Auth) und **Next.js/Vercel**.

> **Wichtig:** Dieses Projekt kann in dieser Entwicklungsumgebung **nicht** end-to-end
> getestet werden — Webhooks brauchen einen öffentlichen HTTPS-Endpunkt, und es
> werden echte Azure-, Supabase- und Vercel-Ressourcen benötigt. Die folgenden
> Schritte richten alles produktiv ein.

## Architektur

```
Outlook ──Graph Webhook──▶ /api/webhooks/microsoft-graph ──▶ runDelta() ──▶ Supabase (messages)
   ▲                                                                              │ Realtime
   └──────────── OAuth (MSAL/Graph) ◀── /api/auth/microsoft ──── Cockpit ◀────────┘
Cron: /api/cron/renew-subscriptions (Abo-Verlängerung), /api/cron/delta-fallback (Sicherheitsnetz)
```

- **Webhook** = unmittelbarer Auslöser. Das Payload wird **nicht** als Datenquelle
  vertraut — es löst nur eine **Delta-Query** aus, die den echten Stand lädt.
- **Delta-Query** speichert einen `deltaLink` pro Ordner → beim nächsten Mal nur Änderungen.
- **Fallback-Cron** (alle 3 Min.) holt Änderungen nach, falls längere Zeit kein Webhook kam.
- **Realtime** pusht DB-Änderungen ohne Reload ins offene Cockpit (RLS: nur eigene Zeilen).

## 1. Microsoft Entra / Azure App-Registrierung

1. [Azure-Portal](https://portal.azure.com) → **Microsoft Entra ID → App registrations → New registration**.
2. **Supported account types:** „Accounts in any organizational directory and personal Microsoft accounts" (= Authority `common`; erlaubt outlook.com/hotmail/live **und** Arbeits-/Schulkonten).
3. **Redirect URI** (Web): `https://DEINE-DOMAIN/api/auth/microsoft/callback`
   (lokal zusätzlich die Tunnel-URL, siehe unten).
4. **Certificates & secrets → New client secret** → Wert kopieren → `MS_CLIENT_SECRET`.
5. **Application (client) ID** → `MS_CLIENT_ID`.
6. **API permissions → Microsoft Graph → Delegated:** `openid`, `profile`,
   `offline_access`, `User.Read`, `Mail.Read`. (Für Entwürfe/Antworten zusätzlich
   `Mail.ReadWrite`; für Versand `Mail.Send` — siehe EMAIL_REPLY_ASSISTANT_SETUP.md.)
   Nur die tatsächlich benötigten Rechte anfordern.

## 2. Supabase

1. Projekt erstellen. **Project URL** und **anon key** → `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`
   (nur serverseitig!).
2. **SQL Editor** → Inhalt von `supabase/schema.sql` ausführen (Tabellen, RLS, Realtime).
3. **Auth → Email** aktivieren (Magic Link). Redirect-URL der App eintragen.

## 3. Umgebungsvariablen

Alle Werte aus `.env.example` in Vercel (Project → Settings → Environment Variables)
bzw. lokal in `.env.local` eintragen. Secrets zum Verschlüsseln erzeugen:

```
openssl rand -base64 32   # TOKEN_ENC_KEY
openssl rand -hex 32      # OAUTH_STATE_SECRET, CRON_SECRET, GRAPH_CLIENT_STATE (je einzeln)
```

`APP_BASE_URL` = die öffentliche Basis-URL (Prod-Domain bzw. Tunnel-URL lokal).

## 4. Deployment (Vercel)

1. Repo in Vercel importieren (Framework: Next.js).
2. Env-Variablen setzen. `CRON_SECRET` setzen — Vercel sendet ihn automatisch als
   `Authorization: Bearer` an die Cron-Routen.
3. Deploy. `vercel.json` registriert die Crons:
   - `/api/cron/renew-subscriptions` alle 30 Min. (Abo-Verlängerung/-Neuanlage)
   - `/api/cron/delta-fallback` alle 3 Min. (Sicherheitsnetz)
4. Cockpit öffnen → anmelden → **„Outlook verbinden"**. Nach dem OAuth-Callback
   laufen Erstsync (Delta für Inbox + Gesendet) und Abo-Erstellung automatisch.

## 5. Lokale Entwicklung

Webhooks erreichen **keinen** reinen `localhost`. Für lokale Tests einen sicheren
Tunnel verwenden:

```
cloudflared tunnel --url http://localhost:3000
# oder: ngrok http 3000
```

Die Tunnel-URL als `APP_BASE_URL` setzen **und** als zusätzliche Redirect-URI in
der Azure-App eintragen. Tunnel-URLs sind flüchtig — **nicht** als Produktions-
konfiguration speichern.

## Datenmodell (Auszug)

`messages`: interne ID, `user_id`, `graph_id` (stabile Nachrichten-ID, dedupe),
`conversation_id`, `internet_message_id`, `folder`, Absender/Empfänger, Betreff,
Vorschau, Empfangs-/Sendezeit, gelesen, Wichtigkeit, `needs_reply`, `deadline_at`,
`detected_task`, `category`, `status`, `web_link`, `last_modified_at`,
`last_synced_at`, `hidden`, `is_deleted`. Vollständige Inhalte/Anhänge werden
**nicht** dauerhaft gespeichert.

## Abonnementverwaltung

- `graph_subscriptions` speichert Subscription-ID, `client_state`, `expires_at`.
- Message-Abos laufen ~4230 Min. — Cron verlängert deutlich vor Ablauf, legt
  verlorene neu an, verarbeitet **Lifecycle-Notifications** (reauthorizationRequired,
  subscriptionRemoved) im Webhook-Endpunkt.

## Absicherung gegen verpasste Änderungen

1. Webhook als Auslöser → 2. Delta-Query lädt echte Änderungen → 3. Fallback-Cron
   (alle 3 Min., wenn seit `FALLBACK_DELTA_MINUTES` kein Webhook kam) → 4. Beim
   Öffnen/„Aktualisieren" wird ebenfalls Delta geladen (nur Änderungen).

## Sicherheit

- Access-/Refresh-Tokens **AES-256-GCM-verschlüsselt** in `ms_accounts`, nur über
  den Service-Role-Key erreichbar (keine RLS-Policy für den Client → unlesbar).
- **OAuth-State + PKCE** (httpOnly-Cookie) gegen CSRF.
- **Webhook:** Validierungs-Token wird als `text/plain` zurückgegeben; `clientState`
  wird streng geprüft; Idempotenz über `processed_notifications`; schnelle 202-Antwort;
  keine Secrets in Logs.
- **Minimale Berechtigungen**; nur Lesezugriff (Sync). Keine öffentliche E-Mail-API.
- **Trennen** (`/api/auth/microsoft/disconnect`) löscht Abos, Tokens und Nachrichten.

## Webhook-Endpunkt

`POST /api/webhooks/microsoft-graph`
1. Validierungsanfrage (`?validationToken=`) → Token unverändert als `text/plain`.
2. Echte Benachrichtigung → `clientState` prüfen → dedupe → `sync_state.last_webhook_at`
   setzen → `runDelta(account, folder)` → **202** zurück.
3. Lifecycle-Events → Abo neu anlegen/erneuern.

> Für hohe Last: die inline-Verarbeitung durch eine Queue ersetzen (z. B. Vercel
> Queue / QStash / Supabase Edge Function) — der Endpunkt antwortet dann sofort mit
> 202 und verarbeitet asynchron.

## Fehlerbehandlung

- Abgelaufenes Access-Token → automatische Erneuerung via Refresh-Token; bei
  `invalid_grant` → Kontostatus `needs_reauth`, Cockpit zeigt „Outlook neu verbinden".
- Rate-Limit (429) / vorübergehende Fehler → `GraphError` mit `retryAfterMs`.
- Verschobene/gelöschte Nachricht → Delta liefert `@removed` → `is_deleted=true`.
- Bei Fehlern zeigt das Cockpit den zuletzt bekannten Stand + Statuspille
  („Verbindung unterbrochen").

## Getestete Fälle

Der Code deckt die geforderten Fälle strukturell ab (neue Mail, mehrere Mails,
gelesen/ungelesen, gelöscht, verschoben, gesendete Antwort, doppelte Benachrichtigung,
abgelaufenes Token/Abo, Serverausfall + Delta-Recovery, Desktop/Mobil, Update ohne
Reload). **End-to-End getestet wurde nichts**, da dafür deine Azure-/Supabase-/Vercel-
Instanz und ein echtes Postfach nötig sind.

## Typische Verzögerung Outlook → Cockpit

Mit Webhooks üblicherweise **wenige Sekunden** (Benachrichtigung → Delta →
DB-Insert → Realtime → UI). Fällt der Webhook aus, greift spätestens nach
`FALLBACK_DELTA_MINUTES` (Standard 5 Min.) die Delta-Kontrolle.
