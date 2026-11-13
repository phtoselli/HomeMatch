import type {
  AnalysisResult,
  AnalyzeRequest,
  BBox,
  BusLine,
  City,
  LinkResult,
  LinksRequest,
  FeatureDef,
  LatLng,
  Listing,
  ListingsRequest,
  PlaceResult,
  StreamEvent,
  TransitOperatorInfo,
} from "../shared/types";

type CityRef = Pick<PlaceResult, "osmId" | "name" | "stateCode">;
const cityParams = (c?: CityRef | null): Record<string, string> =>
  c ? { cityId: c.osmId, cityName: c.name, ...(c.stateCode ? { uf: c.stateCode } : {}) } : {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** No `npm run dev` o Vite sobe antes da API: enquanto isso o proxy responde 500/502/503/504 sem corpo JSON. */
async function fetchWhenUp(url: string, init?: RequestInit): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init).catch(() => null);
    const starting = !res || ([500, 502, 503, 504].includes(res.status) && !res.headers.get("content-type")?.includes("json"));
    if (!starting || i >= 15) {
      if (!res) throw new Error("Servidor da API fora do ar. Rode `npm run dev`.");
      if (starting) throw new Error("A API não respondeu (ainda iniciando?). Tente de novo em alguns segundos.");
      return res;
    }
    await sleep(1000);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetchWhenUp(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  features: () => getJson<FeatureDef[]>("/api/features"),
  cities: (q: string) => getJson<PlaceResult[]>(`/api/cities?q=${encodeURIComponent(q)}`),
  city: (osmId: string) => getJson<City>(`/api/city/${osmId}`),
  geocode: (q: string, box?: BBox) => {
    const p = new URLSearchParams({ q });
    if (box) for (const [k, v] of Object.entries(box)) p.set(k, String(v));
    return getJson<PlaceResult[]>(`/api/geocode?${p}`);
  },
  reverse: (p: LatLng) => getJson<PlaceResult | null>(`/api/reverse?lat=${p.lat}&lng=${p.lng}`),
  analyze: (req: AnalyzeRequest, on: (ev: StreamEvent<AnalysisResult>) => void) =>
    streamPost<AnalysisResult>("/api/analyze", req, on),
  listings: (req: ListingsRequest, on: (ev: StreamEvent<Listing[]>) => void) =>
    streamPost<Listing[]>("/api/listings", req, on),
  links: (req: LinksRequest, on: (ev: StreamEvent<LinkResult[]>) => void) =>
    streamPost<LinkResult[]>("/api/links", req, on),
  bus: (q: string, box?: BBox, city?: CityRef | null) => {
    const p = new URLSearchParams({ q, ...cityParams(city) });
    if (box) for (const [k, v] of Object.entries(box)) p.set(k, String(v));
    return getJson<BusLine[]>(`/api/bus?${p}`);
  },
  busNear: (at: LatLng, city: CityRef, radius = 700) =>
    getJson<BusLine[]>(`/api/bus/near?${new URLSearchParams({ lat: String(at.lat), lng: String(at.lng), radius: String(radius), ...cityParams(city) })}`),
  operator: (city: CityRef) =>
    getJson<TransitOperatorInfo | null>(`/api/transit/operator?${new URLSearchParams(cityParams(city))}`),
};

/** POST que recebe NDJSON: chama `on` a cada evento e resolve com o resultado final. */
async function streamPost<T>(url: string, body: unknown, on: (ev: StreamEvent<T>) => void): Promise<T> {
  const res = await fetchWhenUp(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Erro ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: T | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as StreamEvent<T>;
      if (ev.type === "error") throw new Error(ev.message);
      if (ev.type === "result") result = ev.data;
      on(ev);
    }
    if (done) break;
  }
  if (result === undefined) throw new Error("A conexão terminou sem resultado.");
  return result;
}
