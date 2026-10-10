import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { vaultUrl } from "../lib/api";
import type { EngineProgress } from "../lib/types";

/**
 * Pieces the creation screens -- Generate, Edit, Video, Upscale -- share.
 *
 * They live here rather than in shared.tsx so each screen's controls behave
 * the same way: a choice of one is a radio group everywhere, a run is started
 * by the same shortcut everywhere, and a failure looks the same everywhere.
 */

/**
 * Pick one of a few options, drawn as a row of buttons.
 *
 * These were plain buttons with the chosen one drawn in the accent colour, so
 * to a screen reader they were five unrelated buttons with no state, and to
 * anyone who does not see the accent well nothing was chosen at all (WCAG
 * 1.3.1, 1.4.1, 4.1.2). Now it is a radio group: one tab stop, arrows move
 * the choice, and the chosen one carries a tick as well as the colour.
 */
export function Choice<T extends string | number>({
  label, options, value, onChange, hint, disabled, chip,
}: {
  label: ReactNode;
  options: readonly (readonly [T, ReactNode])[];
  value: T;
  onChange: (v: T) => void;
  hint?: ReactNode;
  disabled?: boolean;
  /** Drawn as filter chips rather than buttons; the semantics are the same. */
  chip?: boolean;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, options.findIndex(([v]) => v === value));

  const onKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (at + step + options.length) % options.length;
    onChange(options[next][0]);
    refs.current[next]?.focus();
  };

  return (
    <div className="field">
      <div className="choice-label" id={`${id}-label`}>{label}</div>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={"choice" + (chip ? " chips" : "")}
        onKeyDown={onKey}
      >
        {options.map(([v, text], i) => {
          const on = i === at;
          return (
            <button
              key={String(v)}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={on}
              // Roving focus: the group is one stop in the tab order, which
              // is what a radio group is expected to be.
              tabIndex={on ? 0 : -1}
              disabled={disabled}
              className={chip ? "chip" + (on ? " on" : "") : "btn small" + (on ? " primary" : "")}
              onClick={() => onChange(v)}
            >
              {on && <span aria-hidden="true" className="tick">✓</span>}
              {text}
            </button>
          );
        })}
      </div>
      {hint && <div id={`${id}-hint`} className="t-help">{hint}</div>}
    </div>
  );
}

/** A two-state button whose state is not carried by colour alone. */
export function Toggle({ on, onChange, children }: {
  on: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={"btn small" + (on ? " primary" : "")}
      onClick={() => onChange(!on)}
    >
      {on && <span aria-hidden="true" className="tick">✓</span>}
      {children}
    </button>
  );
}

/**
 * ⌘↵ runs the screen, from wherever focus is inside it.
 *
 * Bound to the screen's root rather than the window: Generate and Edit are
 * both mounted at once (one hidden), and a window listener would start both.
 * When nothing at all has focus the key still works, but only for a screen
 * that is actually on display.
 */
export function useRunShortcut(run: () => void, enabled: boolean) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(run);
  latest.current = run;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
      if (document.activeElement && document.activeElement !== document.body) return;
      const el = root.current;
      if (!el || el.getClientRects().length === 0) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!enabled || !(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
    e.preventDefault();
    latest.current();
  };
  return { ref: root, onKeyDown };
}

const PHASE_SPOKEN: Record<string, string> = {
  load: "Loading the model",
  start: "Starting",
  denoise: "Generating",
  decode: "Decoding",
  save: "Saving",
  download: "Downloading",
};

/**
 * What a screen says out loud while it works.
 *
 * Phase changes only -- loading, generating, saving -- never every step, and
 * never the prompt writer's tokens: a live region that speaks on every update
 * talks over everything else the user is trying to do.
 */
export function useStatus(prog: EngineProgress | null) {
  const [text, setText] = useState("");
  const phase = prog?.phase;
  useEffect(() => {
    if (phase && PHASE_SPOKEN[phase]) setText(PHASE_SPOKEN[phase]);
  }, [phase]);
  return [text, setText] as const;
}

/** The one polite live region a screen has. */
export function LiveStatus({ text }: { text: string }) {
  return <div className="visually-hidden" role="status" aria-live="polite">{text}</div>;
}

/** True when a failure reads like running out of memory. */
export function looksLikeMemory(message: string): boolean {
  return /out of memory|memory|oom|allocat|metal|insufficient/i.test(message);
}

/**
 * A run that failed, said where the result would have been.
 *
 * A failure used to be a toast that faded in a few seconds, from a screen
 * that had already cleared the previous picture -- so what was left was an
 * empty canvas and no record of why. This stays until the next run, says what
 * to try, and offers to try again.
 */
export function RunError({ message, onRetry, onMemorySaver }: {
  message: string;
  onRetry: () => void;
  /** Offered when the failure looks like memory and the screen has the switch. */
  onMemorySaver?: () => void;
}) {
  const memory = looksLikeMemory(message);
  return (
    <div className="run-error" role="alert">
      <strong>That did not work</strong>
      <div className="run-error-msg">{message}</div>
      {memory && (
        <div className="run-error-tip">
          This Mac ran short of memory. Try Memory saver, a smaller size, or
          fewer pictures at once.
        </div>
      )}
      <div className="run-error-actions">
        {memory && onMemorySaver && (
          <button type="button" className="btn small primary" onClick={onMemorySaver}>
            Turn on Memory saver and retry
          </button>
        )}
        <button type="button" className={"btn small" + (memory && onMemorySaver ? "" : " primary")}
          onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  );
}

/** One picture or clip made this session, with what made it. */
export interface Made {
  id: string;
  prompt: string;
  seed: number;
}

/**
 * Everything made this session, newest first, as a choice of one.
 *
 * Each run used to wipe the strip, so comparing a result with the one before
 * it meant leaving for the library. It is a radio group for the same reasons
 * as `Choice`, and each thumbnail is named for what it is.
 */
export function ResultStrip({ items, selected, onSelect, video }: {
  items: Made[];
  selected: string | null;
  onSelect: (id: string) => void;
  video?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, items.findIndex((m) => m.id === selected));
  if (items.length < 2) return null;

  const onKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (at + step + items.length) % items.length;
    onSelect(items[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className="results-strip session" role="radiogroup" aria-label="Made this session"
         onKeyDown={onKey}>
      {items.map((m, i) => {
        const on = i === at;
        return (
          <button
            key={m.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            aria-label={`Result ${i + 1} of ${items.length}: ${m.prompt}`}
            className={"result-thumb" + (on ? " sel" : "")}
            onClick={() => onSelect(m.id)}
          >
            {video
              ? <span aria-hidden="true" className="result-thumb-clip">▷ {items.length - i}</span>
              : <img src={vaultUrl(m.id)} alt="" />}
            {on && <span aria-hidden="true" className="result-thumb-tick">✓</span>}
          </button>
        );
      })}
    </div>
  );
}
