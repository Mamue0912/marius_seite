import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function privateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

export function isPrivateAddress(raw: string): boolean {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (isIP(address) === 4) return privateIpv4(address);
  if (isIP(address) !== 6) return true;
  if (address === "::" || address === "::1") return true;
  if (address.startsWith("::ffff:")) return privateIpv4(address.slice(7));
  const first = parseInt(address.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (address.startsWith("2001:db8:")) return true;
  return false;
}

function normalizedHostname(input: string): string {
  const value = input.trim();
  if (!value || /[\s/@]/.test(value)) throw new Error("invalid_remote_host");
  const literal = value.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  let hostname: string;
  if (isIP(literal)) {
    hostname = literal;
  } else {
    try {
      const parsed = new URL("http://" + value);
      if (parsed.port) throw new Error("invalid_remote_host");
      hostname = parsed.hostname;
    } catch {
      throw new Error("invalid_remote_host");
    }
  }
  hostname = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("private_remote_host");
  }
  return hostname;
}

async function publicAddresses(input: string): Promise<{ hostname: string; addresses: Array<{ address: string; family: number }> }> {
  const hostname = normalizedHostname(input);
  const literal = isIP(hostname);
  const addresses = literal
    ? [{ address: hostname, family: literal }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("private_remote_host");
  }
  return { hostname, addresses };
}

export async function resolvePublicNetworkEndpoint(input: string): Promise<{ address: string; family: number; hostname: string; servername?: string }> {
  const { hostname, addresses } = await publicAddresses(input);
  const selected = addresses[0];
  return {
    address: selected.address,
    family: selected.family,
    hostname,
    servername: isIP(hostname) ? undefined : hostname
  };
}

export async function assertPublicNetworkHost(input: string): Promise<string> {
  return (await resolvePublicNetworkEndpoint(input)).hostname;
}

export async function assertPublicHttpUrl(input: string | URL): Promise<URL> {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input) : new URL(input);
  } catch {
    throw new Error("invalid_remote_url");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid_remote_url");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("invalid_remote_port");
  await publicAddresses(url.hostname);
  return url;
}

async function requestPinned(url: URL, init: RequestInit): Promise<Response> {
  const { hostname, addresses } = await publicAddresses(url.hostname);
  const selected = addresses[0];
  if (init.body) throw new Error("remote_request_body_not_supported");
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const options: RequestOptions = {
    protocol: url.protocol,
    hostname,
    port: url.port || undefined,
    path: url.pathname + url.search,
    method: init.method || "GET",
    headers,
    signal: init.signal || undefined,
    lookup: ((_hostname: string, options: unknown, callback: (...args: any[]) => void) => {
      if (options && typeof options === "object" && (options as { all?: boolean }).all) {
        callback(null, [{ address: selected.address, family: selected.family }]);
      } else {
        callback(null, selected.address, selected.family);
      }
    }) as any
  };
  return await new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(options, (incoming) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
        else if (value != null) responseHeaders.set(name, String(value));
      }
      const body = incoming.statusCode === 204 || incoming.statusCode === 304
        ? null
        : (Readable.toWeb(incoming) as unknown as BodyInit);
      resolve(new Response(body, {
        status: incoming.statusCode || 500,
        statusText: incoming.statusMessage,
        headers: responseHeaders
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

export async function fetchPublicResource(input: string | URL, init: RequestInit = {}, maxRedirects = 3): Promise<Response> {
  let target = await assertPublicHttpUrl(input);
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const response = await requestPinned(target, init);
    if (!REDIRECTS.has(response.status)) {
      response.headers.set("x-cockpit-final-url", target.toString());
      return response;
    }
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirect === maxRedirects) throw new Error("too_many_redirects");
    target = await assertPublicHttpUrl(new URL(location, target));
  }
  throw new Error("too_many_redirects");
}

export async function readBodyLimited(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function readTextLimited(response: Response, maxBytes: number): Promise<string | null> {
  const body = await readBodyLimited(response, maxBytes);
  if (!body) return null;
  const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(response.headers.get("content-type") || "")?.[1] || "utf-8";
  try { return new TextDecoder(charset).decode(body); }
  catch { return body.toString("utf8"); }
}
