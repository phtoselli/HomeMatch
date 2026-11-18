import { lookup, type LookupAddress, type LookupAllOptions } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";
import { t } from "@homematch/i18n";

/**
 * Network guard: the server only talks to public addresses. It applies to every outgoing call (via `http.ts`),
 * because many addresses come from outside: pasted links, agency and operator websites taken from OpenStreetMap
 * (which anyone can edit) and redirects. Without it, the server could be made to reach the internal network (SSRF).
 */

const ipv4 = (ip: string) => ip.split(".").map(Number) as [number, number, number, number];

/** Local network, loopback, link-local, CGNAT, multicast, documentation or non-routable IP address. */
export function isPrivateAddress(ip: string): boolean {
  const h = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(h) === 4) {
    const [a, b, c] = ipv4(h);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(h) === 6) {
    if (h === "::" || h === "::1") return true;
    // IPv4 embutido no IPv6: mapeado (::ffff:), NAT64 (64:ff9b::) e 6to4 (2002:)
    const dotted = h.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateAddress(dotted[1]!);
    const hex =
      h.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) ??
      h.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);
    if (hex) {
      const hi = parseInt(hex[1]!, 16);
      const lo = parseInt(hex[2]!, 16);
      return isPrivateAddress([hi >> 8, hi & 255, lo >> 8, lo & 255].join("."));
    }
    return /^(fc|fd|fe[89ab]|ff)/.test(h);
  }
  return false;
}

export class PrivateNetworkError extends Error {
  readonly code = "EPRIVATE";
  constructor() {
    super(t.sources.privateNetwork);
  }
}

/** Only http(s) and no local network in the URL text (the real IP is checked when connecting). */
export function assertPublicUrl(raw: string): URL {
  const u = new URL(raw.trim());
  if (!/^https?:$/.test(u.protocol)) throw new Error(t.sources.httpOnly);
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    isPrivateAddress(h)
  ) {
    throw new PrivateNetworkError();
  }
  return u;
}

/**
 * Name resolution that rejects local network IPs. It runs when the connection opens, so the checked IP is the one
 * used: a name resolving to a public IP during the check and to 127.0.0.1 on connect (DNS rebinding) is rejected.
 */
type LookupCallback = (err: Error | null, address?: string | LookupAddress[], family?: number) => void;

export const publicLookup = ((hostname: string, options: LookupAllOptions, callback: LookupCallback) => {
  lookup(hostname, { ...options, all: true }, (err, addrs: LookupAddress[]) => {
    if (err) return callback(err);
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return callback(new PrivateNetworkError());
    if (options.all) return callback(null, addrs);
    return callback(null, addrs[0]!.address, addrs[0]!.family);
  });
}) as unknown as LookupFunction;

/** The server's HTTP connections: public addresses only. */
export const publicDispatcher = new Agent({ connect: { lookup: publicLookup } });
