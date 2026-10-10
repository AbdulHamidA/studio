import { describe, expect, it } from "vitest";
import { inscribedBounds, turnedSize } from "./Adjust";
import { estimateClipSeconds } from "./Video";
import { projectRemaining } from "./Upscale";
import { looksLikeMemory } from "./creation";

/** The arithmetic behind the creation screens, without a screen. */
describe("Adjust geometry", () => {
  it("swaps the sides on a quarter turn", () => {
    expect(turnedSize(1200, 800, 90)).toEqual({ w: 800, h: 1200 });
    expect(turnedSize(1200, 800, 0)).toEqual({ w: 1200, h: 800 });
  });

  it("keeps the whole frame when nothing is straightened", () => {
    expect(inscribedBounds(1200, 800, 1, 0)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("trims a straightened picture to a centred rectangle with no corners", () => {
    const b = inscribedBounds(1200, 800, 0, 5);
    expect(b.w).toBeLessThan(1);
    expect(b.h).toBeLessThan(1);
    expect(b.x).toBeCloseTo((1 - b.w) / 2);
    // The kept rectangle, in pixels, must fit inside the source turned by 5
    // degrees: each of its corners, turned back, lands inside the source.
    const box = turnedSize(1200, 800, 5);
    const a = 5 * Math.PI / 180;
    const hw = (b.w * box.w) / 2, hh = (b.h * box.h) / 2;
    for (const [x, y] of [[hw, hh], [-hw, hh], [hw, -hh], [-hw, -hh]]) {
      const ux = x * Math.cos(a) + y * Math.sin(a);
      const uy = -x * Math.sin(a) + y * Math.cos(a);
      expect(Math.abs(ux)).toBeLessThanOrEqual(600 + 1);
      expect(Math.abs(uy)).toBeLessThanOrEqual(400 + 1);
    }
  });
});

describe("one clip estimate", () => {
  it("scales with pixels, frames and steps from the measured run", () => {
    expect(estimateClipSeconds(640, 368, 9, 20)).toBe(4193);
    expect(estimateClipSeconds(640, 368, 18, 20)).toBe(8386);
    expect(estimateClipSeconds(640, 368, 9, 10)).toBe(2097);
  });
});

describe("upscale time left", () => {
  it("projects only once there is progress to project from", () => {
    expect(projectRemaining(10, null)).toBeNull();
    expect(projectRemaining(1, 0.5)).toBeNull();
    expect(projectRemaining(30, 0.25)).toBe(90);
  });
});

describe("memory failures", () => {
  it("recognises the engine's ways of running out", () => {
    expect(looksLikeMemory("[METAL] Command buffer execution failed: Insufficient Memory")).toBe(true);
    expect(looksLikeMemory("the prompt writer is not installed")).toBe(false);
  });
});
