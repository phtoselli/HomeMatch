import { describe, expect, it } from "vitest";
import worker, { apiRequest } from "../src/index.js";

const API = "https://api.example.test";

describe("edge worker", () => {
  it("forwards /api requests to the API origin with path, query, method and body", async () => {
    const req = new Request("https://home-match.pedrotoselli.com/api/cities?q=Campinas", {
      headers: { "cf-connecting-ip": "203.0.113.9", accept: "application/json" },
    });
    const out = apiRequest(req, API);
    expect(out.url).toBe(`${API}/api/cities?q=Campinas`);
    expect(out.method).toBe("GET");
    expect(out.headers.get("accept")).toBe("application/json");
    expect(out.headers.get("cf-connecting-ip")).toBeNull();
    expect(out.headers.get("x-forwarded-host")).toBe("home-match.pedrotoselli.com");

    const post = apiRequest(
      new Request("https://home-match.pedrotoselli.com/api/analyze", { method: "POST", body: '{"a":1}' }),
      API,
    );
    expect(post.method).toBe("POST");
    expect(await post.text()).toBe('{"a":1}');
  });

  it("serves everything else from static assets and answers 502 when the API is down", async () => {
    const env = {
      API_ORIGIN: "http://127.0.0.1:9",
      ASSETS: { fetch: async () => new Response("app") },
    };
    const page = await worker.fetch(new Request("https://home-match.pedrotoselli.com/"), env);
    expect(await page.text()).toBe("app");
    const api = await worker.fetch(new Request("https://home-match.pedrotoselli.com/api/health"), env);
    expect(api.status).toBe(502);
  });
});
