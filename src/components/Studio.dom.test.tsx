/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hostAnswers } from "../test/setup";
import Studio from "./Studio";
import type { ModelStatus } from "../lib/types";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

/**
 * The creation screen as someone without a mouse, or without sight, meets it:
 * every control found by its name, every choice of one a radio group, a run
 * started from the keyboard, and a failure that says so where the picture
 * would have been -- without taking the last good picture away.
 */
const model: ModelStatus = {
  id: "image", repo: "test/image", name: "Image model", family: null,
  installed: true, installed_bytes: 1, hopeless: false, fit: "good", fit_reason: "fits",
  tasks: ["edit", "text_to_image"], tasks_str: [], quantize: 4,
  steps_default: 4, guidance_max: 5, guidance_default: 3, max_edit_images: 1,
  package_gib: 4, peak_gib: 6, peak_estimated: true, gated: false, video_from_image: false,
  notes: "", broken: null, custom: false, low_ram_may_help: false,
  measured_ms_per_step_mpx: null, measured_runs: 0, measured_load_ms: 0,
};

const notify = vi.fn();
const show = (mode: "generate" | "edit" = "generate") =>
  render(<Studio mode={mode} models={[model]} notify={notify} onProduced={() => {}} />);
const promptBox = () => screen.getByLabelText("What do you want to see?") as HTMLTextAreaElement;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  hostAnswers({ list_loras: [] });
});

describe("Studio controls have names", () => {
  it("finds the prompt and every advanced control by its label", () => {
    show();
    expect(promptBox().tagName).toBe("TEXTAREA");
    const toggle = screen.getByRole("button", { name: /Advanced settings/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // Same label either way: it names the section, the state says if it is open.
    expect(toggle.textContent).toMatch(/Advanced settings/);

    const steps = screen.getByLabelText(/^Steps/);
    expect(steps.getAttribute("aria-valuetext")).toMatch(/^\d+ steps$/);
    expect(screen.getByLabelText(/^Guidance/).getAttribute("aria-valuetext")).toMatch(/^guidance/);
    expect(screen.getByLabelText(/^How many/)).toBeTruthy();
    expect(screen.getByLabelText("Seed")).toBeTruthy();
    expect(screen.getByLabelText("Model").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Memory saver")).toBeTruthy();
  });

  it("names the edit-only controls too", () => {
    show("edit");
    expect(screen.getByLabelText("What should change?")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Extend the picture/ }));
    expect(screen.getByLabelText(/^top/i).getAttribute("aria-valuetext")).toBe("0 percent");
    expect(screen.getByLabelText("How the new area starts out").tagName).toBe("SELECT");
  });
});

describe("choices of one are radio groups", () => {
  it("marks the chosen shape with state and a tick, and moves with arrows", () => {
    show();
    const group = screen.getByRole("radiogroup", { name: "Shape" });
    const radios = within(group).getAllByRole("radio");
    const checked = radios.filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain("✓");

    fireEvent.click(within(group).getByRole("radio", { name: /Wide/ }));
    expect(within(group).getByRole("radio", { name: /Wide/ }).getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(within(group).getByRole("radio", { name: /Wide/ }), { key: "ArrowRight" });
    expect(within(group).getByRole("radio", { name: /Tall/ }).getAttribute("aria-checked")).toBe("true");
    // One tab stop for the whole group.
    expect(within(group).getAllByRole("radio").filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it("makes the edit kinds and the effort levels radio groups", () => {
    show("edit");
    expect(screen.getByRole("radiogroup", { name: "What kind of edit?" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: /Effort/ })).toBeTruthy();
  });
});

describe("running", () => {
  it("runs on Cmd+Enter from the prompt box", async () => {
    const generate = vi.fn(() => ["out-1"]);
    hostAnswers({ generate });
    show();
    fireEvent.change(promptBox(), { target: { value: "a red kite" } });
    fireEvent.keyDown(promptBox(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(await screen.findByAltText("Result 1 of 1: a red kite")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Done, 1 image.");
  });

  it("refuses an empty prompt beside the box, not in a toast", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Make it/ }));
    expect(promptBox().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Describe what you want first.")).toBeTruthy();
    expect(notify).not.toHaveBeenCalled();
  });

  it("shows a failure on the canvas and keeps the last picture", async () => {
    let calls = 0;
    hostAnswers({
      generate: () => {
        calls += 1;
        if (calls === 1) return ["out-1"];
        throw new Error("Metal ran out of memory while decoding");
      },
    });
    show();
    fireEvent.change(promptBox(), { target: { value: "a red kite" } });
    fireEvent.click(screen.getByRole("button", { name: /Make it/ }));
    await screen.findByAltText("Result 1 of 1: a red kite");

    fireEvent.click(screen.getByRole("button", { name: /Make it/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/That did not work/);
    expect(alert.textContent).toMatch(/ran out of memory/);
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(within(alert).getByRole("button", { name: /Memory saver/ })).toBeTruthy();
    // The last good picture is still there, dimmed, rather than wiped.
    expect(screen.getByAltText("Previous Result 1 of 1: a red kite").className).toContain("stale");
  });

  it("keeps every result of the session, newest first", async () => {
    let n = 0;
    hostAnswers({ generate: () => [`out-${++n}`] });
    show();
    fireEvent.change(promptBox(), { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: /Make it/ }));
    await screen.findByAltText("Result 1 of 1: first");
    fireEvent.change(promptBox(), { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: /Make it/ }));
    await screen.findByAltText("Result 1 of 2: second");

    const strip = screen.getByRole("radiogroup", { name: "Made this session" });
    const thumbs = within(strip).getAllByRole("radio");
    expect(thumbs.map((t) => t.getAttribute("aria-label")))
      .toEqual(["Result 1 of 2: second", "Result 2 of 2: first"]);
    fireEvent.click(thumbs[1]);
    expect(screen.getByAltText("Result 2 of 2: first")).toBeTruthy();

    // Its prompt can be taken back into the box.
    fireEvent.click(screen.getByRole("button", { name: "Use prompt" }));
    expect(promptBox().value).toBe("first");
  });
});
