import { useState } from "react";
import type { AnalysisResult, BusLine, City, FeatureDef, LatLng, RegionLevel } from "@homematch/contracts";
import type { Filters, LineSummary } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { Icon, Spinner } from "@/shared/ui";
import { importanceOf, type Priorities } from "@/features/search";
import { renderMapImage } from "../../lib/map-image";
import { buildPdf } from "../../lib/pdf";
import { buildReportData } from "../../lib/report-data";

const msg = t.ui.report;

interface Props {
  city: City | null;
  work: (LatLng & { label?: string }) | null;
  filters: Filters;
  features: FeatureDef[];
  chosen: Record<string, number>;
  priorities: Priorities;
  analysis: AnalysisResult | null;
  minLevel: RegionLevel;
  busLines: BusLine[];
  lines: LineSummary[];
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** yyyy-mm-dd in the user's time zone (toISOString would give the UTC date). */
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Downloads the search profile as a PDF for a real estate agency (regions, lines and needs; no listings). */
export function ExportPdfButton(p: Props) {
  const [busy, setBusy] = useState(false);
  const ready = !!p.analysis && !!p.city;

  async function exportPdf() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const date = new Date();
      const data = buildReportData({
        city: p.city,
        work: p.work,
        filters: p.filters,
        features: p.features,
        chosen: p.chosen,
        importanceOf: (id) => importanceOf(p.priorities, id),
        analysis: p.analysis,
        minLevel: p.minLevel,
        lines: p.lines,
        date,
      });
      const map = await renderMapImage({
        city: p.city,
        work: p.work,
        analysis: p.analysis,
        regions: data.mapRegions,
        minLevel: p.minLevel,
        busLines: p.busLines,
        lineRefs: data.mapLineRefs,
      });
      const doc = await buildPdf(data, map);
      doc.save(msg.fileName(slug(p.city!.name), localDate(date)));
    } catch (e) {
      console.error(e);
      window.alert(msg.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="btn ghost"
      disabled={!ready || busy}
      aria-label={msg.button}
      title={ready ? msg.buttonHint : msg.needsAnalysis}
      onClick={exportPdf}
    >
      {busy ? <Spinner small /> : <Icon name="download" />} <span>{busy ? msg.generating : msg.button}</span>
    </button>
  );
}
