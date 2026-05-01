// VisionWorker: TF.js COCO-SSD detection + per-bbox color analysis,
// + reference-image feature matching. Runs entirely off the main thread.

import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { analyzeRegion, colorMatchScore, extractColorWords } from '../utils/colorAnalysis.js';
import { inferClasses } from '../utils/cocoClasses.js';
import { computeImageFeatures, compareFeatures } from '../utils/referenceFeatures.js';

let model = null;
let referenceFeatures = null;

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    switch (msg.type) {
      case 'init':
        await initModel();
        break;
      case 'detect':
        await handleDetect(msg);
        break;
      case 'setReference':
        referenceFeatures = msg.imageData
          ? computeImageFeatures(msg.imageData)
          : null;
        self.postMessage({ type: 'referenceReady', ok: !!referenceFeatures });
        break;
      case 'clearReference':
        referenceFeatures = null;
        break;
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: err?.message || String(err) });
  }
};

async function initModel() {
  // Roughly 6 MB of weights + WASM/WebGL backend init.
  await tf.ready();
  self.postMessage({ type: 'progress', value: 0.2 });

  // mobilenet_v2 base — heavier but more accurate than lite_mobilenet_v2.
  // We pick lite for speed on mobile.
  model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  self.postMessage({ type: 'progress', value: 1 });
  self.postMessage({ type: 'ready' });
}

async function handleDetect({ imageBitmap, frameId, mode, target, threshold }) {
  if (!model || !imageBitmap) return;

  const w = imageBitmap.width;
  const h = imageBitmap.height;

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imageBitmap, 0, 0);
  imageBitmap.close?.();

  const predictions = await model.detect(canvas, 12, 0.35);

  const targetClasses = mode === 'object' || mode === 'auto'
    ? inferClasses(target || '')
    : [];
  const targetColors = mode === 'object' || mode === 'auto'
    ? extractColorWords(target || '')
    : [];

  const objects = predictions.map((p) => {
    const [x, y, bw, bh] = p.bbox;
    const sx = Math.max(0, Math.floor(x));
    const sy = Math.max(0, Math.floor(y));
    const sw = Math.max(1, Math.min(w - sx, Math.floor(bw)));
    const sh = Math.max(1, Math.min(h - sy, Math.floor(bh)));
    let colorRes = null;
    let colorScore = null;
    if (targetColors.length || mode === 'reference') {
      try {
        const region = ctx.getImageData(sx, sy, sw, sh);
        colorRes = analyzeRegion(region.data, region.width, region.height, { stride: 3 });
        if (targetColors.length) {
          colorScore = colorMatchScore(colorRes.histogram, targetColors);
        }
      } catch {}
    }
    const classMatch = targetClasses.length === 0 || targetClasses.includes(p.class);
    let score = p.score;
    if (targetClasses.length) {
      score = classMatch ? p.score : 0;
    }
    if (targetColors.length && score > 0) {
      score *= 0.4 + 0.6 * (colorScore || 0);
    }
    return {
      class: p.class,
      bbox: [sx, sy, sw, sh],
      raw: p.score,
      score,
      classMatch,
      dominantColor: colorRes?.dominant || null,
      colorScore
    };
  });

  let referenceMatch = null;
  if (mode === 'reference' && referenceFeatures) {
    // Pick the strongest object region OR center crop and compare.
    const candidates = objects.length
      ? objects.slice().sort((a, b) => b.raw - a.raw).slice(0, 4)
      : [];
    if (candidates.length === 0) {
      const cw = Math.floor(w * 0.6), ch = Math.floor(h * 0.6);
      candidates.push({
        class: 'region',
        bbox: [Math.floor((w - cw) / 2), Math.floor((h - ch) / 2), cw, ch],
        raw: 0.5,
        score: 0
      });
    }
    for (const c of candidates) {
      const region = ctx.getImageData(...c.bbox);
      const cmp = compareFeatures(referenceFeatures, region.data, region.width, region.height);
      const finalScore = cmp.score;
      if (!referenceMatch || finalScore > referenceMatch.score) {
        referenceMatch = {
          class: c.class,
          bbox: c.bbox,
          score: finalScore,
          colorScore: cmp.colorScore,
          edgeScore: cmp.edgeScore
        };
      }
    }
  }

  self.postMessage({
    type: 'detection',
    frameId,
    width: w,
    height: h,
    objects,
    targetClasses,
    targetColors,
    referenceMatch,
    threshold
  });
}
