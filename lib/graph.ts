import { GRAPH } from "./env";

export class GraphError extends Error {
  status: number;
  retryAfterMs?: number;
  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// GET gegen Graph. Nimmt einen absoluten Link (z. B. @odata.nextLink/deltaLink)
// oder einen Pfad ab /v1.0. Wirft GraphError bei 401 (Token) und 429 (Rate-Limit).
export async function graphGet<T = any>(accessToken: string, urlOrPath: string): Promise<T> {
  const url = urlOrPath.startsWith("http") ? urlOrPath : `${GRAPH}${urlOrPath}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  if (res.status === 429 || res.status === 503) {
    const ra = parseInt(res.headers.get("retry-after") || "5", 10);
    throw new GraphError(res.status, "Graph rate-limited/unavailable", ra * 1000);
  }
  if (res.status === 401) throw new GraphError(401, "Graph 401 – Access-Token abgelaufen/ungültig");
  if (!res.ok) throw new GraphError(res.status, `Graph ${res.status}: ${await safeText(res)}`);
  return (await res.json()) as T;
}

export async function graphPost<T = any>(accessToken: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new GraphError(res.status, `Graph POST ${res.status}: ${await safeText(res)}`);
  return (await res.json()) as T;
}

export async function graphPatch<T = any>(accessToken: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new GraphError(res.status, `Graph PATCH ${res.status}: ${await safeText(res)}`);
  return (await res.json()) as T;
}

export async function graphDelete(accessToken: string, path: string): Promise<void> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok && res.status !== 404) throw new GraphError(res.status, `Graph DELETE ${res.status}`);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}
