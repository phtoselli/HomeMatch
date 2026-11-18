import type { GState as GStateClass, jsPDF as JsPDF } from "jspdf";
import type { RegionLevel } from "@homematch/contracts";
import { t } from "@homematch/i18n";
import type { MapImage } from "./map-image";
import type { ReportData } from "./report-data";

const msg = t.ui.report;

// A4 portrait, in millimetres.
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = 22;
const BOTTOM = PAGE_H - 18;

const INK: [number, number, number] = [33, 37, 41];
const MUTED: [number, number, number] = [108, 117, 125];
const RULE: [number, number, number] = [222, 226, 230];
const ACCENT: [number, number, number] = [25, 113, 194];
/** Same hues as the map (LEVEL_COLOR), as RGB for the PDF. */
const LEVEL_RGB: Record<RegionLevel, [number, number, number]> = {
  excellent: [29, 165, 77],
  good: [111, 189, 40],
  ok: [235, 172, 33],
};

/**
 * The PDF fonts (Helvetica) cover Latin-1, which has every Portuguese letter. Symbols outside it would print as
 * garbage, so they are swapped for plain equivalents.
 */
export const pdfText = (s: string) =>
  s
    .replace(/→/g, "->")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/≈/g, "~")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\xFF]/g, "");

class Writer {
  y = TOP;
  constructor(private doc: JsPDF) {}

  ensure(height: number) {
    if (this.y + height > BOTTOM) {
      this.doc.addPage();
      this.y = TOP;
    }
  }

  lines(text: string, size: number, width = CONTENT_W): string[] {
    this.doc.setFontSize(size);
    return this.doc.splitTextToSize(pdfText(text), width) as string[];
  }

  /** Section title; `keepWith` keeps it on the same page as the start of its content. */
  heading(text: string, keepWith = 24) {
    this.ensure(16 + keepWith);
    this.y += 4;
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(13);
    this.doc.setTextColor(...INK);
    this.doc.text(pdfText(text), MARGIN, this.y);
    this.y += 2.5;
    this.doc.setDrawColor(...ACCENT);
    this.doc.setLineWidth(0.6);
    this.doc.line(MARGIN, this.y, MARGIN + 18, this.y);
    this.y += 6;
  }

  paragraph(text: string, size = 9.5, color = INK) {
    const ls = this.lines(text, size);
    const lh = size * 0.45;
    this.ensure(ls.length * lh + 2);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...color);
    this.doc.text(ls, MARGIN, this.y);
    this.y += ls.length * lh + 2.5;
  }

  bullets(items: string[], size = 9.5) {
    const lh = size * 0.45;
    for (const item of items) {
      const ls = this.lines(item, size, CONTENT_W - 6);
      this.ensure(ls.length * lh + 2);
      this.doc.setFillColor(...ACCENT);
      this.doc.circle(MARGIN + 1.5, this.y - 1.2, 0.8, "F");
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(...INK);
      this.doc.text(ls, MARGIN + 6, this.y);
      this.y += ls.length * lh + 2;
    }
    this.y += 1;
  }

  /** Two columns: label on the left, wrapped value on the right. */
  keyValues(rows: { label: string; value: string }[]) {
    const labelW = 52;
    const size = 9.5;
    const lh = size * 0.45;
    for (const r of rows) {
      const ls = this.lines(r.value, size, CONTENT_W - labelW);
      const h = Math.max(1, ls.length) * lh + 3;
      this.ensure(h);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...MUTED);
      this.doc.setFontSize(size);
      this.doc.text(this.lines(r.label, size, labelW - 3), MARGIN, this.y);
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(...INK);
      this.doc.text(ls, MARGIN + labelW, this.y);
      this.y += h;
      this.doc.setDrawColor(...RULE);
      this.doc.setLineWidth(0.2);
      this.doc.line(MARGIN, this.y - lh - 0.2, MARGIN + CONTENT_W, this.y - lh - 0.2);
    }
    this.y += 2;
  }

  /** Table with a header row (repeated on page breaks); `swatch` paints a colored dot before a cell. */
  table(
    columns: { title: string; width: number }[],
    rows: { cells: string[]; swatch?: { col: number; rgb: [number, number, number] } }[],
    size = 8.5,
  ) {
    const lh = size * 0.43;
    const pad = 1.6;
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * CONTENT_W);
    const header = () => {
      this.ensure(9);
      this.doc.setFillColor(241, 243, 245);
      this.doc.rect(MARGIN, this.y - 4, CONTENT_W, 7, "F");
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(size);
      this.doc.setTextColor(...MUTED);
      let x = MARGIN + pad;
      columns.forEach((c, i) => {
        this.doc.text(pdfText(c.title), x, this.y);
        x += widths[i]!;
      });
      this.y += 6.5;
    };
    header();
    for (const row of rows) {
      const cellLines = row.cells.map((c, i) =>
        this.lines(c, size, widths[i]! - pad * 2 - (row.swatch?.col === i ? 3.5 : 0)),
      );
      const h = Math.max(...cellLines.map((l) => l.length)) * lh + pad * 2;
      if (this.y + h > BOTTOM) {
        this.doc.addPage();
        this.y = TOP;
        header();
      }
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(size);
      this.doc.setTextColor(...INK);
      let x = MARGIN + pad;
      cellLines.forEach((ls, i) => {
        let tx = x;
        if (row.swatch?.col === i) {
          this.doc.setFillColor(...row.swatch.rgb);
          this.doc.circle(x + 1.2, this.y - 1.1, 1.2, "F");
          tx += 3.5;
        }
        this.doc.text(ls, tx, this.y);
        x += widths[i]!;
      });
      this.y += h;
      this.doc.setDrawColor(...RULE);
      this.doc.setLineWidth(0.2);
      this.doc.line(MARGIN, this.y - lh - pad + 0.6, MARGIN + CONTENT_W, this.y - lh - pad + 0.6);
    }
    this.y += 2;
  }

  image(map: MapImage) {
    const h = (CONTENT_W * map.height) / map.width;
    this.ensure(h + 14);
    this.doc.addImage(map.dataUrl, "JPEG", MARGIN, this.y, CONTENT_W, h);
    this.doc.setDrawColor(...RULE);
    this.doc.setLineWidth(0.3);
    this.doc.rect(MARGIN, this.y, CONTENT_W, h);
    this.y += h + 5;
  }

  /** Legend under the map: colored marks with their meaning. */
  legend(items: { rgb: [number, number, number]; label: string; kind: "dot" | "line" | "dash" | "ring" }[]) {
    const size = 8;
    this.ensure(8);
    this.doc.setFontSize(size);
    let x = MARGIN;
    for (const it of items) {
      const w = this.doc.getTextWidth(pdfText(it.label)) + 9;
      if (x + w > MARGIN + CONTENT_W) {
        x = MARGIN;
        this.y += 5;
        this.ensure(6);
      }
      this.doc.setDrawColor(...it.rgb);
      this.doc.setFillColor(...it.rgb);
      if (it.kind === "dot") this.doc.circle(x + 1.6, this.y - 1.1, 1.6, "F");
      else if (it.kind === "ring") {
        this.doc.setLineWidth(0.6);
        this.doc.circle(x + 1.6, this.y - 1.1, 1.5, "S");
      } else {
        this.doc.setLineWidth(0.9);
        if (it.kind === "dash") this.doc.setLineDashPattern([0.6, 1.2], 0);
        this.doc.line(x, this.y - 1.1, x + 4, this.y - 1.1);
        this.doc.setLineDashPattern([], 0);
      }
      this.doc.setTextColor(...MUTED);
      this.doc.text(pdfText(it.label), x + 5.5, this.y);
      x += w + 3;
    }
    this.y += 6;
  }
}

/** Discreet header, footer with page numbers and a light diagonal watermark on every page. */
function decoratePages(doc: JsPDF, GState: typeof GStateClass, generatedOn: string) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    // Watermark: large, rotated and almost transparent, so the content stays readable.
    doc.saveGraphicsState();
    doc.setGState(new GState({ opacity: 0.06 }));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(78);
    doc.setTextColor(...INK);
    const mark = msg.brand;
    const w = doc.getTextWidth(mark);
    const angle = 45;
    const rad = (angle * Math.PI) / 180;
    const cx = PAGE_W / 2;
    const cy = PAGE_H / 2;
    doc.text(mark, cx - (w / 2) * Math.cos(rad), cy + (w / 2) * Math.sin(rad), { angle });
    doc.restoreGraphicsState();

    // Header: app name, small and grey.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(msg.brand, MARGIN, 11);
    doc.text(pdfText(generatedOn), PAGE_W - MARGIN, 11, { align: "right" });
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, 13, PAGE_W - MARGIN, 13);

    // Footer.
    doc.line(MARGIN, PAGE_H - 13, PAGE_W - MARGIN, PAGE_H - 13);
    doc.setFontSize(7);
    doc.text(pdfText(msg.footer), MARGIN, PAGE_H - 9);
    doc.text(pdfText(msg.page(i, total)), PAGE_W - MARGIN, PAGE_H - 9, { align: "right" });
  }
}

/** Builds the PDF document (jsPDF is loaded only when the user exports). */
export async function buildPdf(data: ReportData, map: MapImage | null): Promise<JsPDF> {
  const { jsPDF, GState } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: pdfText(data.title), subject: pdfText(data.subtitle), creator: msg.brand });
  const w = new Writer(doc);

  // Title block.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.setTextColor(...INK);
  doc.text(w.lines(data.title, 19), MARGIN, w.y + 2);
  w.y += 10;
  doc.setFont("helvetica", "normal");
  w.paragraph(data.subtitle, 11, MUTED);
  w.paragraph(data.intro, 9.5);

  w.heading(msg.profileTitle);
  w.keyValues(data.profile);

  if (data.priorities.length) {
    w.heading(msg.prioritiesTitle);
    w.table(
      [
        { title: msg.priority, width: 45 },
        { title: msg.importance, width: 22 },
        { title: msg.detail, width: 33 },
      ],
      data.priorities.map((p) => ({ cells: [p.name, p.importance, p.detail] })),
      9,
    );
  }

  w.heading(msg.mapTitle, map ? (CONTENT_W * map.height) / map.width + 10 : 24);
  if (map) {
    w.image(map);
    if (!map.basemap) w.paragraph(msg.mapUnavailable, 8, MUTED);
  }
  w.legend([
    { rgb: INK, label: msg.legendWork, kind: "dot" },
    { rgb: LEVEL_RGB.excellent, label: t.regions.levels.excellent, kind: "dot" },
    { rgb: LEVEL_RGB.good, label: t.regions.levels.good, kind: "dot" },
    { rgb: LEVEL_RGB.ok, label: t.regions.levels.ok, kind: "dot" },
    { rgb: MUTED, label: msg.legendRegion, kind: "ring" },
    { rgb: ACCENT, label: msg.legendLine, kind: "line" },
    { rgb: ACCENT, label: msg.legendEstimated, kind: "dash" },
    { rgb: MUTED, label: msg.legendBoundary, kind: "dash" },
  ]);

  if (data.regions.length) {
    w.heading(msg.regionsTitle);
    w.table(
      [
        { title: msg.rank, width: 5 },
        { title: msg.region, width: 27 },
        { title: msg.level, width: 13 },
        { title: msg.commuteCol, width: 14 },
        { title: msg.linesCol, width: 18 },
        { title: msg.nearbyCol, width: 23 },
      ],
      data.regions.map((r) => ({
        cells: [String(r.rank), r.name, r.levelLabel, r.commute, r.lines, r.nearby],
        swatch: { col: 2, rgb: LEVEL_RGB[r.level] },
      })),
    );
    w.paragraph(data.regionsNote, 8, MUTED);
  }

  w.heading(msg.linesTitle);
  if (data.lines.length) {
    // Lines known only by number have no itinerary: the column only shows when some line has one.
    const withRoute = data.lines.some((l) => l.route !== "—");
    w.table(
      [
        { title: msg.line, width: 10 },
        ...(withRoute ? [{ title: msg.route, width: 34 }] : []),
        { title: msg.regionsServed, width: 22 },
        { title: msg.operator, width: 16 },
        { title: msg.role, width: 22 },
      ],
      data.lines.map((l) => ({
        cells: [l.ref, ...(withRoute ? [l.route] : []), l.regions, l.operator, l.role],
      })),
    );
  } else w.paragraph(msg.noLines, 9, MUTED);

  if (data.hints.length) {
    w.heading(msg.hintsTitle);
    w.bullets(data.hints);
  }

  w.heading(msg.methodTitle);
  for (const p of data.method) w.paragraph(p, 8.5, MUTED);

  decoratePages(doc, GState, data.generatedOn);
  return doc;
}
