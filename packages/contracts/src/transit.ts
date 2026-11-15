import { z } from "zod";
import { latLngTupleSchema } from "./geo.js";
import { TRANSIT_MODES } from "./constants.js";

export const transitModeSchema = z.enum(TRANSIT_MODES);

/** Linha que a análise usa para chegar ao trabalho. */
export const transitRouteSchema = z.object({
  /** Id da relação OSM ou "<operador>:<linha>:<sentido>". */
  id: z.string(),
  ref: z.string().optional(),
  name: z.string(),
  mode: transitModeSchema,
  color: z.string(),
  operator: z.string().optional(),
  /** Paradas em ordem, [lat, lng]. Usado no cálculo e, sem `shape`, para desenhar a linha. */
  path: z.array(latLngTupleSchema),
  /** Traçado pelas ruas (quando a fonte tem), só para desenhar. */
  shape: z.array(z.array(latLngTupleSchema)).optional(),
});
export type TransitRoute = z.infer<typeof transitRouteSchema>;

export const busStopSchema = z.object({ lat: z.number(), lng: z.number(), name: z.string().optional() });
export type BusStop = z.infer<typeof busStopSchema>;

/** Uma linha de ônibus/metrô (um sentido) com o traçado exato e as paradas. */
export const busLineSchema = z.object({
  /** Relação OSM ("123456") ou "<operador>:<linha>:<sentido>" (ex.: "emdec:353:1"). */
  id: z.string(),
  ref: z.string().optional(),
  name: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  mode: transitModeSchema,
  color: z.string(),
  operator: z.string().optional(),
  website: z.string().optional(),
  /** [lat, lng] */
  segments: z.array(z.array(latLngTupleSchema)),
  stops: z.array(busStopSchema),
  /** De onde veio: "osm" ou o id do operador (ex.: "emdec"). */
  source: z.string().optional(),
  /** Sentido da linha no site do operador (1 ou 2). */
  direction: z.number().optional(),
  /** Distância da parada mais próxima do trabalho (busca "linhas perto do trabalho"). */
  nearWorkM: z.number().optional(),
});
export type BusLine = z.infer<typeof busLineSchema>;

/** Grade de horários de partida de uma linha (por sentido e tipo de dia). */
export const lineTimetableSchema = z.object({
  ref: z.string(),
  name: z.string().optional(),
  operator: z.string().optional(),
  directions: z.array(
    z.object({
      direction: z.number(),
      /** Ponto de partida e letreiro (destino). */
      from: z.string().optional(),
      to: z.string().optional(),
      /** "Dias úteis", "Sábados", "Domingos/Feriados" → ["04:51", "05:12", …] (com marcas como "R" quando houver). */
      days: z.array(z.object({ label: z.string(), times: z.array(z.string()) })),
    }),
  ),
  /** Observação do operador sobre a linha. */
  note: z.string().optional(),
  /** Quando o operador atualizou a grade ("12/11/2026, às 02h27"). */
  updated: z.string().optional(),
  /** Página oficial da linha. */
  source: z.string().optional(),
});
export type LineTimetable = z.infer<typeof lineTimetableSchema>;

/** Id de grade de horários: "<operador>:<linha>" ou "<operador>:<linha>:<sentido>". */
export const timetableIdSchema = z.string().regex(/^[a-z]+:[\w.-]+(:\d+)?$/i, "id de linha inválido");

/** Empresa/órgão que publica as linhas de ônibus de uma cidade. */
export const transitOperatorInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  site: z.string(),
  /** O que o HomeMatch lê de lá. */
  provides: z.string(),
});
export type TransitOperatorInfo = z.infer<typeof transitOperatorInfoSchema>;
