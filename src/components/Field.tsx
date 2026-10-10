import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

/**
 * A labelled control: the label, an optional hint and an optional error,
 * all tied to the control for assistive tech (WCAG 1.3.1, 3.3.1, 3.3.2).
 *
 * The screens laid a <label> beside its control with nothing linking the
 * two, so sliders, selects and text boxes had no accessible name. Pass the
 * control as the only child; it gets the id, aria-describedby and
 * aria-invalid it needs.
 */
export default function Field({ label, hint, error, children, className = "field" }: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: (children.props.id as string | undefined) ?? id,
        "aria-describedby": [children.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined,
        "aria-invalid": error ? true : children.props["aria-invalid"],
      })
    : children;
  return (
    <div className={className}>
      <label htmlFor={(children.props.id as string | undefined) ?? id}>{label}</label>
      {control}
      {hint && <div id={hintId} className="t-help">{hint}</div>}
      {error && <div id={errorId} className="field-error" role="alert">{error}</div>}
    </div>
  );
}
