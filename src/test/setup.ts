/**
 * What a component test gets instead of a Tauri host.
 *
 * Every screen in this app talks to Rust through `invoke`, which does not
 * exist in a browser and certainly not in jsdom. Without a stub, importing any
 * component fails at module load and the failure reads as a broken test rather
 * than a missing host.
 *
 * The stub throws by default. A test that reaches a command it has not
 * declared should fail saying which one, rather than receiving `undefined` and
 * carrying on to assert something about a screen in a state the real app can
 * never be in -- which is the specific way a mocked test lies.
 */
import { afterEach, vi } from "vitest";

/** Commands a test has answered, by name. */
const answers = new Map<string, (args: Record<string, unknown>) => unknown>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    const answer = answers.get(cmd);
    if (!answer) {
      return Promise.reject(
        new Error(
          `the test did not say what "${cmd}" returns. Call hostAnswers({ ` +
            `${cmd}: ... }) before rendering.`,
        ),
      );
    }
    return Promise.resolve(answer(args));
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

/**
 * Declare what the Rust side returns for this test.
 *
 * A value is returned as-is; a function is called with the command's arguments,
 * so a test can assert on what it was sent.
 */
export function hostAnswers(
  map: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>,
) {
  for (const [cmd, value] of Object.entries(map)) {
    answers.set(cmd, typeof value === "function"
      ? (value as (a: Record<string, unknown>) => unknown)
      : () => value);
  }
}

afterEach(() => {
  answers.clear();
});

// jsdom has no layout, so anything measuring an element reads zero. Components
// here do not depend on it; if one starts to, this is where it is faked rather
// than in the test that noticed.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
