// Build a lightweight feature vector from an uploaded reference image:
//   - 11-bin color-name histogram (matches colorAnalysis bins)
//   - 8-bin edge-orientation histogram from a Sobel pass
// Comparison is cosine similarity averaged across both vectors.

import { analyzeRegion, COLOR_NAMES, histogramSimilarity } from './colorAnalysis.js';

export function computeImageFeatures(imageData) {
  const { data, width, height } = imageData;
  const colorRes = analyzeRegion(data, width, height, { stride: 3 });
  const edges = edgeHistogram(data, width, height);
  return { colorHistogram: colorRes.histogram, edges, width, height };
}

// Compute a simple 8-bin gradient orientation histogram via Sobel.
function edgeHistogram(rgba, w, h) {
  const bins = new Array(8).fill(0);
  let count = 0;
  const idx = (x, y) => (y * w + x) * 4;
  const lum = (i) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  const stride = 2;
  for (let y = 1; y < h - 1; y += stride) {
    for (let x = 1; x < w - 1; x += stride) {
      const gx =
        -lum(idx(x - 1, y - 1)) - 2 * lum(idx(x - 1, y)) - lum(idx(x - 1, y + 1)) +
         lum(idx(x + 1, y - 1)) + 2 * lum(idx(x + 1, y)) + lum(idx(x + 1, y + 1));
      const gy =
        -lum(idx(x - 1, y - 1)) - 2 * lum(idx(x, y - 1)) - lum(idx(x + 1, y - 1)) +
         lum(idx(x - 1, y + 1)) + 2 * lum(idx(x, y + 1)) + lum(idx(x + 1, y + 1));
      const mag = Math.hypot(gx, gy);
      if (mag < 30) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      const bin = Math.min(7, Math.floor((angle / Math.PI) * 8));
      bins[bin] += mag;
      count += mag;
    }
  }
  if (count === 0) return bins;
  return bins.map((b) => b / count);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export function compareFeatures(refFeatures, frameRgba, frameW, frameH) {
  const colorRes = analyzeRegion(frameRgba, frameW, frameH, { stride: 4 });
  const colorScore = histogramSimilarity(refFeatures.colorHistogram, colorRes.histogram);
  const frameEdges = edgeHistogram(frameRgba, frameW, frameH);
  const edgeScore = cosine(refFeatures.edges, frameEdges);
  return {
    score: 0.65 * colorScore + 0.35 * edgeScore,
    colorScore,
    edgeScore,
    dominant: colorRes.dominant
  };
}

export { COLOR_NAMES };
