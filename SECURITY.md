# Security

## Reporting a vulnerability

Do not open a public issue. Use the **Security → Report a vulnerability** tab of the GitHub repository (private
security advisory). Describe the problem, how to reproduce it and the impact you see.

You should get a first answer within 7 days. Once fixed, the advisory can be published crediting the reporter, if
they want.

## Supported versions

Only the `main` branch (the deployed version) gets fixes.

## What is already handled

- **No personal data on the server:** favorites, filters and the work address stay in the browser's `localStorage`.
  The address only goes through the API during the analysis and is not stored. The PDF export is generated in the
  browser.
- **SSRF:** "My links" only downloads public `http(s)` addresses. The URL text is checked, so is every redirect,
  and the IP is checked at connection time (protects against DNS rebinding). Pages have a size limit.
- **XSS:** links from listings, OpenStreetMap or operator sites only become an `href` if they are `http(s)`.
  Outside text shown on the map (Leaflet tooltips) is escaped. The CSP only allows the app's own scripts.
- **Inputs:** every route validates its body and parameters with zod (`packages/contracts`), with size limits.
- **Overpass queries:** user text is always escaped inside queries.
- **Dependencies:** CI runs `npm audit` (production dependencies, high level).
