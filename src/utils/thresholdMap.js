// Maps the 4 preset threshold buttons to numerical values used by:
//   - Fuse.js (lower = stricter; 0 means exact, 1 means anything)
//   - confidence comparisons (0..1)
//   - color similarity comparisons (0..1)
export const THRESHOLDS = {
  exact:   { label: 'Exact',   pct: 100, fuse: 0.0,  conf: 0.90, color: 0.92 },
  strict:  { label: 'Strict',  pct: 90,  fuse: 0.15, conf: 0.70, color: 0.82 },
  loose:   { label: 'Loose',   pct: 70,  fuse: 0.35, conf: 0.50, color: 0.65 },
  similar: { label: 'Similar', pct: 50,  fuse: 0.55, conf: 0.35, color: 0.50 }
};

export const THRESHOLD_KEYS = ['exact', 'strict', 'loose', 'similar'];

export function getThreshold(key) {
  return THRESHOLDS[key] || THRESHOLDS.strict;
}
