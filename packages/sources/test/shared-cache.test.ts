import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SharedCache } from "../src/http.js";

// Cache local numa pasta temporária: cada teste começa "frio" no disco, como uma instância nova na Vercel.
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

describe("cache em dois níveis", () => {
  afterEach(async () => {
    const { useSharedCache } = await import("../src/http.js");
    useSharedCache(undefined);
    vi.resetModules();
  });

  it("dado de referência vai para o cache compartilhado (compactado) e volta numa instância nova", async () => {
    const remote = memory();
    let http = await import("../src/http.js");
    http.useSharedCache(remote);
    const fetcher = vi.fn(async () => ({ elements: [1, 2, 3] }));
    expect(await http.cached("overpass", "q1", 7 * http.DAY, fetcher)).toEqual({ elements: [1, 2, 3] });
    expect(remote.store.size).toBe(1);
    expect(typeof [...remote.store.values()][0]).toBe("string");

    // "Outra instância": disco vazio (outra pasta), mesmo cache compartilhado.
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "homematch-cache-"));
    vi.resetModules();
    http = await import("../src/http.js");
    http.useSharedCache(remote);
    const again = vi.fn(async () => ({ elements: [] }));
    expect(await http.cached("overpass", "q1", 7 * http.DAY, again)).toEqual({ elements: [1, 2, 3] });
    expect(again).not.toHaveBeenCalled();
  });

  it("anúncio (validade curta) fica só no disco", async () => {
    const remote = memory();
    const http = await import("../src/http.js");
    http.useSharedCache(remote);
    await http.cached("quintoandar", "pagina", 6 * http.HOUR, async () => ["anúncio"]);
    expect(remote.store.size).toBe(0);
  });

  it("cache compartilhado fora do ar não quebra a busca", async () => {
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
