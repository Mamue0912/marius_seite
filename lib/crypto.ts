import crypto from "crypto";
import { env } from "./env";

// AES-256-GCM. Format: base64(iv).base64(tag).base64(ciphertext)
// Schlüssel: 32 Byte, als base64 in TOKEN_ENC_KEY (openssl rand -base64 32).

function key(): Buffer {
  const k = Buffer.from(env.tokenEncKey(), "base64");
  if (k.length !== 32) {
    throw new Error("TOKEN_ENC_KEY muss ein 32-Byte-Schlüssel als base64 sein (openssl rand -base64 32).");
  }
  return k;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Ungültiges Chiffrat.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// HMAC-Helfer für OAuth-State & abgeleitete clientStates.
export function hmac(secret: string, value: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// PKCE
export function randomUrlSafe(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}
