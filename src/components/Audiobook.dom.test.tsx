/** @vitest-environment jsdom */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Audiobook from "./Audiobook";
import { api } from "../lib/api";
import { SPEECH_MODEL_ID, type StoryLibrary } from "../lib/story";

vi.mock("../lib/api", () => ({
  api: { audioVoices: vi.fn(), generateAudiobook: vi.fn(), cancelJob: vi.fn(), analyzeStory: vi.fn(), resumeStory: vi.fn() },
  errText: (e: unknown) => String(e), isCancelled: () => false,
  newJobId: () => "job", onEngineProgress: async () => () => {},
  vaultUrl: (id: string) => `vault://localhost/${id}`,
}));
const initial: StoryLibrary = { audio: { book: { model_id: "macos", narrator: "", voices: {}, rate: 160, outputs: {} } }, version: 1, activeBookId: "book", books: [{ version: 1, id: "book",
  characters: [{ id: "mira", name: "Mira", aliases: ["Mi"], visual: "red coat", voice: "quiet" }],
  chapters: [{ id: "chapter", title: "The train", source: "Exact original prose.", source_hash: "hash", scenes: [] }],
}] };
const produced = vi.fn();
const notify = vi.fn();
function Harness({ models = [], start = initial }: { models?: import("../lib/types").ModelStatus[]; start?: StoryLibrary }) {
  const [library, setLibrary] = useState(start);
  return <Audiobook library={library} models={models} notify={notify} onProduced={produced}
    onLibraryChange={async (update) => { setLibrary((current) => update(current)); }} />;
}
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.audioVoices).mockResolvedValue({ voices: [{ id: "Samantha", language: "en_US" }, { id: "Karen", language: "en_AU" }] });
  vi.mocked(api.generateAudiobook).mockResolvedValue("sealed-audio");
});
describe("Audiobook", () => {
  it("narrates the selected original chapter with saved character voices and plays the sealed result", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getAllByRole("option", { name: "Samantha · en_US" }).length).toBe(2));
    fireEvent.change(screen.getByLabelText("Mira voice"), { target: { value: "Karen" } });
    fireEvent.click(screen.getByRole("button", { name: "Narrate chapter" }));
    await waitFor(() => expect(api.generateAudiobook).toHaveBeenCalledWith(
      "job", initial.books[0], "chapter", "Samantha", { mira: "Karen" }, 160, { model_id: "macos", language: "auto", delivery: "", directions: {} }));
    await waitFor(() => expect(document.querySelector('audio')?.getAttribute('src')).toBe('vault://localhost/sealed-audio'));
    expect(screen.getByText("Exact original prose.")).toBeTruthy();
    expect(produced).toHaveBeenCalledOnce();
  });
  it("reports speech failure and preserves the analyzed chapter", async () => {
    vi.mocked(api.generateAudiobook).mockRejectedValue(new Error("Voice unavailable"));
    render(<Harness />);
    await waitFor(() => expect((screen.getByRole("button", { name: "Narrate chapter" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Narrate chapter" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Error: Voice unavailable", true));
    expect(document.querySelector('audio')).toBeNull();
    expect(screen.getByText("Exact original prose.")).toBeTruthy();
  });
  it("analyzes a new chapter with the quick voice-only analysis", async () => {
    const book = { ...initial.books[0], chapters: [{ ...initial.books[0].chapters[0], analysis: "voice" as const }] };
    vi.mocked(api.analyzeStory).mockResolvedValue({ book, chapter_id: "chapter", panels: [] });
    const writer = { id: "qwen3-4b-instruct-4bit", installed: true, broken: null, hopeless: false } as unknown as import("../lib/types").ModelStatus;
    render(<Harness models={[writer]} start={{ version: 1, books: [], activeBookId: null }} />);
    fireEvent.change(screen.getByPlaceholderText("Paste the original prose…"), { target: { value: "Exact original prose." } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze chapter" }));
    await waitFor(() => expect(api.analyzeStory).toHaveBeenCalledWith("job", "Exact original prose.", expect.any(String), null, null, "voice"));
  });
  it("does not enable narration when no local speech voices are available", async () => {
    vi.mocked(api.audioVoices).mockResolvedValue({ voices: [] });
    render(<Harness />);
    await waitFor(() => expect(screen.getByText(/Installed macOS speech voices are required/)).toBeTruthy());
    expect((screen.getByRole("button", { name: "Narrate chapter" }) as HTMLButtonElement).disabled).toBe(true);
  });
});


describe("neural audiobook", () => {
  it("requires a downloaded model and resets incompatible system voice assignments", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getAllByRole("option", { name: "Samantha · en_US" }).length).toBe(2));
    vi.mocked(api.audioVoices).mockResolvedValue({ voices: [{ id: "ryan", language: "multilingual" }] });
    fireEvent.change(screen.getByLabelText("Speech engine"), { target: { value: SPEECH_MODEL_ID } });
    await waitFor(() => expect(api.audioVoices).toHaveBeenCalledWith(SPEECH_MODEL_ID));
    expect(screen.getByText(/Download Audiobook voices/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Narrate chapter" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("Narration direction")).toBeTruthy();
  });
  it("passes selected neural voices, language and performance direction into generation", async () => {
    const model = { id: SPEECH_MODEL_ID, installed: true, hopeless: false } as import("../lib/types").ModelStatus;
    render(<Harness models={[model]} />);
    await waitFor(() => expect(screen.getAllByRole("option", { name: "Samantha · en_US" }).length).toBe(2));
    vi.mocked(api.audioVoices).mockResolvedValue({ voices: [{ id: "ryan", language: "multilingual" }, { id: "vivian", language: "multilingual" }] });
    fireEvent.change(screen.getByLabelText("Speech engine"), { target: { value: SPEECH_MODEL_ID } });
    await waitFor(() => expect(screen.getAllByRole("option", { name: "ryan · multilingual" }).length).toBe(2));
    fireEvent.change(screen.getByLabelText("Narration direction"), { target: { value: "Warm and intimate" } });
    fireEvent.change(screen.getByLabelText("Mira voice direction"), { target: { value: "Whisper nervously" } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "english" } });
    fireEvent.change(screen.getByLabelText("Mira voice"), { target: { value: "vivian" } });
    fireEvent.click(screen.getByRole("button", { name: "Narrate chapter" }));
    await waitFor(() => expect(api.generateAudiobook).toHaveBeenCalledWith("job", initial.books[0], "chapter", "ryan", { mira: "vivian" }, 160,
      { model_id: SPEECH_MODEL_ID, language: "english", delivery: "Warm and intimate", directions: { mira: "Whisper nervously" } }));
  });
});
