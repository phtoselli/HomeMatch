import { BROWSER_UA, DAY, HOUR, cacheGet, cacheSet, httpFetch } from "../../http.js";

/**
 * robots.txt: o que o site pede para robôs não lerem. Toda extensão passa por aqui antes de baixar
 * uma página; se o site não permite, a fonte aparece como "robots" e não é lida.
 */
export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

/** Parse puro: regras do grupo "User-agent: *" (o app não tem grupo próprio nos sites). */
export function parseRobots(txt: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let agents: string[] = [];
  let inRules = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (inRules) agents = []; // um "User-agent" depois de regras começa outro grupo
      inRules = false;
      agents.push(value.toLowerCase());
      continue;
    }
    if (key !== "allow" && key !== "disallow") continue;
    inRules = true;
    if (!agents.includes("*")) continue;
    if (key === "disallow" && !value) continue; // "Disallow:" vazio = libera tudo
    rules.push({ allow: key === "allow", pattern: value });
  }
  return rules;
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** O caminho (com a query) pode ser lido? Vale a regra mais específica (mais longa); empate = Allow. */
export function robotsAllows(rules: RobotsRule[], pathAndQuery: string): boolean {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!toRegex(r.pattern).test(pathAndQuery)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow))
      best = r;
  }
  return best ? best.allow : true;
}

/** Busca (com cache de 1 dia) as regras do host. Sem robots.txt (4xx) = tudo liberado. */
async function rulesFor(origin: string): Promise<RobotsRule[] | "erro"> {
  const hit = await cacheGet<RobotsRule[]>("robots", origin, DAY);
  if (hit) return hit;
  let rules: RobotsRule[];
  try {
    const res = await httpFetch(`${origin}/robots.txt`, {
      retries: 1,
      timeoutMs: 15_000,
      headers: { "User-Agent": BROWSER_UA },
    });
    if (res.status >= 400 && res.status < 500) rules = [];
    else if (!res.ok)
      return "erro"; // erro passageiro: não vai para o cache
    else rules = parseRobots(await res.text());
  } catch {
    return "erro";
  }
  await cacheSet("robots", origin, rules);
  return rules;
}

const memo = new Map<string, { at: number; rules: RobotsRule[] | "erro" }>();

/** "allow" / "deny" pelo robots.txt; "erro" quando nem o robots.txt responde (site fora do ar). */
export async function robotsStatus(url: string): Promise<"allow" | "deny" | "erro"> {
  const u = new URL(url);
  let hit = memo.get(u.origin);
  if (!hit || Date.now() - hit.at > HOUR) {
    hit = { at: Date.now(), rules: await rulesFor(u.origin) };
    if (hit.rules !== "erro") memo.set(u.origin, hit);
  }
  if (hit.rules === "erro") return "erro";
  return robotsAllows(hit.rules, u.pathname + u.search) ? "allow" : "deny";
}

/** Na dúvida (robots.txt fora do ar), não lê o site agora. */
export const allowedByRobots = async (url: string) => (await robotsStatus(url)) === "allow";
