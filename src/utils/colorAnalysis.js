// Color name extraction + matching from RGBA pixel buffers, with HSV-based bins.
// Used by Object Hunt (verify color of a detected object) and Hybrid mode.

const COLORS = [
  { name: 'red',    h: [[0, 12], [345, 360]], s: [0.35, 1], v: [0.25, 1] },
  { name: 'orange', h: [[12, 35]],            s: [0.45, 1], v: [0.35, 1] },
  { name: 'yellow', h: [[35, 65]],            s: [0.35, 1], v: [0.5, 1]  },
  { name: 'green',  h: [[65, 165]],           s: [0.25, 1], v: [0.18, 1] },
  { name: 'cyan',   h: [[165, 200]],          s: [0.25, 1], v: [0.25, 1] },
  { name: 'blue',   h: [[200, 255]],          s: [0.25, 1], v: [0.18, 1] },
  { name: 'purple', h: [[255, 295]],          s: [0.2, 1],  v: [0.18, 1] },
  { name: 'pink',   h: [[295, 345]],          s: [0.2, 1],  v: [0.4, 1]  }
];

const COLOR_ALIASES = {
  red: ['red', 'crimson', 'scarlet', 'maroon'],
  orange: ['orange', 'amber'],
  yellow: ['yellow', 'gold', 'golden'],
  green: ['green', 'olive', 'lime', 'emerald'],
  cyan: ['cyan', 'teal', 'turquoise', 'aqua'],
  blue: ['blue', 'navy', 'azure', 'cobalt', 'indigo'],
  purple: ['purple', 'violet', 'lavender', 'magenta'],
  pink: ['pink', 'rose', 'salmon'],
  white: ['white', 'ivory', 'cream'],
  black: ['black'],
  gray:  ['gray', 'grey', 'silver']
};

export const COLOR_NAMES = Object.keys(COLOR_ALIASES);

export function extractColorWords(text) {
  const lower = text.toLowerCase();
  const out = [];
  for (const [base, list] of Object.entries(COLOR_ALIASES)) {
    if (list.some((w) => new RegExp(`\\b${w}\\b`).test(lower))) out.push(base);
  }
  return out;
}

export function rgbToHsv(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function classify(h, s, v) {
  if (v < 0.18) return 'black';
  if (s < 0.12 && v > 0.85) return 'white';
  if (s < 0.15) return 'gray';
  for (const c of COLORS) {
    if (s < c.s[0] || s > c.s[1]) continue;
    if (v < c.v[0] || v > c.v[1]) continue;
    if (c.h.some(([lo, hi]) => h >= lo && h <= hi)) return c.name;
  }
  return 'gray';
}

// Sample pixels from an RGBA buffer (e.g. ImageData.data) covering [w x h].
// Returns histogram of color-name -> share (0..1) and the dominant color.
export function analyzeRegion(rgba, width, height, opts = {}) {
  const stride = opts.stride || 4;
  const counts = Object.fromEntries(COLOR_NAMES.map((n) => [n, 0]));
  let total = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3];
      if (a < 8) continue;
      const name = classify(...Object.values(rgbToHsv(rgba[i], rgba[i + 1], rgba[i + 2])));
      counts[name]++;
      total++;
    }
  }
  if (total === 0) return { dominant: null, share: 0, histogram: counts };
  let dominant = null, max = 0;
  const histogram = {};
  for (const [k, v] of Object.entries(counts)) {
    histogram[k] = v / total;
    if (v > max) { max = v; dominant = k; }
  }
  return { dominant, share: max / total, histogram };
}

// Compare two color histograms — cosine similarity over the color-name vector.
export function histogramSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const k of COLOR_NAMES) {
    const va = a[k] || 0;
    const vb = b[k] || 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

// Score how well a region matches a target color name. 0..1.
export function colorMatchScore(histogram, targetColors) {
  if (!targetColors || targetColors.length === 0) return 1;
  let best = 0;
  for (const name of targetColors) {
    const score = histogram[name] || 0;
    if (score > best) best = score;
  }
  return best;
}
