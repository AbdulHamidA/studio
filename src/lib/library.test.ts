import { describe, expect, it } from "vitest";
import {
  applyPick, aspectOf, browsable, buildEntries, centred, clampView, clock, dateBucket,
  descendants, expandPicked, filterItems, fitScale, justify, lineage, markerAt, matchesQuery,
  modelCounts, NO_FILTER, sectionize, shelfCounts, shelvesOf, sortEntries, zoomAbout,
} from "./library";
import type { VaultItem } from "./types";

const item = (over: Partial<VaultItem>): VaultItem => ({
  id: "x", kind: "generate", name: "x.png", mime: "image/png", bytes: 10, model: "Flux",
  prompt: "", seed: 1, width: 1024, height: 1024, steps: 4, guidance: null, inputs: [],
  created_at: "2026-10-11T10:00:00+00:00", duration_ms: 0, ...over,
});

const NOW = new Date(2026, 9, 11, 15, 0, 0); // Sunday 11 October 2026, local
const local = (y: number, m: number, d: number) => new Date(y, m, d, 12).toISOString();

describe("shelves", () => {
  it("puts an item on every shelf it would be looked for on", () => {
    expect(shelvesOf(item({ kind: "edit" }))).toEqual(["image", "edit"]);
    expect(shelvesOf(item({ kind: "adjust" }))).toContain("edit");
    expect(shelvesOf(item({ kind: "upscale" }))).toEqual(["image", "upscale"]);
    expect(shelvesOf(item({ mime: "audio/wav", kind: "audiobook" }))).toEqual(["audio"]);
    expect(shelvesOf(item({ mime: "video/mp4", kind: "video" }))).toEqual(["video"]);
    // A bound comic is a document and a comic at once.
    expect(shelvesOf(item({ mime: "application/pdf", kind: "document", model: "composed" })))
      .toEqual(["comic", "document"]);
    expect(shelvesOf(item({ project: "p" }))).toEqual(["image", "comic"]);
  });

  it("counts each shelf and each model", () => {
    const all = [item({ id: "a" }), item({ id: "b", kind: "edit", model: "Kontext" }),
                 item({ id: "c", mime: "audio/wav", model: "Kontext" })];
    expect(shelfCounts(all)).toMatchObject({ image: 2, edit: 1, audio: 1, video: 0 });
    expect(modelCounts(all)).toEqual([["Kontext", 2], ["Flux", 1]]);
  });
});

describe("search and filters", () => {
  it("matches every word, in any order, across prompt, name and board", () => {
    const it1 = item({ prompt: "a cat in a red coat", project_name: "Night train" });
    expect(matchesQuery(it1, "red cat")).toBe(true);
    expect(matchesQuery(it1, "TRAIN")).toBe(true);
    expect(matchesQuery(it1, "red dog")).toBe(false);
    expect(matchesQuery(it1, "   ")).toBe(true);
  });

  it("combines shelf, model, favourites and search", () => {
    const all = [item({ id: "a", prompt: "cat" }), item({ id: "b", prompt: "cat", model: "SD" }),
                 item({ id: "c", prompt: "dog" }), item({ id: "d", mime: "video/mp4", prompt: "cat" })];
    const ids = (f: Partial<typeof NO_FILTER>, fav = new Set<string>()) =>
      filterItems(all, { ...NO_FILTER, ...f }, fav).map((i) => i.id);
    expect(ids({ query: "cat" })).toEqual(["a", "b", "d"]);
    expect(ids({ query: "cat", shelf: "image" })).toEqual(["a", "b"]);
    expect(ids({ model: "SD" })).toEqual(["b"]);
    expect(ids({ favorites: true }, new Set(["c"]))).toEqual(["c"]);
  });

  it("leaves masks out of the library", () => {
    expect(browsable([item({ id: "a" }), item({ id: "m", kind: "mask" })]).map((i) => i.id))
      .toEqual(["a"]);
  });
});

describe("entries and sorting", () => {
  const board = [
    item({ id: "p2", project: "B", project_name: "Comic", project_index: 1, created_at: "2026-10-01T00:00:00Z" }),
    item({ id: "p1", project: "B", project_name: "Comic", project_index: 0, created_at: "2026-10-01T00:00:00Z" }),
    item({ id: "page", project: "B", project_name: "Comic", model: "composed", created_at: "2026-10-09T00:00:00Z" }),
  ];

  it("folds a board into one entry headed by its first panel and dated by its newest part", () => {
    const entries = buildEntries([item({ id: "solo" }), ...board]);
    expect(entries).toHaveLength(2);
    const b = entries.find((e) => e.members.length > 1)!;
    expect(b.item.id).toBe("p1");
    expect(b.members.map((m) => m.id)).toEqual(["p1", "p2", "page"]);
    expect(b.date).toBe("2026-10-09T00:00:00Z");
  });

  it("sorts newest, oldest, by name and by kind", () => {
    const entries = buildEntries([
      item({ id: "a", prompt: "banana", created_at: "2026-10-03T00:00:00Z" }),
      item({ id: "b", prompt: "Apple", kind: "upscale", created_at: "2026-10-05T00:00:00Z" }),
      item({ id: "c", prompt: "cherry", kind: "edit", created_at: "2026-10-04T00:00:00Z" }),
    ]);
    const ids = (k: Parameters<typeof sortEntries>[1]) => sortEntries(entries, k).map((e) => e.item.id);
    expect(ids("newest")).toEqual(["b", "c", "a"]);
    expect(ids("oldest")).toEqual(["a", "c", "b"]);
    expect(ids("name")).toEqual(["b", "a", "c"]);
    expect(ids("kind")).toEqual(["c", "a", "b"]); // Edited, Generated, Upscaled
  });
});

describe("sections", () => {
  it("names recent days relatively and older ones by month", () => {
    expect(dateBucket(local(2026, 9, 11), NOW).label).toBe("Today");
    expect(dateBucket(local(2026, 9, 10), NOW).label).toBe("Yesterday");
    expect(dateBucket(local(2026, 9, 6), NOW).label).toBe("This week");
    const older = dateBucket(local(2026, 8, 2), NOW);
    expect(older.key).toBe("2026-8");
    expect(older.label).toMatch(/2026/);
    expect(dateBucket("not a date", NOW).label).toBe("Undated");
  });

  it("keeps headings in the order of the sorted entries", () => {
    const entries = sortEntries(buildEntries([
      item({ id: "t", created_at: local(2026, 9, 11) }),
      item({ id: "y", created_at: local(2026, 9, 10) }),
      item({ id: "t2", created_at: local(2026, 9, 11) }),
    ]), "oldest");
    const s = sectionize(entries, "date", NOW);
    expect(s.map((x) => x.label)).toEqual(["Yesterday", "Today"]);
    expect(s[1].entries).toHaveLength(2);
  });

  it("unfolds boards under their own heading and puts loose items last", () => {
    const entries = buildEntries([
      item({ id: "solo" }),
      item({ id: "p1", project: "B", project_name: "Comic", project_index: 0 }),
      item({ id: "p2", project: "B", project_name: "Comic", project_index: 1 }),
    ]);
    const s = sectionize(entries, "board", NOW);
    expect(s.map((x) => x.label)).toEqual(["Comic", "Not in a board"]);
    expect(s[0].entries.map((e) => e.item.id)).toEqual(["p1", "p2"]);
    expect(s[0].entries.every((e) => e.members.length === 1)).toBe(true);
  });

  it("has no sections when there is nothing to show", () => {
    expect(sectionize([], "none")).toEqual([]);
  });
});

describe("selection", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("toggles a single item", () => {
    const one = applyPick(new Set(), order, "c", null, false);
    expect([...one]).toEqual(["c"]);
    expect([...applyPick(one, order, "c", "c", false)]).toEqual([]);
  });

  it("selects a range in screen order, in either direction, adding to what was chosen", () => {
    expect([...applyPick(new Set(["a"]), order, "d", "b", true)].sort())
      .toEqual(["a", "b", "c", "d"]);
    expect([...applyPick(new Set(), order, "b", "d", true)].sort()).toEqual(["b", "c", "d"]);
  });

  it("falls back to a toggle when the anchor is no longer on screen", () => {
    expect([...applyPick(new Set(), order, "b", "gone", true)]).toEqual(["b"]);
  });

  it("expands a board's card to the whole board, but not a single panel picked on its own", () => {
    const all = [item({ id: "p1", project: "B" }), item({ id: "p2", project: "B" }), item({ id: "s" })];
    expect(expandPicked(new Set(["p1", "s"]), all, new Set(["p1"])).map((i) => i.id))
      .toEqual(["p1", "p2", "s"]);
    expect(expandPicked(new Set(["p1"]), all, new Set()).map((i) => i.id)).toEqual(["p1"]);
  });
});

describe("history", () => {
  it("walks inputs back to the first item and finds what was made from one", () => {
    const a = item({ id: "a" });
    const b = item({ id: "b", kind: "edit", inputs: ["a"] });
    const c = item({ id: "c", kind: "video", inputs: ["b"] });
    const byId = new Map([a, b, c].map((i) => [i.id, i]));
    expect(lineage(c, byId).map((i) => i.id)).toEqual(["a", "b"]);
    expect(descendants(a, [a, b, c]).map((i) => i.id)).toEqual(["b"]);
  });

  it("does not hang on a cycle", () => {
    const a = item({ id: "a", inputs: ["b"] });
    const b = item({ id: "b", inputs: ["a"] });
    expect(lineage(a, new Map([["a", a], ["b", b]])).length).toBeLessThan(20);
  });
});

describe("justified rows", () => {
  it("fills each row to the container width exactly", () => {
    const rows = justify([1, 1, 1, 1, 1], 500, 200, 10);
    expect(rows.length).toBeGreaterThan(1);
    const first = rows[0];
    const width = first.tiles.reduce((n, t) => n + t.width, 0) + 10 * (first.tiles.length - 1);
    expect(width).toBeCloseTo(500);
    expect(rows.flatMap((r) => r.tiles.map((t) => t.index))).toEqual([0, 1, 2, 3, 4]);
  });

  it("leaves the last row at the target height", () => {
    const rows = justify([1, 1, 1], 1000, 200, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].height).toBe(200);
  });

  it("lays out nothing without a width", () => {
    expect(justify([1], 0, 200, 10)).toEqual([]);
  });

  it("clamps extreme aspects and treats sizeless items as square", () => {
    expect(aspectOf(item({ width: 4000, height: 500 }))).toBe(2.2);
    expect(aspectOf(item({ width: null }))).toBe(1);
    expect(aspectOf(item({ mime: "audio/wav" }))).toBe(1);
  });
});

describe("zoom", () => {
  const nat = { w: 2000, h: 1000 };
  const box = { w: 1000, h: 1000 };

  it("fits without enlarging", () => {
    expect(fitScale(nat, box)).toBe(0.5);
    expect(fitScale({ w: 100, h: 100 }, box)).toBe(1);
    expect(fitScale({ w: 0, h: 0 }, box)).toBe(1);
  });

  it("keeps the point under the pointer still while zooming", () => {
    const start = centred(0.5, nat, box);
    const next = zoomAbout(start, 1, { x: 500, y: 500 }, nat, box);
    expect(next.scale).toBe(1);
    // The image point that was under (500, 500) is still under it.
    const before = (500 - start.x) / start.scale;
    const after = (500 - next.x) / next.scale;
    expect(after).toBeCloseTo(before);
  });

  it("never pans the picture off screen and never zooms past the limits", () => {
    const v = clampView({ scale: 1, x: 300, y: -5000 }, nat, box);
    expect(v.x).toBe(0);
    expect(v.y).toBe(0); // 1000 tall in a 1000 box: centred
    expect(zoomAbout(centred(0.5, nat, box), 100, { x: 0, y: 0 }, nat, box).scale).toBe(8);
    expect(zoomAbout(centred(0.5, nat, box), 0.01, { x: 0, y: 0 }, nat, box).scale).toBe(0.5);
  });
});

describe("time", () => {
  it("reads like a clock", () => {
    expect(clock(5)).toBe("0:05");
    expect(clock(252.9)).toBe("4:12");
    expect(clock(3723)).toBe("1:02:03");
    expect(clock(NaN)).toBe("0:00");
  });

  it("finds the chapter playing at a time", () => {
    const m = [{ time: 60, label: "Two" }, { time: 0, label: "One" }];
    expect(markerAt(m, 30)?.label).toBe("One");
    expect(markerAt(m, 61)?.label).toBe("Two");
    expect(markerAt([{ time: 5, label: "x" }], 1)).toBeNull();
  });
});
