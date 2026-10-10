/** A deterministic placeholder picture per vault id, for the mock host. */
const PALETTES = [["#2b4c7e", "#e0a458"], ["#3d5a40", "#d9c5a0"], ["#5b2a42", "#f2b880"], ["#1f3b4d", "#9cc5d4"], ["#4a3f35", "#c7a27c"]];
export function mockVaultUrl(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = PALETTES[h % PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${300 + (h % 400)}" cy="${250 + (h % 200)}" r="140" fill="rgba(255,255,255,.18)"/><text x="40" y="720" font-family="-apple-system" font-size="34" fill="rgba(255,255,255,.7)">${id}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
