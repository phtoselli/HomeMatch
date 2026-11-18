import { BROWSER_UA, DAY, HOUR, cacheGet, cacheSet, httpFetch } from "../../http.js";

/**
 * robots.txt: what the site asks robots not to read. Every extension goes through here before downloading a page;
 * if the site does not allow it, the source shows up as "robots" and is not read.
 */
export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

/** Pure parsing: rules of the "User-agent: *" group (the app has no group of its own on sites). */
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
      if (inRules) agents = []; // a "User-agent" after rules starts another group
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

/** May the path (with its query) be read? The most specific (longest) rule wins; tie = Allow. */
export function robotsAllows(rules: RobotsRule[], pathAndQuery: string): boolean {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!toRegex(r.pattern).test(pathAndQuery)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow))
      best = r;
  }
  return best ? best.allow : true;
}

/** Fetches the host's rules (cached for 1 day). No robots.txt (4xx) = everything allowed. */
async function rulesFor(origin: string): Promise<RobotsRule[] | "error"> {
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
      return "error"; // temporary error: not cached
    else rules = parseRobots(await res.text());
  } catch {
    return "error";
  }
  await cacheSet("robots", origin, rules);
  return rules;
}

const memo = new Map<string, { at: number; rules: RobotsRule[] | "error" }>();

/** "allow" / "deny" per robots.txt; "error" when not even robots.txt answers (site down). */
export async function robotsStatus(url: string): Promise<"allow" | "deny" | "error"> {
  const u = new URL(url);
  let hit = memo.get(u.origin);
  if (!hit || Date.now() - hit.at > HOUR) {
    hit = { at: Date.now(), rules: await rulesFor(u.origin) };
    if (hit.rules !== "error") memo.set(u.origin, hit);
  }
  if (hit.rules === "error") return "error";
  return robotsAllows(hit.rules, u.pathname + u.search) ? "allow" : "deny";
}

/** When in doubt (robots.txt down), do not read the site now. */
export const allowedByRobots = async (url: string) => (await robotsStatus(url)) === "allow";
