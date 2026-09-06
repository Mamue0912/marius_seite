export function safeInternalPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const base = new URL("https://cockpit.invalid");
    const target = new URL(value, base);
    if (target.origin !== base.origin) return fallback;
    return target.pathname + target.search + target.hash;
  } catch {
    return fallback;
  }
}