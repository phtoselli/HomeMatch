import type { LatLng } from "@homematch/contracts";
import type { SearchArgs } from "../types.js";

/**
 * Um anúncio como o site mostra, antes de virar `Listing`. Cada extensão só precisa preencher isto;
 * o motor (engine.ts) cuida do resto: total, tipo, comodidades, posição no mapa e ids.
 */
export interface RawListing {
  /** Id no site (o motor põe o prefixo da fonte). */
  id: string;
  url: string;
  title?: string;
  /** "Apartamento", "Casa de condomínio"… (sem isso, o tipo sai do título). */
  typeLabel?: string;
  rent: number;
  condo?: number;
  iptu?: number;
  /** Total do mês quando o site informa; senão o motor soma aluguel + condomínio + IPTU. */
  total?: number;
  area?: number;
  bedrooms?: number;
  bathrooms?: number;
  parking?: number;
  street?: string;
  neighbourhood?: string;
  /** Cidade do imóvel, quando o site informa (para descartar os de outras cidades). */
  cityName?: string;
  geo?: LatLng;
  image?: string;
  /** Texto do anúncio (para achar armário, pia…). */
  description?: string;
  /** Imobiliária que anuncia (portais). */
  agency?: string;
}

/** O que a extensão recebe para montar a URL de uma página de busca. */
export interface PageCtx extends Omit<SearchArgs, "log" | "max"> {
  /** 1, 2, 3… */
  page: number;
  /** Site da imobiliária (extensões genéricas ou de plataforma). */
  site?: string;
}

/**
 * Extensão de um site: só o que é particular dele (URL da busca e leitura da página).
 * Busca, ritmo, cache, robots.txt, bloqueios, paginação e posição no mapa ficam no motor.
 */
export interface SiteExtension {
  id: string;
  label: string;
  /** Página inicial (para robots.txt e para mostrar na lista de fontes). */
  home: string;
  /**
   * "region": o site busca por bairro (uma busca por região);
   * "city": o site só lista a cidade inteira; o motor baixa uma vez (cache) e separa por região.
   */
  scope: "region" | "city";
  /** Anúncios por página (página com menos que isso = última). */
  perPage: number;
  /** Teto de páginas por busca (respeitar o site). */
  maxPages: number;
  /** Intervalo mínimo entre páginas do mesmo site. */
  minIntervalMs?: number;
  /** URL da página `ctx.page` da busca, ou null se não houver (bairro desconhecido etc.). */
  url(ctx: PageCtx): string | null;
  /** Próxima página a partir da atual (quando o site usa links "próxima" em vez de número). */
  next?(body: string, pageUrl: string, ctx: PageCtx): string | null;
  /** Parse puro da página (testado com fixture real em tests/fixtures). */
  parse(body: string, pageUrl: string): RawListing[];
}
