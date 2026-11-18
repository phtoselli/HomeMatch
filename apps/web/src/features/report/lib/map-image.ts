import type { AnalysisResult, BBox, BusLine, City, LatLng, Region, RegionLevel } from "@homematch/contracts";
import { atLeast } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { LEVEL_COLOR } from "@/shared/lib/format";

export interface MapImageInput {
  city: City | null;
  work: LatLng | null;
  analysis: AnalysisResult | null;
  /** Regions to number on the map (same numbers as the PDF table). */
  regions: Region[];
  minLevel: RegionLevel;
  busLines: BusLine[];
  /** Analysis lines to draw (by number); estimated legs are always drawn. Without it, every line is drawn. */
  lineRefs?: string[];
  width?: number;
  height?: number;
}

export interface MapImage {
  dataUrl: string;
  width: number;
  height: number;
  /** False when the street tiles did not load (overlays only). */
  basemap: boolean;
}

const TILE = 256;
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const TILE_TIMEOUT_MS = 10_000;

/** Web Mercator, in pixels at zoom 0. */
const projX = (lng: number) => ((lng + 180) / 360) * TILE;
const projY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE;
};

/** Area to show: the regions and the work location; without regions, the city. */
export function mapBounds(input: Pick<MapImageInput, "city" | "work" | "regions">): BBox | null {
  const boxes: BBox[] = input.regions.map((r) => r.bbox);
  if (input.work)
    boxes.push({ south: input.work.lat, north: input.work.lat, west: input.work.lng, east: input.work.lng });
  if (!input.regions.length && input.city) boxes.push(input.city.bbox);
  if (!boxes.length) return null;
  const b = {
    south: Math.min(...boxes.map((x) => x.south)),
    north: Math.max(...boxes.map((x) => x.north)),
    west: Math.min(...boxes.map((x) => x.west)),
    east: Math.max(...boxes.map((x) => x.east)),
  };
  const padLat = Math.max((b.north - b.south) * 0.08, 0.004);
  const padLng = Math.max((b.east - b.west) * 0.08, 0.004);
  return { south: b.south - padLat, north: b.north + padLat, west: b.west - padLng, east: b.east + padLng };
}

/** Highest zoom where the box fits the image. */
export function fitZoom(b: BBox, width: number, height: number): number {
  const dx = projX(b.east) - projX(b.west);
  const dy = projY(b.south) - projY(b.north);
  const z = Math.floor(Math.log2(Math.min(width / Math.max(dx, 1e-9), height / Math.max(dy, 1e-9))));
  return Math.max(3, Math.min(16, z));
}

function loadTile(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // the tile server sends CORS headers: the canvas stays exportable
    const timer = setTimeout(() => resolve(null), TILE_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Draws the report map on a canvas: OpenStreetMap streets, city boundary, the analysis grid colored by level, bus
 * lines (estimated legs dotted), numbered regions and the work marker. No listings.
 */
export async function renderMapImage(input: MapImageInput): Promise<MapImage | null> {
  const width = input.width ?? 1400;
  const height = input.height ?? 900;
  const bounds = mapBounds(input);
  if (!bounds) return null;
  const z = fitZoom(bounds, width, height);
  const scale = 2 ** z;
  const cx = ((projX(bounds.west) + projX(bounds.east)) / 2) * scale;
  const cy = ((projY(bounds.north) + projY(bounds.south)) / 2) * scale;
  const ox = cx - width / 2;
  const oy = cy - height / 2;
  const px = (p: LatLng) => [projX(p.lng) * scale - ox, projY(p.lat) * scale - oy] as const;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#f1f3f5";
  ctx.fillRect(0, 0, width, height);

  // Street tiles.
  const n = 2 ** z;
  const tiles: Promise<{ img: HTMLImageElement | null; x: number; y: number }>[] = [];
  for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + width) / TILE); tx++)
    for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + height) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wrapped = ((tx % n) + n) % n;
      tiles.push(loadTile(TILE_URL(z, wrapped, ty)).then((img) => ({ img, x: tx * TILE - ox, y: ty * TILE - oy })));
    }
  const loaded = await Promise.all(tiles);
  const ok = loaded.filter((x) => x.img);
  for (const { img, x, y } of ok) ctx.drawImage(img!, x, y);
  const basemap = ok.length >= loaded.length / 2;
  // Light veil so the colored overlays stand out over the streets.
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(0, 0, width, height);

  // City boundary ([lng, lat] rings).
  if (input.city?.boundary) {
    ctx.save();
    ctx.strokeStyle = "#495057";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    for (const poly of input.city.boundary)
      for (const ring of poly) {
        ctx.beginPath();
        ring.forEach(([lng, lat], i) => {
          const [x, y] = px({ lat, lng });
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
      }
    ctx.restore();
  }

  // Analysis grid, by level.
  const a = input.analysis;
  if (a) {
    ctx.save();
    ctx.globalAlpha = 0.42;
    const half = a.cellSizeM / 2;
    for (const c of a.cells) {
      if (!atLeast(c.level, input.minLevel)) continue;
      const dLat = half / 111_320;
      const dLng = half / (111_320 * Math.cos((c.lat * Math.PI) / 180));
      const [x1, y1] = px({ lat: c.lat + dLat, lng: c.lng - dLng });
      const [x2, y2] = px({ lat: c.lat - dLat, lng: c.lng + dLng });
      ctx.fillStyle = LEVEL_COLOR[c.level];
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    }
    ctx.restore();
  }

  // Bus lines: the analysis' and the ones the user added.
  const drawLine = (paths: [number, number][][], color: string, dashed: boolean) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = dashed ? 3 : 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.9;
    if (dashed) ctx.setLineDash([3, 9]);
    for (const path of paths) {
      ctx.beginPath();
      path.forEach(([lat, lng], i) => {
        const [x, y] = px({ lat, lng });
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    ctx.restore();
  };
  const wanted = input.lineRefs ? new Set(input.lineRefs) : null;
  for (const r of a?.routes ?? [])
    if (!wanted || r.estimated || (r.ref && wanted.has(r.ref))) drawLine(r.shape ?? [r.path], r.color, !!r.estimated);
  for (const l of input.busLines) drawLine(l.segments, l.color, false);

  // Numbered regions (same numbers as the table).
  ctx.font = "bold 15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const r of input.regions) {
    const [x, y] = px(r);
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = LEVEL_COLOR[r.level];
    ctx.stroke();
    ctx.fillStyle = "#212529";
    ctx.fillText(String(r.rank), x, y + 1);
  }

  // Work marker.
  if (input.work) {
    const [x, y] = px(input.work);
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = "#212529";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(t.ui.report.legendWork.charAt(0), x, y + 1);
  }

  // Tile attribution (required by the OpenStreetMap tile policy).
  if (basemap) {
    const text = t.ui.report.mapAttribution;
    ctx.font = "13px system-ui, sans-serif";
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(width - w, height - 22, w, 22);
    ctx.fillStyle = "#495057";
    ctx.textAlign = "right";
    ctx.fillText(text, width - 6, height - 10);
  }

  try {
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.9), width, height, basemap };
  } catch {
    return null; // tainted canvas (should not happen with CORS tiles): the PDF goes without the map
  }
}
