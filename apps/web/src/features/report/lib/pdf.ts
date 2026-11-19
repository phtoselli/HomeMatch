import type { GState as GStateClass, jsPDF as JsPDF } from "jspdf";
import type { RegionLevel } from "@homematch/contracts";
import { t } from "@homematch/i18n";
import type { MapImage } from "./map-image";
import type { ReportData } from "./report-data";

const msg = t.ui.report;

/** Where the copyright name in the footer links to. */
const AUTHOR_URL = "https://links.pedrotoselli.com/";

// A4 portrait, in millimetres.
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = 27;
const BOTTOM = PAGE_H - 20;

type Rgb = [number, number, number];
// Same palette as the app (tokens.css).
const INK: Rgb = [22, 33, 29];
const INK_2: Rgb = [51, 64, 59];
const MUTED: Rgb = [91, 103, 99];
const RULE: Rgb = [220, 226, 223];
const FRAME: Rgb = [201, 210, 206];
const MIST: Rgb = [242, 244, 243];
const ACCENT: Rgb = [11, 110, 85];
const ACCENT_INK: Rgb = [10, 90, 70];
const BUS: Rgb = [47, 91, 211];
/** Same colors as the map (LEVEL_COLOR). */
const LEVEL_RGB: Record<RegionLevel, Rgb> = {
  excellent: [11, 110, 85],
  good: [79, 168, 138],
  ok: [127, 168, 151],
};

/** A color seen through `alpha` over white paper (like the translucent areas on the map). */
const tint = (rgb: Rgb, alpha: number): Rgb => rgb.map((c) => Math.round(c * alpha + 255 * (1 - alpha))) as Rgb;

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

  /** One line that fits `width`, cut with "..." when it does not. */
  fit(text: string, size: number, width: number): string {
    this.doc.setFontSize(size);
    let s = pdfText(text);
    if (this.doc.getTextWidth(s) <= width) return s;
    while (s.length > 1 && this.doc.getTextWidth(`${s}...`) > width) s = s.slice(0, -1);
    return `${s.trimEnd()}...`;
  }

  /** Section title: "1. Title" prints the number apart, in green ("01"); `keepWith` keeps it with its content. */
  heading(text: string, keepWith = 24) {
    this.ensure(14 + keepWith);
    this.y += 5;
    const m = /^(\d+)\.\s*(.*)$/.exec(text);
    this.doc.setFont("helvetica", "bold");
    let x = MARGIN;
    if (m) {
      this.doc.setFontSize(9.5);
      this.doc.setTextColor(...ACCENT);
      this.doc.text(m[1]!.padStart(2, "0"), x, this.y);
      x += 8;
    }
    this.doc.setFontSize(13.5);
    this.doc.setTextColor(...INK);
    this.doc.text(pdfText(m ? m[2]! : text), x, this.y);
    this.y += 7;
  }

  paragraph(text: string, size = 9.5, color = INK, width = CONTENT_W, x = MARGIN) {
    const ls = this.lines(text, size, width);
    const lh = size * 0.45;
    this.ensure(ls.length * lh + 2);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...color);
    this.doc.text(ls, x, this.y);
    this.y += ls.length * lh + 2.5;
  }

  /** Four key facts side by side in a thin rounded frame. */
  summary(cells: { label: string; value: string }[]) {
    const h = 15;
    this.ensure(h + 4);
    const w = CONTENT_W / cells.length;
    this.doc.setDrawColor(...FRAME);
    this.doc.setLineWidth(0.25);
    this.doc.roundedRect(MARGIN, this.y, CONTENT_W, h, 3, 3, "S");
    cells.forEach((c, i) => {
      const x = MARGIN + i * w;
      if (i) this.doc.line(x, this.y, x, this.y + h);
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(...MUTED);
      this.doc.text(this.fit(c.label, 7.5, w - 7), x + 3.5, this.y + 5.5);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...INK);
      this.doc.text(this.fit(c.value, 10, w - 7), x + 3.5, this.y + 11);
    });
    this.y += h + 4;
  }

  /** Numbered list (the number in green). */
  numbered(items: string[], size = 9.5) {
    const lh = size * 0.45;
    items.forEach((item, i) => {
      const ls = this.lines(item, size, CONTENT_W - 7);
      this.ensure(ls.length * lh + 2);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...ACCENT);
      this.doc.text(`${i + 1}.`, MARGIN, this.y);
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(...INK);
      this.doc.text(ls, MARGIN + 7, this.y);
      this.y += ls.length * lh + 2.2;
    });
    this.y += 1;
  }

  /** Two columns: label on the left, wrapped value on the right, separated by hairlines. */
  keyValues(rows: { label: string; value: string }[]) {
    const labelW = 52;
    const size = 9.5;
    const lh = size * 0.45;
    for (const r of rows) {
      const ls = this.lines(r.value, size, CONTENT_W - labelW);
      const h = Math.max(1, ls.length) * lh + 3.4;
      this.ensure(h);
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(...INK_2);
      this.doc.setFontSize(size);
      this.doc.text(this.lines(r.label, size, labelW - 3), MARGIN, this.y);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...INK);
      this.doc.text(ls, MARGIN + labelW, this.y);
      this.y += h;
      this.doc.setDrawColor(...RULE);
      this.doc.setLineWidth(0.2);
      this.doc.line(MARGIN, this.y - lh - 0.4, MARGIN + CONTENT_W, this.y - lh - 0.4);
    }
    this.y += 2;
  }

  /** Priorities as three short bars (filled = more important), with the name and what it means. */
  priorities(rows: { name: string; importance: string; level: number; detail: string }[]) {
    const size = 9.5;
    for (const r of rows) {
      this.ensure(7);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...INK);
      this.doc.text(this.fit(r.name, size, 60), MARGIN, this.y);
      for (let i = 0; i < 3; i++) {
        this.doc.setFillColor(...(i < r.level ? ACCENT : RULE));
        this.doc.roundedRect(MARGIN + 64 + i * 8.2, this.y - 2.4, 7, 2.2, 1.1, 1.1, "F");
      }
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(...INK_2);
      this.doc.text(this.fit(`${r.importance} · ${r.detail}`, size, CONTENT_W - 94), MARGIN + 94, this.y);
      this.y += 6.6;
    }
    this.y += 1.5;
  }

  /**
   * Table with a header row (repeated on page breaks). `level` prints a colored dot and the text in green; `badge`
   * prints the text inside a filled blue tag (bus line numbers).
   */
  table(
    columns: { title: string; width: number }[],
    rows: { cells: string[]; level?: { col: number; rgb: Rgb }; badge?: number }[],
    size = 8.5,
  ) {
    const lh = size * 0.43;
    const pad = 1.6;
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * CONTENT_W);
    const header = () => {
      this.ensure(9);
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(size);
      this.doc.setTextColor(...INK_2);
      let x = MARGIN + pad;
      columns.forEach((c, i) => {
        this.doc.text(pdfText(c.title), x, this.y);
        x += widths[i]!;
      });
      this.y += 2.4;
      this.doc.setDrawColor(...INK);
      this.doc.setLineWidth(0.25);
      this.doc.line(MARGIN, this.y, MARGIN + CONTENT_W, this.y);
      this.y += 4.6;
    };
    header();
    for (const row of rows) {
      const cellLines = row.cells.map((c, i) =>
        this.lines(c, size, widths[i]! - pad * 2 - (row.level?.col === i ? 3.5 : 0)),
      );
      const h = Math.max(...cellLines.map((l) => l.length)) * lh + pad * 2 + 0.6;
      if (this.y + h > BOTTOM) {
        this.doc.addPage();
        this.y = TOP;
        header();
      }
      this.doc.setFontSize(size);
      let x = MARGIN + pad;
      cellLines.forEach((ls, i) => {
        let tx = x;
        this.doc.setFont("helvetica", i === 0 || (i === 1 && row.level) ? "bold" : "normal");
        this.doc.setTextColor(...INK);
        if (row.level?.col === i) {
          this.doc.setFillColor(...row.level.rgb);
          this.doc.circle(x + 1.1, this.y - 1.1, 1.1, "F");
          tx += 3.5;
          this.doc.setFont("helvetica", "bold");
          this.doc.setTextColor(...ACCENT_INK);
        }
        if (row.badge === i && ls.length) {
          this.doc.setFont("helvetica", "bold");
          const bw = Math.max(9, this.doc.getTextWidth(ls[0]!) + 3.2);
          this.doc.setFillColor(...BUS);
          this.doc.roundedRect(x - 0.4, this.y - 3.3, bw, 4.6, 1.2, 1.2, "F");
          this.doc.setTextColor(255, 255, 255);
          this.doc.text(ls[0]!, x - 0.4 + bw / 2, this.y, { align: "center" });
        } else this.doc.text(ls, tx, this.y);
        x += widths[i]!;
      });
      this.y += h;
      this.doc.setDrawColor(...RULE);
      this.doc.setLineWidth(0.2);
      this.doc.line(MARGIN, this.y - lh - pad + 0.2, MARGIN + CONTENT_W, this.y - lh - pad + 0.2);
    }
    this.y += 2;
  }

  /** The map with rounded corners and a hairline frame. */
  image(map: MapImage) {
    const h = (CONTENT_W * map.height) / map.width;
    this.ensure(h + 14);
    const r = 3;
    this.doc.saveGraphicsState();
    this.doc.roundedRect(MARGIN, this.y, CONTENT_W, h, r, r, null);
    this.doc.clip();
    this.doc.discardPath();
    this.doc.addImage(map.dataUrl, "JPEG", MARGIN, this.y, CONTENT_W, h);
    this.doc.restoreGraphicsState();
    this.doc.setDrawColor(...FRAME);
    this.doc.setLineWidth(0.25);
    this.doc.roundedRect(MARGIN, this.y, CONTENT_W, h, r, r, "S");
    this.y += h + 5;
  }

  /** Legend under the map: marks drawn like on the map, with their meaning. */
  legend(
    items: {
      rgb: Rgb;
      label: string;
      kind: "dot" | "area" | "veil" | "line" | "dash" | "ring";
    }[],
  ) {
    const size = 8;
    this.ensure(8);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(size);
    let x = MARGIN;
    for (const it of items) {
      const w = this.doc.getTextWidth(pdfText(it.label)) + 7;
      if (x + w > MARGIN + CONTENT_W) {
        x = MARGIN;
        this.y += 5;
        this.ensure(6);
      }
      const cy = this.y - 1.1;
      this.doc.setDrawColor(...it.rgb);
      this.doc.setFillColor(...it.rgb);
      if (it.kind === "dot") this.doc.circle(x + 1.6, cy, 1.6, "F");
      else if (it.kind === "area" || it.kind === "veil") {
        this.doc.setFillColor(...tint(it.rgb, it.kind === "veil" ? 0.22 : 0.42));
        this.doc.setLineWidth(0.2);
        this.doc.roundedRect(x, cy - 1.6, 3.4, 3.2, 0.8, 0.8, it.kind === "veil" ? "F" : "FD");
      } else if (it.kind === "ring") {
        this.doc.setLineWidth(0.25);
        this.doc.circle(x + 1.6, cy, 1.6, "S");
      } else {
        this.doc.setLineWidth(it.kind === "line" ? 0.7 : 0.5);
        if (it.kind === "dash") this.doc.setLineDashPattern([0.6, 1.2], 0);
        this.doc.line(x, cy, x + 4, cy);
        this.doc.setLineDashPattern([], 0);
      }
      this.doc.setTextColor(...INK_2);
      this.doc.text(pdfText(it.label), x + 5.2, this.y);
      x += w + 4;
    }
    this.y += 6;
  }

  /** Grey box with a title and small paragraphs (how the regions were chosen). */
  note(title: string, paragraphs: string[]) {
    const size = 8.3;
    const lh = size * 0.45;
    const inner = CONTENT_W - 10;
    const blocks = paragraphs.map((p) => this.lines(p, size, inner));
    const h = 11 + blocks.reduce((s, b) => s + b.length * lh + 1.6, 0) + 2;
    this.ensure(h + 6);
    this.y += 3;
    this.doc.setFillColor(...MIST);
    this.doc.roundedRect(MARGIN, this.y, CONTENT_W, h, 3, 3, "F");
    let y = this.y + 7;
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(10);
    this.doc.setTextColor(...INK);
    this.doc.text(pdfText(title), MARGIN + 5, y);
    y += 5;
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(size);
    this.doc.setTextColor(...INK_2);
    for (const b of blocks) {
      this.doc.text(b, MARGIN + 5, y);
      y += b.length * lh + 1.6;
    }
    this.y += h + 2;
  }
}

/** Header with the brand, footer with the copyright, and a faint diagonal watermark on every page. */
function decoratePages(doc: JsPDF, GState: typeof GStateClass, generatedOn: string, year: number) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    // Watermark: large, rotated and almost transparent, so the content stays readable.
    doc.saveGraphicsState();
    doc.setGState(new GState({ opacity: 0.035 }));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(86);
    doc.setTextColor(...INK);
    const mark = msg.brand;
    const w = doc.getTextWidth(mark);
    const angle = 30;
    const rad = (angle * Math.PI) / 180;
    doc.text(mark, PAGE_W / 2 - (w / 2) * Math.cos(rad), PAGE_H / 2 + (w / 2) * Math.sin(rad), { angle });
    doc.restoreGraphicsState();

    // Header: green house mark + app name on the left, the date on the right, a dark hairline below.
    const lx = MARGIN;
    const ly = 8.2;
    doc.setFillColor(...ACCENT);
    doc.roundedRect(lx, ly, 5.6, 5.6, 1.5, 1.5, "F");
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.45);
    doc.setLineJoin("round");
    doc.setLineCap("round");
    doc.lines(
      [
        [1.55, -1.25],
        [1.55, 1.25],
      ],
      lx + 1.25,
      ly + 2.75,
    );
    doc.rect(lx + 1.75, ly + 2.6, 2.1, 1.85, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    doc.text(msg.brand, lx + 7.4, ly + 4.3);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(generatedOn), PAGE_W - MARGIN, ly + 4.3, { align: "right" });
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, 17, PAGE_W - MARGIN, 17);

    // Footer: copyright, the name linking to the author's page.
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_H - 14, PAGE_W - MARGIN, PAGE_H - 14);
    doc.setFontSize(8);
    const prefix = pdfText(msg.copyright(year, ""));
    doc.setTextColor(...MUTED);
    doc.text(prefix, MARGIN, PAGE_H - 9);
    doc.setTextColor(...ACCENT);
    doc.textWithLink(pdfText(msg.author), MARGIN + doc.getTextWidth(prefix), PAGE_H - 9, { url: AUTHOR_URL });
  }
}

/** Builds the PDF document (jsPDF is loaded only when the user exports). */
export async function buildPdf(data: ReportData, map: MapImage | null): Promise<JsPDF> {
  const { jsPDF, GState } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({
    title: pdfText(data.title),
    subject: pdfText(data.subtitle),
    creator: msg.brand,
    author: pdfText(msg.author),
  });
  const w = new Writer(doc);

  // Title block.
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...INK);
  const title = w.lines(data.title, 22);
  doc.text(title, MARGIN, w.y + 3);
  w.y += 3 + title.length * 9 + 1;
  w.paragraph(data.subtitle, 10.5, INK_2);
  w.paragraph(data.intro, 9, MUTED);
  w.y += 2;
  w.summary(data.summary);

  w.heading(msg.profileTitle);
  w.keyValues(data.profile);

  if (data.priorities.length) {
    w.heading(msg.prioritiesTitle);
    w.priorities(data.priorities);
  }

  w.heading(msg.mapTitle, map ? (CONTENT_W * map.height) / map.width + 10 : 24);
  if (map) {
    w.image(map);
    if (!map.basemap) w.paragraph(msg.mapUnavailable, 8, MUTED);
  }
  w.legend([
    { rgb: INK, label: msg.legendWork, kind: "dot" },
    { rgb: LEVEL_RGB.excellent, label: t.regions.levels.excellent, kind: "area" },
    { rgb: LEVEL_RGB.good, label: t.regions.levels.good, kind: "area" },
    { rgb: LEVEL_RGB.ok, label: t.regions.levels.ok, kind: "veil" },
    { rgb: INK, label: msg.legendRegion, kind: "ring" },
    { rgb: BUS, label: msg.legendLine, kind: "line" },
    { rgb: BUS, label: msg.legendEstimated, kind: "dash" },
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
        level: { col: 2, rgb: LEVEL_RGB[r.level] },
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
        badge: 0,
      })),
    );
  } else w.paragraph(msg.noLines, 9, MUTED);

  if (data.hints.length) {
    w.heading(msg.hintsTitle);
    w.numbered(data.hints);
  }

  w.note(msg.methodTitle, data.method);

  decoratePages(doc, GState, data.generatedOn, data.year);
  return doc;
}
