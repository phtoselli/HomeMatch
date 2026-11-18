import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emdec,
  normalizeRef,
  parseEmdecDetail,
  parseEmdecNetwork,
  parseEmdecSearch,
  parseEmdecTimetable,
  toBusLine,
} from "../src/operators/emdec.js";
import { operatorFor } from "../src/operators/index.js";
import { boardingStops } from "@homematch/domain";

const fx = (f: string) => readFileSync(join(__dirname, "fixtures", f), "utf8");
const work = { lat: -22.8213, lng: -47.0352 }; // R. Embiruçu, Alphaville Campinas

describe("EMDEC (Campinas)", () => {
  const net = parseEmdecNetwork(fx("emdec-lin-353.js"), fx("emdec-pto-353.js"));

  it("reads both directions of line 353 with path and ordered stops", () => {
    expect(net.map((d) => `${d.ref}/${d.direction}`)).toEqual(["353/1", "353/2"]);
    const [outbound] = net;
    expect(outbound!.stops).toHaveLength(42);
    expect(outbound!.stops[0]!.street).toBe("EST MUN DO TANQUINHO");
    expect(outbound!.stops.map((s) => s.seq)).toEqual([...outbound!.stops.map((s) => s.seq)].sort((a, b) => a - b));
    expect(outbound!.segments.flat().length).toBeGreaterThan(300);
    expect(outbound!.segments[0]![0]![0]).toBeLessThan(-22); // [lat, lng]
    expect(outbound!.stops.find((s) => s.street === "R SABIU")!.lines).toEqual(["350", "353", "358"]);
  });

  it("search and detail: name, company, origin and destination of each direction", () => {
    const [hit] = parseEmdecSearch(JSON.parse(fx("emdec-search-353.json")));
    expect(hit).toEqual({ ref: "353", code: "353283D", name: "ALPHAVILLE", company: "URBCAMP-BONAVITA III" });
    const d = parseEmdecDetail(fx("emdec-detail-353.html"));
    expect(d.name).toBe("ALPHAVILLE");
    expect(d.directions[1]).toEqual({ from: "ESTR MUN DO TANQUINHO", to: "EST. EXPEDICIONÁRIOS" });
    expect(d.directions[2]).toEqual({ from: "AV DOS EXPEDICIONARIOS", to: "ALPHAVILLE" });
    const line = toBusLine(net[1]!, { name: hit!.name, company: hit!.company, detail: d });
    expect(line.id).toBe("emdec:353:2");
    expect(line.to).toBe("ALPHAVILLE");
    expect(line.website).toContain("linha=353&sentido=2");
  });

  it("line 353 boards near work (counts in the region analysis)", () => {
    const routes = net.map((d) => ({
      id: `emdec:${d.ref}:${d.direction}`,
      ref: d.ref,
      name: "353",
      mode: "bus" as const,
      color: "#000",
      path: d.stops.map((s) => [s.lat, s.lng] as [number, number]),
      ptv2: true,
    }));
    const stops = boardingStops(routes, work);
    expect(stops.length).toBeGreaterThan(10);
    expect(stops.every((s) => s.label === "Ônibus 353")).toBe(true);
  });

  it("Campinas uses EMDEC; other cities do not", () => {
    expect(operatorFor({ osmId: "R298227", name: "Campinas", stateCode: "SP" })).toBe(emdec);
    expect(operatorFor({ osmId: "R298319", name: "Valinhos", stateCode: "SP" })).toBeUndefined();
    expect(normalizeRef("126,1")).toBe("126.1");
    expect(normalizeRef("Linha 353")).toBe("353");
  });
});

describe("EMDEC: timetable", () => {
  const html = readFileSync(join(__dirname, "fixtures", "emdec-detail-353.html"), "utf8");
  const t = parseEmdecTimetable(html, "353");

  it("one block per direction, with starting stop and headsign", () => {
    expect(t.directions.map((d) => d.direction)).toEqual([1, 2]);
    expect(t.directions[0]).toMatchObject({ from: "ESTR MUN DO TANQUINHO", to: "EST. EXPEDICIONÁRIOS" });
  });

  it("weekdays, Saturdays and Sundays with ordered times", () => {
    const d1 = t.directions[0]!;
    expect(d1.days.map((d) => d.label)).toEqual(["Dias úteis", "Sábados", "Domingos/Feriados"]);
    expect(d1.days[0]!.times.slice(0, 3)).toEqual(["04:51", "05:12", "05:33"]);
    const all = t.directions.flatMap((d) => d.days.flatMap((x) => x.times));
    expect(all.length).toBe(307); // every time on the page
    expect(all.every((x) => /^\d{1,2}:\d{2}/.test(x))).toBe(true);
  });

  it("note and update date", () => {
    expect(t.note).toMatch(/^Esta linha opera com retorno reservado/);
    expect(t.updated).toBe("12/11/2026, às 02h27");
    expect(t.operator).toMatch(/^EMDEC/);
  });
});
