/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PromptProposal from "./PromptProposal";
import type { AssistResult } from "../lib/types";

/**
 * The first component test in this project, and the reason there is a harness.
 *
 * `PromptProposal` is where every honesty fix in the enhancer either reaches
 * the user or does not, and all of it was previously unverifiable: the engine
 * building a correct reply proves nothing if the branch that renders it drops
 * a field. That is exactly what had happened -- `note` was built, typed,
 * styled, sent, and rendered by two of the three branches.
 */
const base: AssistResult = {
  prompt: "a tabby cat curled on a worn oak chair",
  original: "a masterpiece 8k cat on a chair",
  changed: true,
  saw_image: false,
  outcome: "proposal",
};

const noop = () => {};

function show(over: Partial<AssistResult>) {
  render(
    <PromptProposal
      result={{ ...base, ...over }}
      onAccept={noop}
      onDismiss={noop}
    />,
  );
}

describe("PromptProposal tells the user what it knows", () => {
  it("shows the note on a successful rewrite", () => {
    // The blind-mode warning. It is how a rewrite made without looking at the
    // picture says so, and it is the common edit path now that an edit is
    // routed as an edit whether or not a reader is installed.
    show({ note: "Rewritten from your words only." });
    expect(screen.getByText(/Rewritten from your words only/)).toBeTruthy();
  });

  it("shows the note when it kept your words instead", () => {
    show({
      outcome: "rewrite_rejected",
      changed: false,
      note: "The rewrite drifted away from what you asked for.",
    });
    expect(screen.getByText(/drifted away/)).toBeTruthy();
  });

  it("shows the note when the request named nothing to draw", () => {
    show({
      outcome: "unclear",
      unclear: true,
      note: "Name something visible instead of quality labels.",
    });
    expect(screen.getByText(/Name something visible/)).toBeTruthy();
  });

  it("separates what was stripped from what the rewrite lost", () => {
    // Two different facts under two labels. They used to collide: `dropped`
    // was diffed against the prompt as typed, so a word the cleaner had
    // already removed appeared in both lists as the same red chip, and the
    // user was told one word was both deliberately removed and accidentally
    // lost.
    show({ removed: ["masterpiece", "8k"], dropped: ["chair"] });
    expect(screen.getByText("removed")).toBeTruthy();
    expect(screen.getByText("no longer says")).toBeTruthy();
    expect(screen.getAllByText("masterpiece")).toHaveLength(1);
  });

  it("does not claim to have read a picture it never saw", () => {
    show({ saw_image: false, description: "subject: a grey cat" });
    expect(screen.queryByText(/read from your picture/)).toBeNull();
  });

  it("says what it read when it did look", () => {
    show({ saw_image: true, description: "subject: a grey cat" });
    expect(screen.getByText(/read from your picture/)).toBeTruthy();
  });

  it("shows the rewrite it refused, so the choice is the user's", () => {
    // The checks are literal by design, so the text they refuse is often the
    // text that was wanted: asked for a cat "setting" on a chair the writer
    // says "sitting", which no string comparison can prove was meant.
    show({
      outcome: "rewrite_rejected",
      changed: false,
      note: "The rewrite lost something you asked for.",
      attempt: "a tabby cat sitting on a worn oak chair",
    });
    expect(screen.getByText(/sitting on a worn oak chair/)).toBeTruthy();
  });
});
