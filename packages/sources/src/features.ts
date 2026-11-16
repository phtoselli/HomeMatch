import type { BBox, FeatureDef, Poi } from "@homematch/contracts";
import { DAY } from "./http.js";
import { bboxQL, elementPoint, overpass, type OsmElement } from "./osm/overpass.js";

/**
 * Redes de atacarejo / hipermercado (compra do mês com preço bom).
 * Casada com name OU brand, sem diferenciar maiúsculas. Ajuste à vontade.
 */
export const BULK_MARKET_REGEX =
  "atacad|atakarejo|atacarejo|assa[ií]|rold[aã]o|makro|sam.?s club|mart minas|spani|kompr[aã]o|carrefour|hiper|bistek|giassi|guanabara|savegnago|tauste|enxuto|mateus|tenda|fort atac|max atac|super muffato|comper|cometa";

interface FeatureSpec extends FeatureDef {
  /** Seletores Overpass QL (sem a bbox). Cada um vira `<seletor>(bbox);`. */
  selectors: string[];
  keep?: (e: OsmElement) => boolean;
}

const SPECS: FeatureSpec[] = [
  {
    id: "atacarejo",
    label: "Mercado grande / atacarejo",
    emoji: "🛒",
    color: "#e8590c",
    defaultRadius: 2000,
    description: "Atacarejos e hipermercados (Assaí, Atacadão, Carrefour, Tenda...) para a compra do mês.",
    selectors: [
      `nwr["shop"~"^(supermarket|wholesale)$"]["name"~"${BULK_MARKET_REGEX}",i]`,
      `nwr["shop"~"^(supermarket|wholesale)$"]["brand"~"${BULK_MARKET_REGEX}",i]`,
      `nwr["shop"="wholesale"]`,
    ],
  },
  {
    id: "supermercado",
    label: "Supermercado",
    emoji: "🧺",
    color: "#f08c00",
    defaultRadius: 800,
    description: "Qualquer supermercado para o dia a dia.",
    selectors: [`nwr["shop"="supermarket"]`],
  },
  {
    id: "parque",
    label: "Parque",
    emoji: "🌳",
    color: "#2f9e44",
    defaultRadius: 1500,
    description: "Parques com nome (ignora praças, largos e canteiros).",
    selectors: [`nwr["leisure"~"^(park|nature_reserve)$"]["name"]`],
    keep: (e) => !/^(pra[çc]a|largo|canteiro|rotat[óo]ria|r[óo]tula|balão)\b/i.test(e.tags?.name ?? ""),
  },
  {
    id: "feira",
    label: "Feira / mercado municipal",
    emoji: "🥬",
    color: "#66a80f",
    defaultRadius: 1500,
    description: "Feiras livres, sacolões e mercados municipais.",
    selectors: [`nwr["amenity"="marketplace"]`, `nwr["shop"="greengrocer"]`],
  },
  {
    id: "academia",
    label: "Academia",
    emoji: "🏋️",
    color: "#c2255c",
    defaultRadius: 1000,
    description: "Academias e centros de treino.",
    selectors: [`nwr["leisure"="fitness_centre"]`],
  },
  {
    id: "farmacia",
    label: "Farmácia",
    emoji: "💊",
    color: "#1971c2",
    defaultRadius: 800,
    description: "Farmácias e drogarias.",
    selectors: [`nwr["amenity"="pharmacy"]`],
  },
  {
    id: "padaria",
    label: "Padaria",
    emoji: "🥖",
    color: "#a0522d",
    defaultRadius: 600,
    description: "Padarias e confeitarias.",
    selectors: [`nwr["shop"~"^(bakery|pastry)$"]`],
  },
  {
    id: "hospital",
    label: "Hospital / clínica",
    emoji: "🏥",
    color: "#e03131",
    defaultRadius: 3000,
    description: "Hospitais, UPAs e clínicas.",
    selectors: [`nwr["amenity"~"^(hospital|clinic)$"]`],
  },
  {
    id: "escola",
    label: "Escola / creche",
    emoji: "🏫",
    color: "#7048e8",
    defaultRadius: 1000,
    description: "Escolas e creches.",
    selectors: [`nwr["amenity"~"^(school|kindergarten)$"]`],
  },
  {
    id: "shopping",
    label: "Shopping",
    emoji: "🛍️",
    color: "#ae3ec9",
    defaultRadius: 3000,
    description: "Shopping centers.",
    selectors: [`nwr["shop"="mall"]`],
  },
  {
    id: "pet",
    label: "Pet shop / veterinário",
    emoji: "🐾",
    color: "#0c8599",
    defaultRadius: 1500,
    description: "Pet shops e clínicas veterinárias.",
    selectors: [`nwr["shop"="pet"]`, `nwr["amenity"="veterinary"]`],
  },
  {
    id: "estacao",
    label: "Estação de metrô/trem",
    emoji: "🚇",
    color: "#364fc7",
    defaultRadius: 1000,
    description: "Estações de metrô, trem, VLT e BRT.",
    selectors: [`nwr["railway"~"^(station|halt)$"]`, `nwr["public_transport"="station"]["bus"!="yes"]`],
  },
  {
    id: "universidade",
    label: "Faculdade",
    emoji: "🎓",
    color: "#5c940d",
    defaultRadius: 3000,
    description: "Universidades e faculdades.",
    selectors: [`nwr["amenity"~"^(university|college)$"]`],
  },
];

export const FEATURES: FeatureDef[] = SPECS.map(({ selectors: _s, keep: _k, ...def }) => def);

export function featureById(id: string): FeatureDef | undefined {
  return FEATURES.find((f) => f.id === id);
}

export function buildFeatureQuery(id: string, bbox: BBox): string {
  const spec = SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`Característica desconhecida: ${id}`);
  const bb = bboxQL(bbox);
  // `out center` (corpo completo): nós com lat/lon, vias/relações com o centro. Não usar `out tags`,
  // que descarta as coordenadas.
  return `[out:json][timeout:180];(${spec.selectors.map((s) => `${s}(${bb});`).join("")});out center qt;`;
}

export function parseFeaturePois(id: string, elements: OsmElement[]): Poi[] {
  const spec = SPECS.find((s) => s.id === id);
  const out: Poi[] = [];
  const seen = new Set<string>();
  for (const e of elements) {
    if (spec?.keep && !spec.keep(e)) continue;
    const p = elementPoint(e);
    if (!p) continue;
    const key = `${e.type}${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, feature: id, lat: p.lat, lng: p.lng, name: e.tags?.name ?? e.tags?.brand });
  }
  return out;
}

export async function fetchFeaturePois(id: string, bbox: BBox): Promise<Poi[]> {
  const res = await overpass(buildFeatureQuery(id, bbox));
  return parseFeaturePois(id, res.elements);
}

export interface PlaceName {
  lat: number;
  lng: number;
  name: string;
  /** Menor = mais "bairro": bairro oficial e suburb antes de loteamento e condomínio. */
  rank: number;
}

const PLACE_RANK: Record<string, number> = { suburb: 0, quarter: 1, neighbourhood: 2, hamlet: 3, village: 3 };

/**
 * Bairros para dar nome às regiões. Duas consultas: os pontos de bairro (place=suburb/quarter/neighbourhood) e as
 * áreas com nome (bairro oficial como limite administrativo, loteamento/residencial, vila, povoado), que cobrem as
 * cidades onde quase não há pontos de bairro mapeados. Se a segunda falhar, vale só a primeira.
 */
export async function fetchPlaceNames(bbox: BBox): Promise<PlaceName[]> {
  const [points, areas] = await Promise.all([
    overpass(buildPlacePointsQuery(bbox), 30 * DAY),
    overpass(buildPlaceAreasQuery(bbox), 30 * DAY).catch(() => ({ elements: [] as OsmElement[] })),
  ]);
  return parsePlaceNames([...points.elements, ...areas.elements]);
}

export const buildPlacePointsQuery = (bbox: BBox) =>
  `[out:json][timeout:120];(node["place"~"^(suburb|quarter|neighbourhood)$"]["name"](${bboxQL(bbox)}););out qt;`;

export const buildPlaceAreasQuery = (bbox: BBox) => {
  const b = bboxQL(bbox);
  return (
    `[out:json][timeout:120];(` +
    `node["place"~"^(hamlet|village)$"]["name"](${b});` +
    `way["landuse"="residential"]["name"](${b});` +
    `way["place"~"^(suburb|quarter|neighbourhood)$"]["name"](${b});` +
    `rel["boundary"="administrative"]["admin_level"~"^(9|10)$"]["name"](${b});` +
    `);out center tags qt;`
  );
};

/** Parse puro: ponto ou centro de cada lugar com nome e o "peso" de bairro. */
export function parsePlaceNames(elements: OsmElement[]): PlaceName[] {
  const out: PlaceName[] = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    const p = elementPoint(e);
    if (!p || !t.name) continue;
    const rank =
      t.boundary === "administrative"
        ? 0 // bairro oficial da prefeitura
        : t.place
          ? (PLACE_RANK[t.place] ?? 3)
          : t.landuse === "residential"
            ? 2.5 // loteamento, condomínio, conjunto habitacional
            : 3;
    out.push({ ...p, name: t.name, rank });
  }
  return out;
}
