/** @vitest-environment jsdom */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Viewer from "./Viewer";
import AudioPlayer from "./AudioPlayer";
import type { VaultItem } from "../../lib/types";

/**
 * The viewer is driven from the keyboard as much as the mouse, and every key
 * it answers is listened for on the window. These check that the keys do
 * what the hints beside the buttons say they do.
 */
const item = (id: string, over: Partial<VaultItem> = {}): VaultItem => ({
  id, kind: "generate", name: `${id}.png`, mime: "image/png", bytes: 1000, model: "Flux",
  prompt: `prompt ${id}`, seed: 7, width: 512, height: 512, steps: 4, guidance: null,
  inputs: [], created_at: "2026-10-10T10:00:00Z", duration_ms: 0, ...over,
});

const closed = vi.fn();
const deleted = vi.fn();
const starred = vi.fn();

function Harness({ items, start = 0 }: { items: VaultItem[]; start?: number }) {
  const [index, setIndex] = useState(start);
  return (
    <>
      <button>opener</button>
      <Viewer items={items} index={index} onIndex={setIndex} onClose={closed} all={items}
              onOpenItem={() => {}} favorites={new Set()} onToggleFavorite={starred}
              onDelete={deleted} onExport={() => {}} models={[]} notify={() => {}}
              onChanged={() => {}} />
    </>
  );
}

const key = (k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key: k, ...init });

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // jsdom has no media pipeline; these record what the viewer asked for.
  HTMLMediaElement.prototype.play = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { value: false, configurable: true });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { value: true, configurable: true });
    this.dispatchEvent(new Event("pause"));
  });
});

describe("Viewer keyboard", () => {
  const three = [item("a"), item("b"), item("c")];

  it("walks with the arrow keys and stops at either end", () => {
    render(<Harness items={three} />);
    expect(screen.getByText(/^1 of 3/)).toBeTruthy();
    key("ArrowRight");
    expect(screen.getByText(/^2 of 3/)).toBeTruthy();
    key("ArrowRight"); key("ArrowRight");
    expect(screen.getByText(/^3 of 3/)).toBeTruthy();
    key("ArrowLeft");
    expect(screen.getByText(/^2 of 3/)).toBeTruthy();
    key("Home");
    expect(screen.getByText(/^1 of 3/)).toBeTruthy();
    key("ArrowLeft");
    expect(screen.getByText(/^1 of 3/)).toBeTruthy();
  });

  it("closes on Escape", () => {
    render(<Harness items={three} />);
    key("Escape");
    expect(closed).toHaveBeenCalledOnce();
  });

  it("toggles the details with I and stars with F", () => {
    render(<Harness items={three} />);
    expect(screen.getByRole("complementary", { name: "Details" })).toBeTruthy();
    key("i");
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
    key("i");
    expect(screen.getByText("prompt a", { selector: "p" })).toBeTruthy();
    key("f");
    expect(starred).toHaveBeenCalledWith(["a"]);
  });

  it("deletes the item on screen with Command-Backspace but not plain Backspace", () => {
    render(<Harness items={three} start={1} />);
    key("Backspace");
    expect(deleted).not.toHaveBeenCalled();
    key("Backspace", { metaKey: true });
    expect(deleted).toHaveBeenCalledWith([three[1]]);
  });

  it("leaves keys typed into a field alone", () => {
    render(<Harness items={three} />);
    const field = document.createElement("input");
    field.type = "text";
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: "ArrowRight" });
    expect(screen.getByText(/^1 of 3/)).toBeTruthy();
    field.remove();
  });

  it("takes focus when it opens and gives it back when it closes", () => {
    const { rerender } = render(<Harness items={three} />);
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
    rerender(<button>opener</button>);
    expect(document.activeElement?.tagName).not.toBe("DIV");
  });

  it("plays and pauses a video with Space", () => {
    render(<Harness items={[item("v", { mime: "video/mp4", kind: "video" })]} />);
    const video = document.querySelector("video")!;
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    key(" ");
    expect(video.play).toHaveBeenCalled();
    key(" ");
    expect(video.pause).toHaveBeenCalled();
  });

  it("reads a comic as pages", () => {
    render(
      <Viewer items={three} index={0} onIndex={() => {}} onClose={closed} all={three}
              reader={{ title: "Night train" }} onOpenItem={() => {}} favorites={new Set()}
              onToggleFavorite={() => {}} onDelete={() => {}} onExport={() => {}} models={[]}
              notify={() => {}} onChanged={() => {}} />,
    );
    expect(screen.getByText(/^Page 1 of 3/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next page" })).toBeTruthy();
  });

  it("opens a step in an item's history from the details", () => {
    const parent = item("p", { prompt: "the original" });
    const child = item("c", { kind: "edit", inputs: ["p"] });
    const opened = vi.fn();
    render(
      <Viewer items={[child]} index={0} onIndex={() => {}} onClose={closed} all={[parent, child]}
              onOpenItem={opened} favorites={new Set()} onToggleFavorite={() => {}}
              onDelete={() => {}} onExport={() => {}} models={[]} notify={() => {}}
              onChanged={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open generated step: the original/ }));
    expect(opened).toHaveBeenCalledWith(parent);
  });
});

describe("AudioPlayer", () => {
  it("plays, skips fifteen seconds and changes speed, and remembers the speed", () => {
    render(<AudioPlayer src="vault://localhost/book" title="Chapter one"
                        markers={[{ time: 0, label: "Opening" }, { time: 60, label: "The train" }]} />);
    const audio = document.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { value: 120, configurable: true });
    fireEvent.loadedMetadata(audio);
    expect(screen.getByText("2:00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(audio.play).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Forward 15 seconds" }));
    expect(audio.currentTime).toBe(15);
    fireEvent.click(screen.getByRole("button", { name: "Back 15 seconds" }));
    expect(audio.currentTime).toBe(0);

    fireEvent.change(screen.getByLabelText("Playback speed"), { target: { value: "1.5" } });
    expect(audio.playbackRate).toBe(1.5);
    expect(JSON.parse(localStorage.getItem("modelstudio:audio.rate")!)).toBe(1.5);

    fireEvent.click(screen.getByRole("button", { name: /The train/ }));
    expect(audio.currentTime).toBe(60);
  });

  it("answers its shortcuts while focus is inside it", () => {
    render(<AudioPlayer src="vault://localhost/book" />);
    const audio = document.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { value: 100, configurable: true });
    fireEvent.loadedMetadata(audio);
    const play = screen.getByRole("button", { name: "Play" });
    fireEvent.keyDown(play, { key: "l" });
    expect(audio.currentTime).toBe(15);
    fireEvent.keyDown(play, { key: "." });
    expect(audio.playbackRate).toBe(1.25);
    fireEvent.keyDown(play, { key: " " });
    expect(audio.play).toHaveBeenCalled();
  });
});
