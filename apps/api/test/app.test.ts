import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";

// Only routes that stay off the network: health, validation and errors. External sources have their own tests (fixtures).
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ LOG_LEVEL: "silent", serveWeb: false, WEB_DIST: "" });
});
afterAll(() => app.close());

describe("API", () => {
  it("answers the health check", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("lists what can be requested near home", async () => {
    const res = await app.inject({ method: "GET", url: "/api/features" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: string }[]>().map((f) => f.id)).toContain("park");
  });

  it("without a city, the sources are only the portals", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sources" });
    const body = res.json<{ portals: { id: string }[]; agencies: unknown[] }>();
    expect(body.portals.map((p) => p.id)).toContain("quintoandar");
    expect(body.agencies).toEqual([]);
  });

  it("an invalid parameter becomes 400 with details (before any external call)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/city/abc" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "Parâmetros inválidos" });
  });

  it("the analysis body is validated by the contract", async () => {
    const res = await app.inject({ method: "POST", url: "/api/analyze", payload: { maxCommuteMin: 3 } });
    expect(res.statusCode).toBe(400);
  });

  it("a line from an unknown operator has no timetable: 404 with a message", async () => {
    const res = await app.inject({ method: "GET", url: "/api/bus/timetable?id=nada:353" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Essa linha não tem grade de horários publicada pelo operador." });
  });

  it("malformed JSON is a client error, not a source error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("configuration", () => {
  it("PORT only applies in production; API_PORT always", () => {
    expect(loadEnv({ PORT: "5173" }).port).toBe(3333);
    expect(loadEnv({ PORT: "8080", NODE_ENV: "production" }).port).toBe(8080);
    expect(loadEnv({ API_PORT: "4000", PORT: "8080", NODE_ENV: "production" }).port).toBe(4000);
  });

  it("an invalid variable fails at startup", () => {
    expect(() => loadEnv({ LOG_LEVEL: "barulhento" })).toThrow();
  });
});
