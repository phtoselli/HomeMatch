// Security headers shared by every deployment (Vercel build and Cloudflare Worker).
//
// The CSP only runs the app's own scripts: even if an outside link slipped past the filter (`safeExternalUrl`), a
// `javascript:` URL would not run. Images come from any https site (listing photos, map tiles); inline style is
// needed by Leaflet (markers with `style`).
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
};

/** Vite fingerprints everything under /assets/: it can be cached forever. */
export const IMMUTABLE = "public, max-age=31536000, immutable";
