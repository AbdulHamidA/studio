import { describe, expect, it } from "vitest";
import { castFromBook, keepBook, type StoryBook, type StoryLibrary } from "./story";
import { CHAIN_LIMIT, lockStyle, panelPrompt, identityPrompt, storyContinuityReference, storyPanelReferences } from "./board";
import { staleness } from "./boardDoc";
import type { Panel } from "./types";

const book: StoryBook = { version: 1, id: "book", chapters: [], characters: [
  { id: "mira", name: "Mira", aliases: ["Mi"], visual: "red coat", voice: "quiet" },
] };
describe("shared story model", () => {
  it("keeps other books and voice assignments when another chapter is saved", () => {
    const library: StoryLibrary = { version: 1, activeBookId: "other", books: [book, { ...book, id: "other" }],
      audio: { book: { narrator: "Samantha", voices: { mira: "Karen" }, rate: 160, outputs: {} } } };
    const result = keepBook(library, { ...book, characters: [...book.characters] });
    expect(result.books.map((b) => b.id)).toEqual(["other", "book"]);
    expect(result.audio).toEqual(library.audio);
    expect(library.activeBookId).toBe("other");
  });
  it("carries canonical IDs and aliases into the editable Board cast", () => {
    expect(castFromBook(book).people[0]).toMatchObject({ id: "mira", aliases: ["Mi"], description: "red coat" });
  });
  it("keeps actions and emotion even when surface enrichment is present", () => {
    const panel: Panel = { shot: "close-up", subject: "Mira", action: "releases the key",
      setting: "station", character_in_frame: true, caption: "", description: "cold blue light",
      cast: [{ character_id: "mira", name: "Mira", visual: "red coat", expression: "grief",
        body_language: "clenched hands" }], mood: "loss", tension: 5 };
    const prompt = panelPrompt(panel, lockStyle("ink"), "ignored legacy binding");
    for (const text of ["releases the key", "cold blue light", "grief", "clenched hands", "Mood: loss"]) {
      expect(prompt).toContain(text);
    }
    expect(prompt).not.toContain("ignored legacy binding");
  });
  it("does not invite an offscreen speaker into the image", () => {
    const panel: Panel = { shot: "wide", subject: "door", action: "A guard calls from behind the locked door",
      setting: "station", character_in_frame: false, caption: "", cast: [],
      dialogue: [{ speaker: "Guard", text: "Last train!", offscreen: true }] };
    expect(panelPrompt(panel, lockStyle("ink"), "")).toContain("No people visible in frame");
  });
  it("changing expression or mood invalidates drawn art, while lettering does not", () => {
    expect(staleness({ mood: "fear" }).art).toBe(true);
    expect(staleness({ cast: [] }).art).toBe(true);
    expect(staleness({ caption: "Original words" }).art).toBe(false);
  });
});

describe("story appearance continuity", () => {
  const panel = (appearance: string, location_state = "dry floor; dawn"): Panel => ({
    shot: "medium", subject: "Mira", action: "walks", setting: "station", place_key: "station",
    chapter_id: "chapter", scene: 1, character_in_frame: true, caption: "", location_state,
    cast: [{ character_id: "mira", name: "Mira", visual: "curly black hair", appearance,
      expression: "calm", body_language: "walking" }],
  });
  it("carries a finished frame only while outfit and location conditions match", () => {
    const before = panel("red dress");
    expect(storyContinuityReference(1, [before, panel("red dress")], ["frame", null])).toBe("frame");
    expect(storyContinuityReference(1, [before, panel("blue dress")], ["frame", null])).toBeNull();
    expect(storyContinuityReference(1, [before, panel("red dress", "wet floor; night")], ["frame", null])).toBeNull();
    expect(storyContinuityReference(1, [before, { ...panel("red dress"), cast: [] }], ["frame", null])).toBeNull();
  });
  it("re-anchors to the sheet instead of chaining copies through a whole scene", () => {
    const run = Array.from({ length: 2 * CHAIN_LIMIT + 1 }, () => panel("red dress"));
    const drawn = run.map((_, i) => `frame${i}`);
    expect(storyContinuityReference(CHAIN_LIMIT, run, drawn)).toBeNull();
    expect(storyContinuityReference(CHAIN_LIMIT + 1, run, drawn)).toBe(`frame${CHAIN_LIMIT}`);
    const gap = [panel("red dress"), ...Array.from({ length: CHAIN_LIMIT }, () => panel("blue dress")), panel("red dress")];
    expect(storyContinuityReference(CHAIN_LIMIT + 1, gap, gap.map((_, i) => `f${i}`))).toBeNull();
  });
  it("keeps the identity sheet beside the previous frame when the model takes both", () => {
    expect(storyPanelReferences(panel("red dress"), "sheet", "frame", null, 3)).toEqual(["sheet", "frame"]);
    expect(storyPanelReferences(panel("red dress"), "sheet", "frame", null, 1)).toEqual(["frame"]);
    expect(storyPanelReferences(panel("red dress"), "sheet", null, null, 1)).toEqual(["sheet"]);
  });
  it("uses story clothing as a replacement and separates the identity reference", () => {
    const prompt = panelPrompt(panel("blue dress"), lockStyle("ink"), "");
    expect(prompt).toContain("replaces earlier clothing");
    expect(prompt).toContain("blue dress");
    expect(prompt).toContain("Current location state: dry floor; dawn");
    expect(identityPrompt(lockStyle("ink"), "Mira: curly black hair")).toContain("No full-body outfit");
  });
});
