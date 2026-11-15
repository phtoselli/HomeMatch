import { lookup, type LookupAddress, type LookupAllOptions } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";

/**
 * Guarda de rede: o servidor só fala com endereços públicos. Vale para toda chamada externa (via `http.ts`), porque
 * vários endereços vêm de fora: links colados, sites de imobiliárias e de operadores tirados do OpenStreetMap (que
 * qualquer pessoa edita) e redirecionamentos. Sem isso, dava para fazer o servidor acessar a rede interna (SSRF).
 */

const ipv4 = (ip: string) => ip.split(".").map(Number) as [number, number, number, number];

/** Endereço IP de rede local, loopback, link-local, CGNAT, multicast, documentação ou não roteável. */
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
    super("Link de rede local não é permitido");
  }
}

/** Só http(s) e nada de rede local no texto da URL (o IP de verdade é conferido na conexão). */
export function assertPublicUrl(raw: string): URL {
  const u = new URL(raw.trim());
  if (!/^https?:$/.test(u.protocol)) throw new Error("Use um link http(s)");
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
 * Resolução de nomes que recusa IP de rede local. Roda na hora de abrir a conexão, então o IP conferido é o mesmo
 * usado: um nome que resolve para um IP público na checagem e para 127.0.0.1 na conexão (DNS rebinding) não passa.
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

/** Conexões HTTP do servidor: só endereços públicos. */
export const publicDispatcher = new Agent({ connect: { lookup: publicLookup } });
