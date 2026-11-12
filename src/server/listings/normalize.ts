import type { PropertyType } from "../../shared/types.js";

/** Converte o rótulo de tipo de cada site para um tipo comum. */
export function normalizeType(label: string): PropertyType {
  const s = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (/studio|kitnet|kitchenette|loft|quitinete/.test(s)) return "studio";
  if (/condominio|casacondominio|vila/.test(s)) return "casa_condominio";
  if (/casa|sobrado|residence|house/.test(s)) return "casa";
  if (/apartamento|apartment|cobertura|flat|duplex|triplex|garden/.test(s)) return "apartamento";
  return "outro";
}

/** "R$ 7.000" → 7000; "1.605,50" → 1605.5. undefined se não houver número. */
export function parseBRL(s: string | undefined | null): number | undefined {
  if (!s) return undefined;
  const m = s.match(/\d[\d.]*(?:,\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** Primeiro inteiro do texto ("Quantidade de quartos 2" → 2; "82-90 m²" → 82). */
export function firstInt(s: string | undefined | null): number | undefined {
  const m = s?.match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
