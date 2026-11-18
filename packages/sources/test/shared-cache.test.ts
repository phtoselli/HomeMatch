import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SharedCache } from "../src/http.js";

// Local cache in a temp folder: each test starts "cold" on disk, like a new Vercel instance.
beforeAll(() => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "homematch-cache-"));
});

const memory = (): SharedCache & { store: Map<string, unknown> } => {
  const store = new Map<string, unknown>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => void store.set(k, v),
  };
};

describe("two-level cache", () => {
  afterEach(async () => {
    const { useSharedCache } = await import("../src/http.js");
    useSharedCache(undefined);
    vi.resetModules();
  });

  it("reference data goes to the shared cache (compressed) and comes back on a new instance", async () => {
    const remote = memory();
    let http = await import("../src/http.js");
    http.useSharedCache(remote);
    const fetcher = vi.fn(async () => ({ elements: [1, 2, 3] }));
    expect(await http.cached("overpass", "q1", 7 * http.DAY, fetcher)).toEqual({ elements: [1, 2, 3] });
    expect(remote.store.size).toBe(1);
    expect(typeof [...remote.store.values()][0]).toBe("string");

    // "Another instance": empty disk (another folder), same shared cache.
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "homematch-cache-"));
    vi.resetModules();
    http = await import("../src/http.js");
    http.useSharedCache(remote);
    const again = vi.fn(async () => ({ elements: [] }));
    expect(await http.cached("overpass", "q1", 7 * http.DAY, again)).toEqual({ elements: [1, 2, 3] });
    expect(again).not.toHaveBeenCalled();
  });

  it("listings (short lifetime) stay on disk only", async () => {
    const remote = memory();
    const http = await import("../src/http.js");
    http.useSharedCache(remote);
    await http.cached("quintoandar", "pagina", 6 * http.HOUR, async () => ["anúncio"]);
    expect(remote.store.size).toBe(0);
  });

  it("a shared cache outage does not break the search", async () => {
    const http = await import("../src/http.js");
    http.useSharedCache({
      get: async () => {
        throw new Error("fora do ar");
      },
      set: async () => {
        throw new Error("cota esgotada");
      },
    });
    expect(await http.cached("overpass", "q2", 7 * http.DAY, async () => "ok")).toBe("ok");
  });
});

describe("source outage", () => {
  it("returns the stale cached value instead of failing the search; with nothing stored, the error propagates", async () => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "homematch-cache-"));
    vi.resetModules();
    const http = await import("../src/http.js");
    await http.cached("overpass", "stale-q", 1, async () => ({ v: "antigo" }));
    await new Promise((r) => setTimeout(r, 5)); // past its lifetime (1 ms)
    const down = async () => {
      throw new Error("Overpass indisponível");
    };
    expect(await http.cached("overpass", "stale-q", 1, down)).toEqual({ v: "antigo" });
    await expect(http.cached("overpass", "nunca-visto", 1, down)).rejects.toThrow("Overpass indisponível");
  });
});
