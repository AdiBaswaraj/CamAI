// OCRWorker: Tesseract.js LSTM + Fuse.js fuzzy matching. Returns word-level
// bounding boxes plus the best fuzzy match against the user-supplied target.

import { createWorker } from 'tesseract.js';
import Fuse from 'fuse.js';

let tess = null;
let busy = false;

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    switch (msg.type) {
      case 'init':
        await initTesseract();
        break;
      case 'recognize':
        if (busy) return; // back-pressure: drop frames if previous still running
        busy = true;
        try {
          await handleRecognize(msg);
        } finally {
          busy = false;
        }
        break;
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: err?.message || String(err) });
  }
};

async function initTesseract() {
  tess = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'loading tesseract core') self.postMessage({ type: 'progress', value: 0.1 });
      else if (m.status === 'initializing tesseract') self.postMessage({ type: 'progress', value: 0.25 });
      else if (m.status === 'loading language traineddata') {
        self.postMessage({ type: 'progress', value: 0.3 + (m.progress || 0) * 0.55 });
      } else if (m.status === 'initializing api') self.postMessage({ type: 'progress', value: 0.9 });
    }
  });
  await tess.setParameters({
    tessedit_pageseg_mode: '6'
  });
  self.postMessage({ type: 'progress', value: 1 });
  self.postMessage({ type: 'ready' });
}

async function handleRecognize({ imageBitmap, frameId, target, threshold, mode }) {
  if (!tess || !imageBitmap) return;

  const w = imageBitmap.width;
  const h = imageBitmap.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0);
  imageBitmap.close?.();
  const blob = await canvas.convertToBlob({ type: 'image/png' });

  const result = await tess.recognize(blob, {}, { blocks: false });

  const data = result.data || {};
  const words = (data.words || [])
    .filter((wd) => wd.confidence > 30 && wd.text && wd.text.trim().length > 0)
    .map((wd) => ({
      text: wd.text,
      confidence: wd.confidence / 100,
      bbox: [
        wd.bbox.x0,
        wd.bbox.y0,
        wd.bbox.x1 - wd.bbox.x0,
        wd.bbox.y1 - wd.bbox.y0
      ]
    }));
  const lines = (data.lines || [])
    .filter((ln) => ln.confidence > 30 && ln.text && ln.text.trim().length > 0)
    .map((ln) => ({
      text: ln.text.trim(),
      confidence: ln.confidence / 100,
      bbox: [
        ln.bbox.x0,
        ln.bbox.y0,
        ln.bbox.x1 - ln.bbox.x0,
        ln.bbox.y1 - ln.bbox.y0
      ]
    }));

  let match = null;
  if (target && (mode === 'label' || mode === 'auto')) {
    const fuse = new Fuse(lines, {
      keys: ['text'],
      includeScore: true,
      threshold: typeof threshold?.fuse === 'number' ? threshold.fuse : 0.35,
      ignoreLocation: true,
      minMatchCharLength: 2
    });
    const hits = fuse.search(target);
    if (hits.length > 0) {
      const top = hits[0];
      match = {
        text: top.item.text,
        confidence: 1 - top.score,
        bbox: top.item.bbox,
        rawConfidence: top.item.confidence
      };
    } else {
      // Fallback: check the whole frame text.
      const allText = (data.text || '').replace(/\s+/g, ' ').trim();
      if (allText) {
        const fuse2 = new Fuse([{ text: allText }], {
          keys: ['text'],
          includeScore: true,
          threshold: typeof threshold?.fuse === 'number' ? threshold.fuse : 0.35,
          ignoreLocation: true,
          minMatchCharLength: 2
        });
        const r2 = fuse2.search(target);
        if (r2.length > 0) {
          match = {
            text: target,
            confidence: 1 - r2[0].score,
            bbox: null,
            rawConfidence: 0.5
          };
        }
      }
    }
  }

  self.postMessage({
    type: 'ocr',
    frameId,
    width: w,
    height: h,
    words,
    lines,
    match,
    target
  });
}
