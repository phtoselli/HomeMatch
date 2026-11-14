/**
 * Portais com extensão própria (valem para qualquer cidade do Brasil). A ordem é a da lista na tela.
 * Para adicionar um portal: crie a extensão em extensions/ (ou um SourceAdapter, se o site tiver API
 * pública), registre em listings/index.ts e descreva aqui.
 */
export interface PortalDef {
  id: string;
  label: string;
  home: string;
  note?: string;
}

export const PORTALS: PortalDef[] = [
  { id: "quintoandar", label: "QuintoAndar", home: "https://www.quintoandar.com.br" },
  { id: "chavesnamao", label: "Chaves na Mão", home: "https://www.chavesnamao.com.br", note: "Junta anúncios de várias imobiliárias. 30 por bairro (o site só permite a 1ª página a robôs)." },
  { id: "zapimoveis", label: "ZAP Imóveis", home: "https://www.zapimoveis.com.br", note: "Endereço aproximado quando o anúncio não traz o número." },
  { id: "vivareal", label: "VivaReal", home: "https://www.vivareal.com.br", note: "Às vezes bloqueia a leitura automática." },
  { id: "lopes", label: "Lopes", home: "https://www.lopes.com.br", note: "Os 23 primeiros de cada bairro." },
  { id: "olx", label: "OLX", home: "https://www.olx.com.br", note: "Busca pela cidade; posição aproximada (centro do bairro)." },
];
