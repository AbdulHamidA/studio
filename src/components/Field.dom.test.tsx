/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Field from "./Field";

afterEach(cleanup);
describe("Field", () => {
  it("names its control and links the hint and the error", () => {
    render(<Field label="Steps" hint="More is slower" error="Must be 1-50"><input type="range" /></Field>);
    const input = screen.getByLabelText("Steps");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const described = input.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(["More is slower", "Must be 1-50"]);
  });
});
