import { describe, expect, it } from "vitest";
import type { BusLine, TransitRoute } from "@homematch/contracts";
import { dayLabelFor, lineRoleLabel, nextDepartures, summarizeLines } from "../src/index.js";

const route = (id: string, ref: string): TransitRoute => ({
  id,
  ref,
  name: `Linha ${ref}`,
  mode: "bus",
  color: "#123",
  operator: "EMDEC",
  path: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
});
const mine = (id: string, ref: string, dir: number): BusLine => ({
  id,
  ref,
  name: "Alphaville / Terminal",
  from: dir === 1 ? "Tanquinho" : "Centro",
  to: dir === 1 ? "Centro" : "Tanquinho",
  mode: "bus",
  color: "#e8590c",
  operator: "EMDEC · Consórcio",
  website: "https://x",
  segments: [],
  stops: [{ lat: 0, lng: 0 }],
  direction: dir,
});

describe("linhas no mapa", () => {
  it("junta os sentidos e as duas origens (análise + adicionada) pelo número", () => {
    const out = summarizeLines(
      [route("emdec:353:1", "353"), route("emdec:353:2", "353"), route("emdec:100:1", "100")],
      [mine("emdec:353:1", "353", 1), mine("emdec:353:2", "353", 2)],
    );
    expect(out.map((l) => l.key)).toEqual(["100", "353"]); // ordem numérica
    const l353 = out[1]!;
    expect(l353.name).toBe("Alphaville / Terminal"); // o nome de verdade ganha do "Linha 353"
    expect(l353.roles.sort()).toEqual(["mine", "work"]);
    expect(l353.directions).toHaveLength(2);
    expect(l353.directions[0]).toMatchObject({ from: "Tanquinho", to: "Centro" });
    expect(l353.timetableId).toBe("emdec:353");
    expect(out[0]!.roles).toEqual(["work"]);
  });

  it("linha do OpenStreetMap (sem operador) não tem grade de horários", () => {
    const osm = { ...route("123456", "5.1"), id: "123456" };
    expect(summarizeLines([osm], [])[0]!.timetableId).toBeUndefined();
  });
});

describe("horários", () => {
  const labels = ["Dias úteis", "Sábados", "Domingos/Feriados"];
  it("tipo de dia pela data", () => {
    expect(dayLabelFor(labels, new Date(2026, 10, 13))).toBe("Dias úteis"); // sexta
    expect(dayLabelFor(labels, new Date(2026, 10, 14))).toBe("Sábados");
    expect(dayLabelFor(labels, new Date(2026, 10, 15))).toBe("Domingos/Feriados");
  });
  it("próximas saídas a partir de agora", () => {
    const times = ["04:51", "05:12", "07:18", "07:39 R", "08:00"];
    expect(nextDepartures(times, 7 * 60 + 18)).toEqual(["07:18", "07:39 R", "08:00"]);
    expect(nextDepartures(times, 23 * 60)).toEqual([]);
  });
});

describe("horários depois da meia-noite", () => {
  it("00:00 no fim da grade é a última saída do dia, não a primeira", () => {
    const times = ["22:54", "23:27", "00:00"];
    expect(nextDepartures(times, 23 * 60)).toEqual(["23:27", "00:00"]);
    expect(nextDepartures(["05:00", "06:00"], 23 * 60)).toEqual([]);
  });
});

describe("ordem das linhas da análise", () => {
  const route = (id: string, ref: string, kind?: "nearWork" | "intercity" | "estimated" | "feeder") => ({
    id,
    ref,
    name: `Linha ${ref}`,
    mode: "bus" as const,
    color: "#000",
    path: [[0, 0] as [number, number]],
    kind,
  });

  it("primeiro as que passam perto do trabalho, depois intermunicipais, estimadas e de baldeação", () => {
    const lines = summarizeLines(
      [
        route("a", "100", "feeder"),
        route("b", "EST", "estimated"),
        route("c", "353", "nearWork"),
        route("d", "620", "intercity"),
        route("e", "332", "nearWork"),
      ],
      [],
    );
    expect(lines.map((l) => l.ref)).toEqual(["332", "353", "620", "EST", "100"]);
    expect(lineRoleLabel(lines[0]!)).toBe("passa perto do trabalho");
    expect(lineRoleLabel(lines[2]!)).toBe("intermunicipal");
  });

  it("o papel mais forte entre os sentidos vence", () => {
    const [l] = summarizeLines([route("x1", "353", "feeder"), route("x2", "353", "nearWork")], []);
    expect(l!.kind).toBe("nearWork");
  });
});
