/**
 * Third-party link (listing, OpenStreetMap, operator website) that may become an `href` or `src`: http(s) only.
 * Rejects `javascript:`, `data:` and similar schemes, which would run code in the app from an `href` (XSS).
 */
export function safeExternalUrl(raw: string | null | undefined, base?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw.trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
