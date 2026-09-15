import { describe, it, expect } from "vitest";

/**
 * The board's two repairs must stay two repairs.
 *
 * A note and a redraw reconsider the whole frame: the seed moves, every
 * reference is read again, and a panel that was right except for one hand
 * comes back with a different face. That is the correct move when the panel is
 * wrong and the wrong one when it is nearly right, and for a long time it was
 * the only move the board had -- it sent `mask: null` on every request while
 * the engine, the Rust command and Studio all supported masking.
 *
 * These read the source, in the manner of `hookOrder.test.ts`, because there is
 * no harness in this project that renders a component. Crude, and it is the
 * check that holds the distinction in place: a masked repair that quietly
 * stopped sending its mask would still type-check, still run, and still return
 * a picture -- just the whole frame redrawn, which is the thing it exists not
 * to do.
 */
const SOURCE = Object.values(
  import.meta.glob("../components/Storyboard.tsx", {
    query: "?raw", import: "default", eager: true,
  }) as Record<string, string>,
)[0];

/** The body of one `const <name> = async (...) => { ... }` in the component. */
function fn(name: string): string {
  const at = SOURCE.indexOf(`const ${name} = async (`);
  expect(at, `${name} is declared`).toBeGreaterThan(-1);
  const open = SOURCE.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < SOURCE.length; i++) {
    if (SOURCE[i] === "{") depth++;
    else if (SOURCE[i] === "}" && --depth === 0) return SOURCE.slice(open, i + 1);
  }
  throw new Error(`${name} is not balanced`);
}

describe("the board repairs a region without redrawing the frame", () => {
  it("has a repair that is separate from redraw", () => {
    expect(SOURCE).toContain("const repair = async (");
    expect(SOURCE).toContain("const redraw = async (");
  });

  it("sends the painted mask, not null", () => {
    const body = fn("repair");
    expect(body).toContain("mask: maskId");
    expect(body).not.toContain("mask: null");
  });

  it("repairs the panel's own picture, not the cast sheet", () => {
    // A masked edit regenerates inside the painted region of the image it is
    // handed. Handed the reference sheet instead, it would paint over the
    // sheet and return something that is not this panel at all.
    expect(fn("repair")).toContain("images: [current]");
  });

  it("leaves the whole-frame redraw unmasked", () => {
    // `drawOne` draws a panel from its references; there is nothing to mask.
    // A mask arriving here would confine a first draw to a painted region.
    expect(fn("drawOne")).toContain("mask: null");
  });

  it("removes the mask from the vault once the engine has read it", () => {
    // Working material, not a library item, and it is a picture of what the
    // user wanted changed about their own manuscript.
    const body = fn("repair");
    expect(body).toContain("api.vaultDelete(maskId)");
    expect(body).toContain("} finally {");
  });

  it("files the previous picture before overwriting the panel", () => {
    for (const name of ["repair", "drawOne"]) {
      const body = fn(name);
      const filed = body.indexOf("supersede(");
      const replaced = body.indexOf("setDrawn(");
      expect(filed, `${name} files the old picture`).toBeGreaterThan(-1);
      expect(filed, `${name} files it before replacing it`).toBeLessThan(replaced);
    }
  });

  it("retires the composed pages when a panel changes", () => {
    // A page is only as current as the panels in it.
    for (const name of ["repair", "drawOne"]) {
      expect(fn(name)).toContain("setPages([]); setOverflow([]);");
    }
  });
});
