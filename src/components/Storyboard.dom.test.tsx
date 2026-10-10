/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { hostAnswers } from "../test/setup";
import Storyboard from "./Storyboard";
import type { ModelStatus, Panel } from "../lib/types";
import type { StoryBook, StoryLibrary } from "../lib/story";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

const book: StoryBook = { version: 1, id: "book", characters: [
  { id: "mira", name: "Mira", aliases: ["Mi"], visual: "red coat", voice: "quiet" },
], chapters: [{ id: "chapter", title: "The reveal", source: "Mira finds the platform empty.",
  source_hash: "hash", scenes: [{ id: "scene", title: "Station", summary: "Hope turns into loss.",
    start: 0, end: 30, beats: [] }] }] };
const panel: Panel = { shot: "close-up", subject: "Mira", action: "finds the platform empty",
  setting: "station", caption: "Mira finds the platform empty.", character_in_frame: true,
  characters: ["Mira"], chapter_id: "chapter", beat_id: "beat", mood: "loss", tension: 5,
  cast: [{ character_id: "mira", name: "Mira", visual: "red coat", expression: "grief", body_language: "still" }] };
const baseModel: ModelStatus = {
  id: "image", repo: "test/image", name: "Image model", family: null,
  installed: true, installed_bytes: 1, hopeless: false, fit: "good", fit_reason: "fits",
  tasks: ["edit", "text_to_image"], tasks_str: [], quantize: 4,
  steps_default: 4, guidance_max: 1, guidance_default: 1, max_edit_images: 1,
  package_gib: 4, peak_gib: 6, peak_estimated: true, gated: false, video_from_image: false,
  notes: "", broken: null, custom: false, low_ram_may_help: false,
  measured_ms_per_step_mpx: null, measured_runs: 0, measured_load_ms: 0,
};
const models: ModelStatus[] = [baseModel,
  { ...baseModel, id: "qwen3-4b-instruct-4bit", name: "Writer", tasks: ["assist"] }];
const notify = vi.fn();
const save = vi.fn(async (_book: StoryBook) => {});
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  hostAnswers({ board_state_get: null, board_state_previous: null, board_state_set: null });
});
const show = (library: StoryLibrary) => render(<Storyboard models={models} notify={notify}
  onProduced={() => {}} storyLibrary={library} onStoryAnalyzed={save} onCharacterReference={async () => {}} />);
describe("Board shared story workflow", () => {
  it("analyzes prose directly, saves the shared model, and enables drawing without lossy enrichment", async () => {
    const analyze = vi.fn(() => ({ book, chapter_id: "chapter", panels: [panel] }));
    hostAnswers({ analyze_story: analyze });
    show({ version: 1, books: [], activeBookId: null });
    const prose = await screen.findByPlaceholderText(/Mira comes home/);
    fireEvent.change(prose, { target: { value: book.chapters[0].source } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze story and plan panels" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(book));
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ args: expect.objectContaining({ source: book.chapters[0].source, previous: null }) }));
    expect(await screen.findByText("Story direction · The reveal")).toBeTruthy();
    expect(screen.getByLabelText("Mira expression")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Draw 1 of 1/ })).toBeTruthy();
  });
  it("loads an Audiobook chapter without running story analysis again", async () => {
    const direct = vi.fn(() => ({ panels: [panel] }));
    hostAnswers({ direct_story: direct });
    show({ version: 1, books: [book], activeBookId: book.id });
    const saved = await screen.findByLabelText("Use an analyzed chapter");
    fireEvent.change(saved, { target: { value: "book:chapter" } });
    expect(await screen.findByText("Story direction · The reveal")).toBeTruthy();
    expect(direct).toHaveBeenCalledWith(expect.objectContaining({ book, chapterId: "chapter" }));
    expect(save).not.toHaveBeenCalled();
  });
});
