import { t } from "@homematch/i18n";

/**
 * Portals with their own extension (valid for any city in Brazil). The order is the one shown on screen.
 * To add a portal: create its extension in extensions/ (or a SourceAdapter, if the site has a public API),
 * register it in listings/index.ts and describe it here.
 */
export interface PortalDef {
  id: string;
  label: string;
  home: string;
  note?: string;
}

const notes = t.sources.portalNotes;

export const PORTALS: PortalDef[] = [
  { id: "quintoandar", label: "QuintoAndar", home: "https://www.quintoandar.com.br" },
  { id: "chavesnamao", label: "Chaves na Mão", home: "https://www.chavesnamao.com.br", note: notes.chavesnamao },
  { id: "zapimoveis", label: "ZAP Imóveis", home: "https://www.zapimoveis.com.br", note: notes.zapimoveis },
  { id: "vivareal", label: "VivaReal", home: "https://www.vivareal.com.br", note: notes.vivareal },
  { id: "lopes", label: "Lopes", home: "https://www.lopes.com.br", note: notes.lopes },
  { id: "olx", label: "OLX", home: "https://www.olx.com.br", note: notes.olx },
];
