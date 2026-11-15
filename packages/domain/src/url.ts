/**
 * Link vindo de fora (anúncio, OpenStreetMap, site de operador) que pode virar `href` ou `src`: só http(s).
 * Barra `javascript:`, `data:` e afins, que num `href` rodariam código no app (XSS).
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
