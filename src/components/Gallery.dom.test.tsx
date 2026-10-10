/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { hostAnswers } from "../test/setup";
import Gallery from "./Gallery";
import type { VaultItem } from "../lib/types";

/**
 * The library's selection and its way into the viewer, end to end against
 * the real grid. The rules themselves are tested in `lib/library.test.ts`;
 * these check that clicks reach them the way the hints say.
 */
const day = (d: number) => new Date(2026, 9, d, 12).toISOString();
const item = (id: string, over: Partial<VaultItem> = {}): VaultItem => ({
  id, kind: "generate", name: `${id}.png`, mime: "image/png", bytes: 1000, model: "Flux",
  prompt: `picture ${id}`, seed: 1, width: 512, height: 512, steps: 4, guidance: null,
  inputs: [], created_at: day(1), duration_ms: 0, ...over,
});

const items = [
  item("a", { created_at: day(5) }),
  item("b", { created_at: day(4) }),
  item("c", { created_at: day(3) }),
  item("d", { created_at: day(2), mime: "audio/wav", kind: "audiobook", prompt: "Chapter one" }),
  item("p1", { project: "B", project_name: "Night train", project_index: 0 }),
  item("p2", { project: "B", project_name: "Night train", project_index: 1 }),
  item("m", { kind: "mask" }),
];

const changed = vi.fn();
const deleted: string[] = [];

function show(list = items) {
  return render(<Gallery items={list} onChanged={changed} notify={() => {}} models={[]} />);
}
const card = (title: string) =>
  screen.getByRole("button", { name: new RegExp(`^[A-Z][a-z]+: ${title}`) });

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  deleted.length = 0;
  hostAnswers({
    board_state_list: [],
    vault_delete: (args: Record<string, unknown>) => { deleted.push(String(args.id)); },
  });
});

describe("Gallery", () => {
  it("shows one card per thing made, and no masks", () => {
    show();
    expect(screen.getAllByRole("button", { name: /^(Generated|Audiobook|Comic|Mask):/ })).toHaveLength(5);
    expect(card("Night train")).toBeTruthy();
    expect(screen.getByText("5 items", { exact: false })).toBeTruthy();
  });

  it("selects with Command-click, extends with Shift-click and clears with Escape", () => {
    show();
    fireEvent.click(card("picture a"), { metaKey: true });
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.click(card("picture c"), { shiftKey: true });
    expect(screen.getByText("3 selected")).toBeTruthy();
    // Once something is selected, a plain click keeps selecting.
    fireEvent.click(card("Chapter one"));
    expect(screen.getByText("4 selected")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
  });

  it("counts a picked board as everything in it", () => {
    show();
    fireEvent.click(card("Night train"), { metaKey: true });
    expect(screen.getByText("1 selected · 2 items")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete 2" })).toBeTruthy();
  });

  it("selects a whole date heading at once", () => {
    show();
    fireEvent.click(screen.getAllByRole("button", { name: /^Select all in / })[0]);
    expect(screen.getByText(/selected/)).toBeTruthy();
  });

  it("hides a delete at once, undoes it, and only reaches the vault when it is let go", async () => {
    show();
    fireEvent.click(card("picture a"), { metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Delete 1" }));
    expect(screen.queryByRole("button", { name: /^Generated: picture a/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(card("picture a")).toBeTruthy();
    expect(deleted).toEqual([]);

    fireEvent.click(card("picture b"), { metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Delete 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(deleted).toEqual(["b"]));
    expect(changed).toHaveBeenCalled();
  });

  it("opens the viewer on a plain click and walks the grid's order", () => {
    show();
    fireEvent.click(card("picture b"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Viewer: picture b");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Viewer: picture c");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    // The audiobook gets a real player.
    expect(screen.getByRole("group", { name: "Player: Chapter one" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a board as a comic, not as its first panel", () => {
    show();
    fireEvent.click(card("Night train"));
    expect(screen.getByRole("heading", { name: "Night train" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Panel 2/ }));
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Viewer: picture p2");
  });

  it("filters by shelf and search, and says so when nothing matches", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /^Audio \d/ }));
    expect(screen.getAllByRole("button", { name: /^(Generated|Audiobook|Comic):/ })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search the vault"), { target: { value: "zebra" } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("button", { name: /^(Generated|Audiobook|Comic):/ })).toHaveLength(5);
  });

  it("tells an empty vault from a vault that is still opening or could not be read", () => {
    const { rerender } = render(<Gallery items={[]} onChanged={changed} notify={() => {}} models={[]} loading />);
    expect(screen.getByLabelText("Opening the vault")).toBeTruthy();
    rerender(<Gallery items={[]} onChanged={changed} notify={() => {}} models={[]} loadError="disk gone" />);
    expect(screen.getByText("disk gone")).toBeTruthy();
    rerender(<Gallery items={[]} onChanged={changed} notify={() => {}} models={[]} />);
    expect(screen.getByText("The vault is empty.")).toBeTruthy();
  });
});
