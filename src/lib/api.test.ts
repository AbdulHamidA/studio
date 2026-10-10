import { describe, expect, it } from "vitest";
import { isEngineDeath } from "./api";

describe("isEngineDeath", () => {
  // The host restates engine failures, so the plain message and the raw
  // detail both have to be recognised.
  it("recognises a dead or memory-killed engine", () => {
    expect(isEngineDeath({ kind: "engine", message: "The engine stopped unexpectedly. It restarts on the next run.",
      detail: "engine error: the engine process exited unexpectedly" })).toBe(true);
    expect(isEngineDeath({ kind: "engine", message: "The engine ran out of memory and macOS stopped it.",
      detail: "engine error: the engine ran out of memory and macOS stopped it (Insufficient Memory)" })).toBe(true);
    expect(isEngineDeath({ kind: "engine_down", message: "engine not running" })).toBe(true);
  });

  it("leaves ordinary failures alone", () => {
    expect(isEngineDeath({ kind: "engine", message: "This model does not support that combination of settings." }))
      .toBe(false);
    expect(isEngineDeath("Cancelled.")).toBe(false);
  });
});
