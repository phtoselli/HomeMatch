import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";

// Só rotas que não saem para a rede: saúde, validação e erros. As fontes externas têm os próprios testes (fixtures).
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ LOG_LEVEL: "silent", serveWeb: false, WEB_DIST: "" });
});
afterAll(() => app.close());

describe("API", () => {
  it("responde à verificação de saúde", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("lista o que dá para pedir perto de casa", async () => {
    const res = await app.inject({ method: "GET", url: "/api/features" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: string }[]>().map((f) => f.id)).toContain("parque");
  });

  it("sem cidade, as fontes são só os portais", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sources" });
    const body = res.json<{ portals: { id: string }[]; agencies: unknown[] }>();
    expect(body.portals.map((p) => p.id)).toContain("quintoandar");
    expect(body.agencies).toEqual([]);
  });

  it("parâmetro inválido vira 400 com os detalhes (antes de qualquer chamada externa)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/city/abc" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "Parâmetros inválidos" });
  });

  it("corpo da análise é validado pelo contrato", async () => {
    const res = await app.inject({ method: "POST", url: "/api/analyze", payload: { maxCommuteMin: 3 } });
    expect(res.statusCode).toBe(400);
  });

  it("linha de operador desconhecido não tem grade: 404 com mensagem", async () => {
    const res = await app.inject({ method: "GET", url: "/api/bus/timetable?id=nada:353" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Essa linha não tem grade de horários publicada pelo operador." });
  });

  it("JSON malformado é erro do cliente, não da fonte", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("configuração", () => {
  it("PORT só vale em produção; API_PORT sempre", () => {
    expect(loadEnv({ PORT: "5173" }).port).toBe(3333);
    expect(loadEnv({ PORT: "8080", NODE_ENV: "production" }).port).toBe(8080);
    expect(loadEnv({ API_PORT: "4000", PORT: "8080", NODE_ENV: "production" }).port).toBe(4000);
  });

  it("variável inválida falha na partida", () => {
    expect(() => loadEnv({ LOG_LEVEL: "barulhento" })).toThrow();
  });
});
