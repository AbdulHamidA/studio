import { useState } from "react";
import { fmtBytes, fmtDuration, vaultUrl } from "../../lib/api";
import type { VaultItem } from "../../lib/types";
import { isAudio, isImage, isPdf, isVideo, kindLabel } from "../../lib/library";

/** A small picture of an item, whatever kind it is. */
export function MiniThumb({ item, byId }: { item: VaultItem; byId?: ReadonlyMap<string, VaultItem> }) {
  const [broken, setBroken] = useState(false);
  const cover = coverOf(item, byId);
  if (cover && !broken) {
    return <img src={vaultUrl(cover)} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  if (isVideo(item) && !broken) {
    return <video src={`${vaultUrl(item.id)}#t=0.1`} muted preload="metadata" onError={() => setBroken(true)} />;
  }
  return <span className="glyph" aria-hidden>{isAudio(item) ? "♫" : isPdf(item) ? "▤" : "▦"}</span>;
}

/**
 * The picture that stands for an item.
 *
 * An image is its own; a bound PDF is its first page, which is in the vault
 * already as the item it was bound from; an animation is the frame it started
 * from. Anything else has none and gets a glyph.
 */
export function coverOf(item: VaultItem, byId?: ReadonlyMap<string, VaultItem>): string | null {
  if (isImage(item)) return item.id;
  if ((isPdf(item) || isVideo(item)) && byId) {
    const first = item.inputs.map((id) => byId.get(id)).find((i) => i && isImage(i));
    if (first) return first.id;
  }
  return null;
}

/**
 * Everything recorded about an item, beside it.
 *
 * Rows that were never recorded are left out rather than shown as dashes: a
 * column of "—" for an audiobook's seed and steps made it hard to find the
 * three facts that did apply.
 */
export default function InfoPanel({
  item, chain, children: madeFrom, onOpen, byId, onCopyPrompt,
}: {
  item: VaultItem;
  /** Ancestors, oldest first. */
  chain: VaultItem[];
  /** Items made from this one. */
  children: VaultItem[];
  onOpen: (item: VaultItem) => void;
  byId: ReadonlyMap<string, VaultItem>;
  onCopyPrompt: () => void;
}) {
  const rows: [string, string | null][] = [
    ["Kind", kindLabel(item.kind)],
    ["Model", item.model || null],
    ["Seed", item.seed ? String(item.seed) : null],
    ["Dimensions", item.width && item.height ? `${item.width} × ${item.height}` : null],
    ["Steps", item.steps != null ? String(item.steps) : null],
    ["Guidance", item.guidance != null ? item.guidance.toFixed(1) : null],
    ["Strength", item.image_strength != null ? item.image_strength.toFixed(2) : null],
    ["Adapters", item.loras?.length ? item.loras.map(([h, s]) => `${h} (${s})`).join(", ") : null],
    ["Took", item.duration_ms ? fmtDuration(item.duration_ms) : null],
    ["Created", new Date(item.created_at).toLocaleString()],
    ["File", `${item.name} · ${fmtBytes(item.bytes)}`],
    ["Type", item.mime],
    ["Board", item.project_name ?? null],
  ];
  return (
    <aside className="info-panel" aria-label="Details">
      {item.prompt && (
        <section>
          <div className="info-label">
            {isAudio(item) ? "Title" : isPdf(item) ? "Contents" : "Prompt"}
            {!isAudio(item) && !isPdf(item) && (
              <button className="link-btn" onClick={onCopyPrompt} aria-label="Copy prompt">Copy</button>
            )}
          </div>
          <p className="info-prompt">{item.prompt}</p>
        </section>
      )}
      {item.negative_prompt && (
        <section>
          <div className="info-label">Negative prompt</div>
          <p className="info-prompt dim">{item.negative_prompt}</p>
        </section>
      )}
      <dl className="info-rows">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {chain.length > 0 && (
        <section>
          <div className="info-label">How this was made</div>
          <div className="lineage">
            {chain.map((step) => (
              <button key={step.id} className="lineage-step" onClick={() => onOpen(step)}
                      title={`${kindLabel(step.kind)}: ${step.prompt || step.name}`}
                      aria-label={`Open ${kindLabel(step.kind).toLowerCase()} step: ${step.prompt || step.name}`}>
                <MiniThumb item={step} byId={byId} />
                <span>{kindLabel(step.kind)}</span>
              </button>
            ))}
            <div className="lineage-step current" aria-current="true">
              <MiniThumb item={item} byId={byId} />
              <span>{kindLabel(item.kind)}</span>
            </div>
          </div>
        </section>
      )}
      {item.inputs.length > chain.filter((c) => item.inputs.includes(c.id)).length && (
        <p className="info-note">
          Some inputs are no longer in the vault.
        </p>
      )}
      {madeFrom.length > 0 && (
        <section>
          <div className="info-label">Made from this ({madeFrom.length})</div>
          <div className="lineage">
            {madeFrom.slice(0, 12).map((c) => (
              <button key={c.id} className="lineage-step" onClick={() => onOpen(c)}
                      title={`${kindLabel(c.kind)}: ${c.prompt || c.name}`}
                      aria-label={`Open ${kindLabel(c.kind).toLowerCase()}: ${c.prompt || c.name}`}>
                <MiniThumb item={c} byId={byId} />
                <span>{kindLabel(c.kind)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
