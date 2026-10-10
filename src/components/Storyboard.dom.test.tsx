/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { hostAnswers } from "../test/setup";
import Storyboard from "./Storyboard";
import type { ModelStatus, Panel } from "../lib/types";
import type { StoryBook, StoryLibrary } from "../lib/story";
import { lockStyle, STYLES } from "../lib/board";

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
  it("draws a new character sheet when the saved one was deleted from the Vault", async () => {
    const reference = { image: "deleted-sheet", style_words: lockStyle(STYLES[0].id).words,
      visual: "red coat", kind: "identity-face-v1" as const };
    const saved = { ...book, references: { mira: reference } };
    const generate = vi.fn(() => ["new-sheet"]);
    const edit = vi.fn(() => ["panel-image"]);
    hostAnswers({ direct_story: () => ({ panels: [panel] }), vault_list: () => [],
      generate, edit_image: edit });
    show({ version: 1, books: [saved], activeBookId: saved.id });
    fireEvent.change(await screen.findByLabelText("Use an analyzed chapter"), { target: { value: "book:chapter" } });
    fireEvent.click(await screen.findByRole("button", { name: /Draw 1 of 1/ }));
    await waitFor(() => expect(edit).toHaveBeenCalled());
    expect(generate).toHaveBeenCalledTimes(1);
    const images = (edit.mock.calls[0] as unknown as [{ args: { images: string[] } }])[0].args.images;
    expect(images).toEqual(["new-sheet"]);
  });
  it("continues a stopped analysis from the Manuscript, with the analyst chosen there", async () => {
    const stub = { id: "stub", title: "Passage 2 (not analysed)", summary: "", start: 30, end: 30, beats: [], unanalysed: true };
    const stopped = { ...book, chapters: [{ ...book.chapters[0], scenes: [...book.chapters[0].scenes, stub] }] };
    const finished = { ...book };
    const resume = vi.fn(() => ({ book: finished, chapter_id: "chapter", panels: [panel, { ...panel, beat_id: "beat2" }], unanalysed: 0 }));
    hostAnswers({ direct_story: () => ({ panels: [panel] }), resume_story: resume });
    show({ version: 1, books: [stopped], activeBookId: stopped.id });
    fireEvent.change(await screen.findByLabelText("Use an analyzed chapter"), { target: { value: "book:chapter" } });
    expect(await screen.findByText("1 passage not analysed yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue analysis" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(finished));
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ book: stopped, chapterId: "chapter" }));
    expect(await screen.findByRole("button", { name: /Draw 2 of 2/ })).toBeTruthy();
    expect(screen.queryByText("1 passage not analysed yet")).toBeNull();
  });
  it("loads an Audiobook chapter without running story analysis again", async () => {
    const direct = vi.fn(() => ({ panels: [panel] }));
    hostAnswers({ direct_story: direct });
    show({ version: 1, books: [book], activeBookId: book.id });
    const saved = await screen.findByLabelText("Use an analyzed chapter");
    fireEvent.change(saved, { target: { value: "book:chapter" } });
    expect(await screen.findByText("Story direction · The reveal")).toBeTruthy();
    expect(direct).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.objectContaining({ book, chapter_id: "chapter", format: "manga", refine: false }) }));
    expect(save).not.toHaveBeenCalled();
  });
});

describe("Board accessibility", () => {
  /** A board loaded from a saved chapter: cast read, one panel planned. */
  const loaded = async (panels: Panel[] = [panel]) => {
    hostAnswers({ direct_story: () => ({ panels }) });
    show({ version: 1, books: [book], activeBookId: book.id });
    fireEvent.change(await screen.findByLabelText("Use an analyzed chapter"), { target: { value: "book:chapter" } });
    await screen.findByText("Story direction · The reveal");
  };

  it("names every field of the panel editor, the board settings and the manuscript", async () => {
    show({ version: 1, books: [], activeBookId: null });
    expect(await screen.findByRole("textbox", { name: "Manuscript prose" })).toBeTruthy();
    cleanup();
    await loaded();
    for (const name of ["Shot", "Subject", "Action", "Setting", "Mood", "Caption", "Dialogue",
                        "Current location state"]) {
      expect(screen.getByLabelText(name), name).toBeTruthy();
    }
    expect(screen.getByLabelText(/^People in frame/)).toBeTruthy();
    const boardTab = screen.getByRole("button", { name: /Board$/, pressed: false });
    fireEvent.click(boardTab);
    expect(boardTab.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Model")).toBeTruthy();
    expect(screen.getByLabelText(/^Lead appearance override/)).toBeTruthy();
    // Styles say which one is chosen as a state, not only as a colour.
    expect(screen.getAllByRole("button", { pressed: true }).length).toBeGreaterThan(1);
  });

  it("opens a cast member's appearance from a button, saves on Enter and gives focus back", async () => {
    await loaded();
    const pill = screen.getByRole("button", { name: "Mira Lead" });
    expect(pill.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(pill);
    expect(pill.getAttribute("aria-expanded")).toBe("true");
    const look = screen.getByLabelText("What Mira looks like");
    expect(document.activeElement).toBe(look);
    // Escape closes without saving.
    fireEvent.keyDown(look, { key: "Escape" });
    expect(screen.queryByLabelText("What Mira looks like")).toBeNull();
    expect(document.activeElement).toBe(pill);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(pill);
    const again = screen.getByLabelText("What Mira looks like");
    fireEvent.change(again, { target: { value: "grey coat, cropped hair" } });
    fireEvent.keyDown(again, { key: "Enter" });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].characters[0].visual).toBe("grey coat, cropped hair");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Mira Lead" }));
  });

  it("marks the current step and goes back to an earlier one without discarding the board", async () => {
    await loaded();
    const steps = screen.getByRole("list", { name: "Board steps" });
    const current = () => steps.querySelector("[aria-current='step']")!;
    expect(current().textContent).toMatch(/Draw/);
    expect(current().textContent).toMatch(/0 of 1 drawn/);
    // A step not reached yet is not a button.
    expect(screen.queryByRole("button", { name: /^Pages/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Story/ }));
    expect(current().textContent).toMatch(/Story/);
    // Nothing was thrown away by looking back.
    expect(screen.getByText("Story direction · The reveal")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Draw 1 of 1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Cast/ }));
    expect(current().textContent).toMatch(/Cast/);
    expect(screen.getByRole("button", { name: /Board$/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says how a job ended in a status line that stays", async () => {
    await loaded();
    expect(screen.getByRole("status").textContent).toBe("Loaded “The reveal” — 1 panel planned.");
  });

  it("keeps focus on the run button, which becomes Stop while the job runs", async () => {
    const cancel = vi.fn();
    hostAnswers({ analyze_story: () => new Promise(() => {}), cancel_job: cancel });
    show({ version: 1, books: [], activeBookId: null });
    const prose = await screen.findByRole("textbox", { name: "Manuscript prose" });
    const run = screen.getByRole("button", { name: "Analyze story and plan panels" });
    // Nothing to analyse yet: it says why rather than going grey and silent.
    expect(run.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Write or paste the story first.")).toBeTruthy();
    fireEvent.change(prose, { target: { value: book.chapters[0].source } });
    expect(run.getAttribute("aria-disabled")).toBeNull();
    run.focus();
    fireEvent.click(run);
    const stop = await screen.findByRole("button", { name: "Stop the analysis" });
    expect(stop).toBe(run);
    expect(document.activeElement).toBe(run);
    fireEvent.click(stop);
    await waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it("leaves the other panels editable while one is drawn, and draws the edit", async () => {
    const second: Panel = { ...panel, beat_id: "beat2", subject: "Mira at the gate" };
    let release: (ids: string[]) => void = () => {};
    const prompts: string[] = [];
    const edit = vi.fn((a: Record<string, unknown>) => {
      prompts.push((a.args as { prompt: string }).prompt);
      return prompts.length === 1 ? new Promise<string[]>((r) => { release = r; }) : ["panel-2"];
    });
    hostAnswers({ vault_list: () => [], generate: () => ["sheet"], edit_image: edit });
    await loaded([panel, second]);
    fireEvent.click(screen.getByRole("button", { name: /Draw 2 of 2/ }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    // The panel being drawn is locked...
    expect((screen.getByLabelText("Subject") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Panel 1 of 2 · about \d+ min left/)).toBeTruthy();
    // ...and the next one is not.
    fireEvent.click(document.querySelectorAll(".board-card")[1]);
    const subject = screen.getByLabelText("Subject") as HTMLInputElement;
    expect(subject.disabled).toBe(false);
    fireEvent.change(subject, { target: { value: "Ana waits by the window" } });
    release(["panel-1"]);
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(prompts[1]).toContain("Ana waits by the window");
    expect(await screen.findByText("Drew 2 panels — 2 of 2 drawn.")).toBeTruthy();
  });
});
