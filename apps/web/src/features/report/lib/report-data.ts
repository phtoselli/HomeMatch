import type { AnalysisResult, City, FeatureDef, LatLng, Region, RegionLevel } from "@homematch/contracts";
import {
  TRANSIT_CRITERION,
  amenityLabel,
  atLeast,
  ceilingOf,
  levelLabel,
  lineRoleLabel,
  meters,
  money,
  noTransitNear,
  shortVia,
  type Filters,
  type LineSummary,
} from "@homematch/domain";
import { t } from "@homematch/i18n";
import { shortLabel } from "@/shared/lib/format";

const msg = t.ui.report;

/** Most regions listed in the table and drawn on the map (the best ones). */
export const MAX_REGIONS = 15;
/** Most lines listed (the ones that matter first: near work, intercity, then the rest). */
export const MAX_LINES = 20;

export interface ReportInput {
  city: City | null;
  work: (LatLng & { label?: string }) | null;
  filters: Filters;
  features: FeatureDef[];
  /** Chosen places → walking radius (m). */
  chosen: Record<string, number>;
  /** Importance of each criterion (3 main, 2 important, 1 nice to have, 0 not used). */
  importanceOf: (id: string) => number;
  analysis: AnalysisResult | null;
  minLevel: RegionLevel;
  lines: LineSummary[];
  date: Date;
}

export interface ReportRow {
  label: string;
  value: string;
}

export interface ReportRegion {
  rank: number;
  name: string;
  level: RegionLevel;
  levelLabel: string;
  commute: string;
  lines: string;
  nearby: string;
}

export interface ReportLine {
  ref: string;
  route: string;
  operator: string;
  /** Numbers of the regions (table/map) whose commute uses this line. */
  regions: string;
  role: string;
}

/** Everything the PDF prints, already as text: no listings and no links, only the region and the client's needs. */
export interface ReportData {
  title: string;
  subtitle: string;
  generatedOn: string;
  /** Year for the copyright line. */
  year: number;
  intro: string;
  /** Four key facts shown in a strip under the title (city, work, budget, main priority). */
  summary: ReportRow[];
  profile: ReportRow[];
  /** `level`: 3 main, 2 important, 1 nice to have (drawn as bars). */
  priorities: { name: string; importance: string; level: number; detail: string }[];
  regions: ReportRegion[];
  regionsNote: string;
  /** Regions drawn on the map (same numbers as the table). */
  mapRegions: Region[];
  lines: ReportLine[];
  /** Line numbers drawn on the map: the ones serving the listed regions. */
  mapLineRefs: string[];
  hints: string[];
  method: string[];
}

const dateFmt = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

/** Regions at or above the chosen level, best first. */
const eligibleRegions = (analysis: AnalysisResult | null, minLevel: RegionLevel) =>
  (analysis?.regions ?? []).filter((r) => atLeast(r.level, minLevel));

/** The regions worth sending (the best ones). */
export function reportRegions(analysis: AnalysisResult | null, minLevel: RegionLevel): Region[] {
  return eligibleRegions(analysis, minLevel).slice(0, MAX_REGIONS);
}

/** Line numbers each region uses to reach work ("Ônibus 350 + Ônibus 353" → 350 and 353) → region numbers. */
export function regionsByLine(regions: Region[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of regions) {
    if (r.travel !== "transit") continue;
    for (const via of r.via)
      for (const ref of shortVia(via)
        .split(" + ")
        .map((s) => s.trim())
        .filter(Boolean)) {
        const ranks = out.get(ref) ?? [];
        if (!ranks.includes(r.rank)) ranks.push(r.rank);
        out.set(ref, ranks);
      }
  }
  return out;
}

/**
 * Lines that serve the listed regions (by the best region they serve), then the ones the client added. Lines the
 * analysis knows but no listed region uses are left out: they would only add noise for the agency.
 */
export function reportLines(lines: LineSummary[], served: Map<string, number[]>): LineSummary[] {
  const best = (l: LineSummary) => Math.min(...(served.get(l.ref ?? "") ?? [Infinity]));
  return lines
    .filter((l) => (l.ref && served.has(l.ref)) || l.roles.includes("mine"))
    .sort((a, b) => best(a) - best(b))
    .slice(0, MAX_LINES);
}

export function buildReportData(input: ReportInput): ReportData {
  const { city, work, filters: f, features, chosen, analysis, date } = input;
  const cityName = city ? `${city.name}${city.stateCode ? ` - ${city.stateCode}` : ""}` : "—";
  const basis = f.basis === "rent" ? msg.basisRent : msg.basisTotal;
  const ceiling = ceilingOf(f.budget, f.slack);
  const flexCeiling = f.budget && ceiling && ceiling > f.budget ? ceiling : null;
  const featureLabel = (id: string) => shortLabel(features.find((d) => d.id === id)?.label ?? id);
  const chosenIds = Object.keys(chosen);
  const types = f.types.map((ty) => t.listings.propertyTypes[ty].toLowerCase());
  const mustHave = (f.amenities ?? []).map((a) => amenityLabel(a).label.toLowerCase());

  const profile: ReportRow[] = [
    { label: msg.city, value: cityName },
    ...(work?.label ? [{ label: msg.work, value: work.label }] : []),
    {
      label: msg.budget,
      value: f.budget
        ? [
            msg.budgetValue(money(f.budget), basis),
            ...(flexCeiling ? [msg.budgetCeiling(money(flexCeiling), f.slack ?? 0)] : []),
          ].join("; ")
        : msg.budgetNone,
    },
    { label: msg.types, value: types.length ? types.join(", ") : msg.anyType },
    { label: msg.bedrooms, value: f.minBedrooms ? msg.atLeast(f.minBedrooms) : msg.noMinimum },
    { label: msg.bathrooms, value: f.minBathrooms ? msg.atLeast(f.minBathrooms) : msg.noMinimum },
    { label: msg.parking, value: f.minParking ? msg.atLeast(f.minParking) : msg.noMinimum },
    { label: msg.area, value: f.minArea ? msg.atLeastArea(f.minArea) : msg.noMinimum },
    { label: msg.mustHave, value: mustHave.length ? mustHave.join(", ") : msg.noMustHave },
    ...(analysis
      ? [
          {
            label: msg.commute,
            value: msg.commuteValue(
              analysis.stats.commuteBestMin,
              analysis.stats.commuteRefMin,
              analysis.stats.commuteDirectRefMin,
            ),
          },
        ]
      : []),
  ];

  const priorities = [TRANSIT_CRITERION, ...chosenIds]
    .map((id) => ({ id, importance: input.importanceOf(id) }))
    .filter((c) => c.importance > 0)
    .sort((a, b) => b.importance - a.importance)
    .map(({ id, importance }) => ({
      name: id === TRANSIT_CRITERION ? msg.transit : featureLabel(id),
      importance: msg.importanceLabels[importance] ?? String(importance),
      level: importance,
      detail: id === TRANSIT_CRITERION ? msg.transitDetail : msg.placeDetail(meters(chosen[id] ?? 0)),
    }));

  const eligible = eligibleRegions(analysis, input.minLevel);
  const mapRegions = eligible.slice(0, MAX_REGIONS);
  const regions: ReportRegion[] = mapRegions.map((r) => ({
    rank: r.rank,
    name: r.name,
    level: r.level,
    levelLabel: levelLabel(r.level),
    commute: noTransitNear(r)
      ? msg.noBus
      : r.travel === "walk"
        ? `${r.commuteMin} min ${msg.onFoot}`
        : msg.minutesRange(r.commuteMin, r.commuteAvg),
    lines: r.travel === "walk" ? msg.onFoot : [...new Set(r.via.map(shortVia))].slice(0, 3).join("; "),
    nearby: Object.entries(r.featureDist)
      .map(([id, d]) => `${featureLabel(id)} ${meters(d)}`)
      .join(", "),
  }));

  const served = regionsByLine(mapRegions);
  const lineList = reportLines(input.lines, served);
  const lines: ReportLine[] = lineList.map((l) => {
    const dir = l.directions.find((d) => d.from && d.to);
    const genericName = !!l.ref && l.name === t.transit.lineName(l.ref);
    const ranks = served.get(l.ref ?? "") ?? [];
    return {
      ref: l.ref ?? l.name,
      route: dir ? `${dir.from} -> ${dir.to}` : genericName ? "—" : l.name,
      operator: l.operator ?? "—",
      regions: ranks.length ? [...ranks].sort((a, b) => a - b).join(", ") : msg.addedByClient,
      role: lineRoleLabel(l),
    };
  });

  const hints: string[] = [];
  const names = [...new Set(mapRegions.map((r) => r.name))];
  if (names.length) hints.push(msg.hintNeighbourhoods(names.slice(0, 10)));
  if (f.budget) hints.push(msg.hintPrice(money(f.budget), flexCeiling ? money(flexCeiling) : null, basis));
  const property = [
    types.join(" ou "),
    f.minBedrooms ? `${t.ui.listing.bedrooms(f.minBedrooms)} ou mais` : "",
    f.minBathrooms ? `${f.minBathrooms}+ ${msg.bathrooms.toLowerCase()}` : "",
    f.minParking ? `${f.minParking}+ ${msg.parking.toLowerCase()}` : "",
    f.minArea ? `${f.minArea}+ m²` : "",
  ].filter(Boolean);
  if (property.length) hints.push(msg.hintProperty(property));
  if (mustHave.length) hints.push(msg.hintMustHave(mustHave));
  if (input.importanceOf(TRANSIT_CRITERION) > 0)
    hints.push(msg.hintTransit(lineList.slice(0, 8).map((l) => l.ref ?? l.name)));
  const places = chosenIds
    .filter((id) => input.importanceOf(id) > 0)
    .map((id) => `${featureLabel(id)} ${msg.placeDetail(meters(chosen[id]!))}`);
  if (places.length) hints.push(msg.hintPlaces(places));
  if (mapRegions.length > 3) hints.push(msg.hintFlexible);

  return {
    title: msg.title,
    subtitle: msg.subtitle(cityName),
    generatedOn: msg.generatedOn(dateFmt(date)),
    year: date.getFullYear(),
    intro: msg.intro,
    summary: [
      { label: msg.summaryCity, value: cityName },
      { label: msg.summaryWork, value: work?.label ? work.label.split(",")[0]! : "—" },
      { label: msg.summaryBudget, value: f.budget ? msg.budgetShort(money(f.budget)) : msg.noLimit },
      { label: msg.summaryPriority, value: priorities[0]?.name ?? "—" },
    ],
    profile,
    priorities,
    regions,
    regionsNote: msg.regionsNote(mapRegions.length, eligible.length),
    mapRegions,
    lines,
    mapLineRefs: [...served.keys()],
    hints,
    method: msg.method,
  };
}
