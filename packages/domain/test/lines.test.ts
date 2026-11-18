import { describe, expect, it } from "vitest";
import type { BusLine, TransitRoute } from "@homematch/contracts";
import { t } from "@homematch/i18n";
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

describe("lines on the map", () => {
  it("merges directions and both origins (analysis + added) by number", () => {
    const out = summarizeLines(
      [route("emdec:353:1", "353"), route("emdec:353:2", "353"), route("emdec:100:1", "100")],
      [mine("emdec:353:1", "353", 1), mine("emdec:353:2", "353", 2)],
    );
    expect(out.map((l) => l.key)).toEqual(["100", "353"]); // numeric order
    const l353 = out[1]!;
    expect(l353.name).toBe("Alphaville / Terminal"); // the real name wins over "Linha 353"
    expect(l353.roles.sort()).toEqual(["mine", "work"]);
    expect(l353.directions).toHaveLength(2);
    expect(l353.directions[0]).toMatchObject({ from: "Tanquinho", to: "Centro" });
    expect(l353.timetableId).toBe("emdec:353");
    expect(out[0]!.roles).toEqual(["work"]);
  });

  it("an OpenStreetMap line (no operator) has no timetable", () => {
    const osm = { ...route("123456", "5.1"), id: "123456" };
    expect(summarizeLines([osm], [])[0]!.timetableId).toBeUndefined();
  });
});

describe("timetables", () => {
  const labels = ["Dias úteis", "Sábados", "Domingos/Feriados"];
  it("day type from the date", () => {
    expect(dayLabelFor(labels, new Date(2026, 10, 13))).toBe("Dias úteis"); // Friday
    expect(dayLabelFor(labels, new Date(2026, 10, 14))).toBe("Sábados");
    expect(dayLabelFor(labels, new Date(2026, 10, 15))).toBe("Domingos/Feriados");
  });
  it("next departures from now on", () => {
    const times = ["04:51", "05:12", "07:18", "07:39 R", "08:00"];
    expect(nextDepartures(times, 7 * 60 + 18)).toEqual(["07:18", "07:39 R", "08:00"]);
    expect(nextDepartures(times, 23 * 60)).toEqual([]);
  });
});

describe("departures after midnight", () => {
  it("00:00 at the end of the timetable is the last departure of the day, not the first", () => {
    const times = ["22:54", "23:27", "00:00"];
    expect(nextDepartures(times, 23 * 60)).toEqual(["23:27", "00:00"]);
    expect(nextDepartures(["05:00", "06:00"], 23 * 60)).toEqual([]);
  });
});

describe("order of the analysis lines", () => {
  const route = (id: string, ref: string, kind?: "nearWork" | "intercity" | "estimated" | "feeder") => ({
    id,
    ref,
    name: `Linha ${ref}`,
    mode: "bus" as const,
    color: "#000",
    path: [[0, 0] as [number, number]],
    kind,
  });

  it("first those near work, then intercity, estimated and feeder lines", () => {
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
    expect(lineRoleLabel(lines[0]!)).toBe(t.transit.lineRoles.nearWork);
    expect(lineRoleLabel(lines[2]!)).toBe(t.transit.lineRoles.intercity);
  });

  it("the strongest role among the directions wins", () => {
    const [l] = summarizeLines([route("x1", "353", "feeder"), route("x2", "353", "nearWork")], []);
    expect(l!.kind).toBe("nearWork");
  });
});
