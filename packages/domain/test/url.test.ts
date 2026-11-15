import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "../src/index.js";

describe("safeExternalUrl", () => {
  it("aceita http(s) e resolve caminho relativo pela página", () => {
    expect(safeExternalUrl("https://site.com.br/imovel/1")).toBe("https://site.com.br/imovel/1");
    expect(safeExternalUrl("/imovel/2", "https://site.com.br/busca")).toBe("https://site.com.br/imovel/2");
  });

  it("barra esquemas que rodariam código ou não são páginas", () => {
    for (const bad of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "data:text/html,<b>x</b>",
      "vbscript:x",
      "file:///etc/passwd",
    ])
      expect(safeExternalUrl(bad, "https://site.com.br/")).toBeUndefined();
  });

  it("vazio ou inválido vira undefined", () => {
    expect(safeExternalUrl(undefined)).toBeUndefined();
    expect(safeExternalUrl("")).toBeUndefined();
    expect(safeExternalUrl("http://")).toBeUndefined();
  });
});
