import { describe, expect, it } from "vitest";
import { boardingStops, commuteRef, directRef, transitFit, type ParsedRoute } from "../src/index.js";

describe("transit criterion", () => {
  it("a direct line counts as met for longer than a trip with a transfer", () => {
    const ref = commuteRef(20);
    expect(ref).toBe(45);
    expect(directRef(ref)).toBe(68);
    expect(transitFit({ minutes: 55 }, 20, ref)).toBe(0);
    expect(transitFit({ minutes: 55, direct: true }, 20, ref)).toBeGreaterThan(0.5);
    expect(transitFit({ minutes: 70, direct: true }, 20, ref)).toBe(0);
  });

  it("the faster, the better the fit", () => {
    expect(transitFit({ minutes: 20 }, 20, 45)).toBe(1);
    expect(transitFit({ minutes: 30 }, 20, 45)).toBeGreaterThan(transitFit({ minutes: 40 }, 20, 45));
  });

  it("boarding stops say when a transfer is needed", () => {
    const work = { lat: -22.9, lng: -47.06 };
    const toWork: ParsedRoute = {
      id: "a",
      ref: "1",
      name: "1",
      mode: "bus",
      color: "#000",
      ptv2: true,
      path: [
        [-22.92, -47.06],
        [-22.91, -47.06],
        [-22.9, -47.06],
      ],
    };
    const feeder: ParsedRoute = {
      ...toWork,
      id: "b",
      ref: "2",
      name: "2",
      path: [
        [-22.92, -47.09],
        [-22.92, -47.075],
        [-22.92, -47.0605],
      ],
    };
    const stops = boardingStops([toWork, feeder], work, undefined, { transfers: true });
    expect(stops.find((s) => s.routeId === "a")!.transfer).toBe(false);
    expect(stops.find((s) => s.routeId === "b")!.transfer).toBe(true);
  });
});
