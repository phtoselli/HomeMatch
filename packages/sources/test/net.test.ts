import { describe, expect, it } from "vitest";
import { httpFetch, readTextLimited } from "../src/http.js";
import { PrivateNetworkError, isPrivateAddress, publicLookup } from "../src/net.js";

const resolve = (host: string) =>
  new Promise<unknown>((ok, fail) =>
    (publicLookup as unknown as (h: string, o: object, cb: (e: Error | null, a?: unknown) => void) => void)(
      host,
      { all: true },
      (e, a) => (e ? fail(e) : ok(a)),
    ),
  );

describe("guarda de rede (SSRF)", () => {
  it("IPv4 embutido em IPv6 (NAT64, 6to4) e faixas reservadas contam como rede local", () => {
    for (const ip of [
      "64:ff9b::7f00:1",
      "64:ff9b::127.0.0.1",
      "2002:a9fe:a9fe::1",
      "198.18.0.1",
      "192.0.2.10",
      "fe80::1",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    expect(isPrivateAddress("2002:0808:0808::1")).toBe(false);
  });

  it("a conexão recusa nome que resolve para rede local (vale também para DNS rebinding)", async () => {
    await expect(resolve("localhost")).rejects.toBeInstanceOf(PrivateNetworkError);
  });

  it("httpFetch não fala com rede local, nem tenta de novo", async () => {
    await expect(httpFetch("http://127.0.0.1:9/", { retries: 3 })).rejects.toBeInstanceOf(PrivateNetworkError);
    await expect(httpFetch("http://localhost:9/", { retries: 3 })).rejects.toBeInstanceOf(PrivateNetworkError);
  });

  it("corpo grande demais para de ser lido", async () => {
    const big = new Response("x".repeat(2000));
    await expect(readTextLimited(big, 1000)).rejects.toThrow(/grande demais/);
    expect(await readTextLimited(new Response("ok"), 1000)).toBe("ok");
  });
});
