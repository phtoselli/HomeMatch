import { describe, expect, it } from "vitest";
import type { AnalysisResult, City, Region } from "@homematch/contracts";
import { DEFAULT_FILTERS, money, type Filters, type LineSummary } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { buildReportData, type ReportInput } from "@/features/report/lib/report-data";
import { pdfText } from "@/features/report/lib/pdf";
import { fitZoom, mapBounds } from "@/features/report/lib/map-image";

const msg = t.ui.report;

const city = {
  osmId: "r1",
  name: "Campinas",
  stateCode: "SP",
  displayName: "Campinas, SP",
  lat: -22.9,
  lng: -47.06,
  bbox: { south: -23.05, north: -22.75, west: -47.25, east: -46.9 },
} as unknown as City;

const region = (rank: number, level: Region["level"], over: Partial<Region> = {}): Region => ({
  id: `r${rank}`,
  rank,
  name: `Bairro ${rank}`,
  lat: -22.9 + rank * 0.01,
  lng: -47.06,
  bbox: { south: -22.91 + rank * 0.01, north: -22.89 + rank * 0.01, west: -47.07, east: -47.05 },
  commuteMin: 20 + rank,
  commuteAvg: 30 + rank,
  travel: "transit",
  score: 90 - rank,
  cellCount: 4,
  via: ["Ônibus 353"],
  featureDist: { park: 450 },
  level,
  hits: ["transit"],
  ...over,
});

const analysis = {
  work: { lat: -22.82, lng: -47.03 },
  cellSizeM: 500,
  routes: [],
  pois: {},
  cells: [],
  regions: [region(1, "excellent"), region(2, "good"), region(3, "ok")],
  stats: {
    cellsTotal: 3,
    levels: { excellent: 1, good: 1, ok: 1 },
    commuteBestMin: 18,
    commuteRefMin: 40,
    stopsUsable: 9,
  },
  warnings: [],
} as AnalysisResult;

const line: LineSummary = {
  key: "353",
  ref: "353",
  name: "Alphaville / Terminal",
  color: "#e8590c",
  mode: "bus",
  operator: "EMDEC",
  directions: [{ id: "a", from: "Tanquinho", to: "Centro", stops: 40 }],
  roles: ["work"],
  kind: "nearWork",
};

const filters: Filters = {
  ...DEFAULT_FILTERS,
  budget: 2500,
  slack: 10,
  basis: "total",
  types: ["apartment"],
  minBedrooms: 2,
  amenities: ["kitchen_cabinets"],
};

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  city,
  work: { lat: -22.82, lng: -47.03, label: "Av. Exemplo, 100" },
  filters,
  features: [{ id: "park", label: "Parque / praça", description: "" } as never],
  chosen: { park: 800 },
  importanceOf: (id) => (id === "transit" ? 3 : 2),
  analysis,
  minLevel: "good",
  lines: [line, { ...line, key: "x", ref: "999", roles: [] }],
  date: new Date(2026, 10, 17),
  ...over,
});

describe("report data (PDF for a real estate agency)", () => {
  it("lists the client's needs: city, work reference, budget with slack, type, bedrooms and commute", () => {
    const d = buildReportData(input());
    const row = (label: string) => d.profile.find((r) => r.label === label)?.value;
    expect(row(msg.city)).toBe("Campinas - SP");
    expect(row(msg.work)).toBe("Av. Exemplo, 100");
    expect(row(msg.budget)).toContain(msg.basisTotal);
    expect(row(msg.budget)).toMatch(/2\.750/); // ceiling = 2,500 + 10%
    expect(row(msg.types)).toBe("apartamento");
    expect(row(msg.bedrooms)).toBe(msg.atLeast(2));
    expect(row(msg.commute)).toBe(msg.commuteValue(18, 40));
  });

  it("priorities come sorted by importance, transit included", () => {
    const d = buildReportData(input());
    expect(d.priorities.map((p) => p.name)).toEqual([msg.transit, "Parque"]);
    expect(d.priorities[0]!.importance).toBe(msg.importanceLabels[3]);
  });

  it("summary strip: city, short work label, budget and the main priority", () => {
    const d = buildReportData(input());
    expect(d.summary.map((r) => r.value)).toEqual([
      "Campinas - SP",
      "Av. Exemplo",
      msg.budgetShort(money(2500)),
      msg.transit,
    ]);
    expect(d.priorities.map((p) => p.level)).toEqual([3, 2]);
    expect(d.year).toBe(input().date.getFullYear());
  });

  it("only regions at or above the chosen level, numbered like the map, with commute and lines", () => {
    const d = buildReportData(input());
    expect(d.regions.map((r) => r.rank)).toEqual([1, 2]);
    expect(d.regions[0]).toMatchObject({ name: "Bairro 1", commute: "21-31 min", lines: "353" });
    expect(d.regions[0]!.nearby).toContain("Parque");
    expect(d.mapRegions).toHaveLength(2);
  });

  it("lines: only the ones the listed regions use, with route, regions served and role", () => {
    const d = buildReportData(input());
    expect(d.lines).toEqual([
      {
        ref: "353",
        route: "Tanquinho -> Centro",
        operator: "EMDEC",
        regions: "1, 2",
        role: t.transit.lineRoles.nearWork,
      },
    ]);
    expect(d.mapLineRefs).toEqual(["353"]);
  });

  it("has search hints for the agency and never any listing link", () => {
    const d = buildReportData(input());
    expect(d.hints[0]).toBe(msg.hintNeighbourhoods(["Bairro 1", "Bairro 2"]));
    expect(d.hints.some((h) => h.includes("353"))).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/https?:\/\//);
  });

  it("without an analysis there are no regions, but the needs are still there", () => {
    const d = buildReportData(input({ analysis: null }));
    expect(d.regions).toEqual([]);
    expect(d.profile.length).toBeGreaterThan(5);
  });
});

describe("PDF helpers", () => {
  it("pdfText keeps Portuguese letters and swaps symbols the PDF font lacks", () => {
    expect(pdfText("Região → Centro – São João… ≈ 5 min")).toBe("Região -> Centro - São João... ~ 5 min");
    expect(pdfText("ação, pão, ç, ê")).toBe("ação, pão, ç, ê");
  });

  it("the map frames the regions and the work location", () => {
    const b = mapBounds({ city, work: { lat: -22.82, lng: -47.03 }, regions: analysis.regions })!;
    expect(b.north).toBeGreaterThan(-22.82);
    expect(b.south).toBeLessThan(-22.88);
    const z = fitZoom(b, 1400, 900);
    expect(z).toBeGreaterThanOrEqual(10);
    expect(z).toBeLessThanOrEqual(16);
    expect(mapBounds({ city: null, work: null, regions: [] })).toBeNull();
  });
});
