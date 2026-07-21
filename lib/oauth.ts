import { env } from "./env";

// Raw OAuth 2.0 (Authorization Code + PKCE) gegen Microsoft identity platform.
// authority = common → private (outlook.com/hotmail/live) UND Arbeits-/Schulkonten.

function authBase(): string {
  return `https://login.microsoftonline.com/${env.ms.tenant()}/oauth2/v2.0`;
}
function redirectUri(): string {
  return env.appBaseUrl() + env.ms.redirectPath();
}

export function buildAuthUrl(state: string, codeChallenge: string): string {
  const p = new URLSearchParams({
    client_id: env.ms.clientId(),
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: env.ms.scopes(),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account"
  });
  return `${authBase()}/authorize?${p.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${authBase()}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.ms.clientId(),
      client_secret: env.ms.clientSecret(),
      ...body
    }).toString()
  });
  const json = await res.json();
  if (!res.ok) {
    // invalid_grant → Refresh-Token ungültig; wird oben als needs_reauth behandelt.
    const err = new Error(`OAuth-Fehler: ${json.error || res.status}`) as Error & { oauthError?: string };
    err.oauthError = json.error;
    throw err;
  }
  return json as TokenResponse;
}

export function exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: codeVerifier,
    scope: env.ms.scopes()
  });
}

export function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: env.ms.scopes()
  });
}
