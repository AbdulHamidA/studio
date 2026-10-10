/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { hostAnswers } from "../test/setup";
import Models from "./Models";
import type { ModelStatus } from "../lib/types";

/** The catalog's filters, and the way a gated model now asks for its token. */
const base: ModelStatus = {
  id: "image", repo: "test/image", name: "Picture maker", family: null,
  installed: true, installed_bytes: 1, hopeless: false, fit: "good", fit_reason: "fits",
  tasks: ["edit", "text_to_image"], tasks_str: [], quantize: 4,
  steps_default: 4, guidance_max: 1, guidance_default: 1, max_edit_images: 1,
  package_gib: 4, peak_gib: 6, peak_estimated: false, gated: false, video_from_image: false,
  notes: "", broken: null, custom: false, low_ram_may_help: false,
  measured_ms_per_step_mpx: null, measured_runs: 0, measured_load_ms: 0,
};
const models: ModelStatus[] = [
  base,
  { ...base, id: "clip", name: "Clip maker", tasks: ["video"], installed: false },
  { ...base, id: "big", name: "Huge clip maker", tasks: ["video"], installed: false,
    fit: "too_much_memory", gated: true },
  { ...base, id: "voice", name: "Narrator", tasks: ["speech"] },
];

const show = () => render(
  <Models models={models} host={null} onChanged={() => {}} notify={() => {}} />);
const names = () => screen.queryAllByText(/maker|Narrator/).map((n) => n.textContent);

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

describe("Models filter", () => {
  it("offers each filter with how many it would show", () => {
    show();
    const group = screen.getByRole("radiogroup", { name: "Show" });
    const label = (name: string) => within(group).getByRole("radio", { name: new RegExp(`^✓?${name}`) });
    expect(label("All").textContent).toMatch(/4$/);
    expect(label("Installed").textContent).toMatch(/2$/);
    expect(label("Video").textContent).toMatch(/2$/);
    expect(label("Speech").textContent).toMatch(/1$/);
    expect(label("Fits this Mac").textContent).toMatch(/3$/);
    expect(label("Upscale").textContent).toMatch(/0$/);
  });

  it("narrows the list to what the filter names", () => {
    show();
    expect(names()).toHaveLength(4);
    fireEvent.click(screen.getByRole("radio", { name: /^Video/ }));
    expect(screen.getByRole("radio", { name: /Video/ }).getAttribute("aria-checked")).toBe("true");
    expect(names().sort()).toEqual(["Clip maker", "Huge clip maker"]);
    fireEvent.click(screen.getByRole("radio", { name: /^Upscale/ }));
    expect(screen.getByText("No models match this filter.")).toBeTruthy();
  });

  it("no longer quotes the download size a second time as a weight floor", () => {
    show();
    expect(screen.queryByText(/weight floor/)).toBeNull();
  });

  it("opens the token form inside a gated model's card", async () => {
    hostAnswers({ hf_token_status: { present: false, hint: null } });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add access token" }));
    // The same form as on the Security screen, here where the need is.
    expect(await screen.findByText("Hugging Face account")).toBeTruthy();
    expect(screen.getByPlaceholderText("hf_...")).toBeTruthy();
  });
});
