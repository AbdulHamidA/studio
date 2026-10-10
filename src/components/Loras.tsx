import { useEffect, useState } from "react";
import { api, errText, fmtBytes, newJobId } from "../lib/api";
import type { Lora, ResolvedLora } from "../lib/types";
import Field from "./Field";

/**
 * Style and task adapters.
 *
 * A LoRA is a small set of weight deltas layered onto a base model, so a few
 * tens of megabytes buys a whole look or a specialised behaviour. They are tied
 * to a specific base: one trained for FLUX.2 Klein 9B will not load against the
 * 4B, and there is no way to tell from the file itself.
 */
export default function Loras({
  selected, onSelectedChange, notify,
}: {
  /** Handles paired with strengths, applied to the next run. */
  selected: [string, number][];
  onSelectedChange: (next: [string, number][]) => void;
  notify: (m: string, bad?: boolean) => void;
}) {
  const [installed, setInstalled] = useState<Lora[]>([]);
  const [adding, setAdding] = useState(false);
  const [repo, setRepo] = useState("");
  const [found, setFound] = useState<ResolvedLora | null>(null);
  const [file, setFile] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * Which adapter's removal is waiting for a yes.
   *
   * Removing was only offered once an adapter was switched on, and then
   * happened on one click -- so an unused adapter could not be removed at
   * all, and a used one could be lost by a slip.
   */
  const [confirming, setConfirming] = useState<string | null>(null);

  const remove = async (l: Lora) => {
    setConfirming(null);
    try {
      setInstalled(await api.removeLora(l.handle));
      onSelectedChange(selected.filter(([h]) => h !== l.handle));
      notify(`Removed ${l.name}.`);
    } catch (e) { notify(errText(e), true); }
  };

  const refresh = async () => {
    try { setInstalled(await api.listLoras()); } catch { /* none yet */ }
  };
  useEffect(() => { void refresh(); }, []);

  const check = async () => {
    setBusy(true); setFound(null);
    try {
      const r = await api.resolveLora(repo);
      setFound(r);
      setFile(r.files[0]?.name ?? "");
      if (r.files.length === 0) notify("No adapter weights in that repository.", true);
    } catch (e) { notify(errText(e), true); } finally { setBusy(false); }
  };

  const install = async () => {
    if (!found) return;
    setBusy(true);
    try {
      const name = file.replace(/\.safetensors$/, "") || found.repo.split("/").pop()!;
      setInstalled(await api.addLora(newJobId(), found.repo, file, name, found.bytes));
      notify(`Added ${name}.`);
      setRepo(""); setFound(null); setAdding(false);
    } catch (e) { notify(errText(e), true); } finally { setBusy(false); }
  };

  const toggle = (l: Lora) => {
    const at = selected.findIndex(([h]) => h === l.handle);
    if (at >= 0) onSelectedChange(selected.filter((_, i) => i !== at));
    else onSelectedChange([...selected, [l.handle, l.scale]]);
  };

  const setStrength = (handle: string, scale: number) =>
    onSelectedChange(selected.map(([h, s]) => (h === handle ? [h, scale] : [h, s])));

  return (
    <div className="panel">
      <h2>Style adapters</h2>

      {installed.length === 0 && !adding && (
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 10 }}>
          None yet. Adapters are usually tens of megabytes and change how a
          model draws — a look, a medium, or a specific task.
        </div>
      )}

      {installed.map((l) => {
        const active = selected.find(([h]) => h === l.handle);
        return (
          <div key={l.handle} className="lora">
            <div className="lora-head">
              <label className="check">
                <input type="checkbox" checked={!!active} onChange={() => toggle(l)} />
                {l.name}
              </label>
              <span className="t-help">{fmtBytes(l.bytes)}</span>
              {confirming === l.handle ? (
                <span className="lora-confirm" role="group" aria-label={`Remove ${l.name}?`}>
                  <span className="t-note">Remove?</span>
                  <button className="btn small danger" onClick={() => void remove(l)}>
                    Remove {fmtBytes(l.bytes)}
                  </button>
                  <button className="btn small" autoFocus onClick={() => setConfirming(null)}>Keep</button>
                </span>
              ) : (
                <button className="btn small" aria-label={`Remove ${l.name}`}
                  onClick={() => setConfirming(l.handle)}>
                  Remove
                </button>
              )}
            </div>
            {active && (
              <Field className="field tight"
                label={<>Strength for {l.name} <em aria-hidden="true">{active[1].toFixed(2)}</em></>}>
                <input
                  type="range" min={0} max={1.5} step={0.05} value={active[1]}
                  aria-valuetext={`strength ${active[1].toFixed(2)}`}
                  onChange={(e) => setStrength(l.handle, +e.target.value)}
                />
              </Field>
            )}
          </div>
        );
      })}

      {adding ? (
        <>
          <Field label="Adapter repository" hint="A Hugging Face repo id, like owner/name.">
            <input
              type="text" value={repo} spellCheck={false} autoFocus
              placeholder="fal/flux-2-klein-4B-outpaint-lora"
              onChange={(e) => { setRepo(e.target.value); setFound(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && repo.length > 2) void check(); }}
            />
          </Field>

          {found && found.files.length > 0 && (
            <>
              {found.files.length > 1 && (
                <Field label="Which adapter">
                  <select value={file} onChange={(e) => setFile(e.target.value)}>
                    {found.files.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.name} — {fmtBytes(f.bytes)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {found.not_an_adapter ? (
                // Checked before the download, not after. Nothing used to
                // check at all: a VAE repository looked exactly like an
                // adapter repository, downloaded, appeared installed, could be
                // selected and given a strength, and then changed nothing --
                // because there is no adapter in it to apply.
                <div className="notice bad" style={{ marginBottom: 10 }}>
                  <strong>This is not an adapter</strong>
                  {found.files[0]?.name} holds {found.not_an_adapter}. Installing
                  it would spend {fmtBytes(found.bytes)} on something that cannot
                  change a picture.
                </div>
              ) : (
                <div className="notice warn" style={{ marginBottom: 10 }}>
                  <strong>{fmtBytes(found.bytes)}{found.base_model ? ` · for ${found.base_model}` : ""}</strong>
                  An adapter only works on the base model it was trained for. If it
                  was made for a different size or family, generation will fail or
                  the result will be unaffected.
                </div>
              )}
            </>
          )}

          <div style={{ display: "flex", gap: 7 }}>
            {!found ? (
              <button className="btn small primary" disabled={busy || repo.length < 3} onClick={check}>
                {busy ? "Checking…" : "Check"}
              </button>
            ) : (
              <button className="btn small primary"
                      disabled={busy || !found.files.length || !!found.not_an_adapter}
                      onClick={install}>
                {busy ? "Downloading…" : `Install ${fmtBytes(found.bytes)}`}
              </button>
            )}
            <button className="btn small" onClick={() => { setAdding(false); setFound(null); }}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button className="btn small" onClick={() => setAdding(true)}>+ Add an adapter</button>
      )}
    </div>
  );
}
