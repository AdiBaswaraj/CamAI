// OCRWorker: Tesseract.js (Legacy fast / LSTM accurate) + Fuse.js fuzzy
// matching. Returns word-level bounding boxes plus the best fuzzy match
// against the user-supplied target.
//
// "Fast" mode  → OEM 0 (Legacy Tesseract), tessdata_fast traineddata, PSM 7
// "Accurate"   → OEM 1 (LSTM),             standard traineddata,     PSM 11

import { createWorker, OEM, PSM } from 'tesseract.js';
import Fuse from 'fuse.js';

const LANG_PATHS = {
  fast: 'https://tessdata.projectnaptha.com/4.0.0_fast',
  accurate: 'https://tessdata.projectnaptha.com/4.0.0'
};

let tess = null;
let currentOem = 0;
let currentPsm = '11';
let currentMode = 'fast';
let busy = false;
let initPromise = null;

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    switch (msg.type) {
      case 'init':
      case 'setMode':
        await initTesseract(msg.ocrMode || 'fast');
        break;
      case 'recognize':
        if (busy || initPromise) return; // back-pressure: drop frames
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

// Serialize init so an incoming setMode while an init is still running waits
// for the previous to finish, then runs the new one. No-op if same mode.
async function initTesseract(ocrMode) {
  if (initPromise) {
    await initPromise.catch(() => {});
    if (currentMode === ocrMode && tess) return;
  }
  if (currentMode === ocrMode && tess && !initPromise) return;
  initPromise = doInit(ocrMode);
  try { await initPromise; } finally { initPromise = null; }
}

async function doInit(ocrMode) {
  // Tear down any existing engine before swapping language data / OEM.
  if (tess) {
    try { await tess.terminate(); } catch {}
    tess = null;
  }

  const oem = ocrMode === 'accurate' ? OEM.LSTM_ONLY : OEM.TESSERACT_ONLY;
  const psm = ocrMode === 'accurate' ? PSM.SPARSE_TEXT : PSM.SINGLE_LINE;
  currentOem = oem;
  currentPsm = String(psm);
  currentMode = ocrMode;

  self.postMessage({ type: 'modeChanging', ocrMode });

  tess = await createWorker('eng', oem, {
    langPath: LANG_PATHS[ocrMode],
    logger: (m) => {
      if (m.status === 'loading tesseract core') self.postMessage({ type: 'progress', value: 0.1 });
      else if (m.status === 'initializing tesseract') self.postMessage({ type: 'progress', value: 0.25 });
      else if (m.status === 'loading language traineddata') {
        self.postMessage({ type: 'progress', value: 0.3 + (m.progress || 0) * 0.55 });
      } else if (m.status === 'initializing api') self.postMessage({ type: 'progress', value: 0.9 });
    }
  });

  await tess.setParameters({ tessedit_pageseg_mode: currentPsm });

  self.postMessage({ type: 'progress', value: 1 });
  self.postMessage({ type: 'ready', ocrMode });
}

async function handleRecognize({
  imageBitmap,
  frameId,
  target,
  threshold,
  mode,
  cropOffsetX = 0,
  cropOffsetY = 0,
  bitmapScale = 1,
  originalW,
  originalH,
  psm
}) {
  if (!tess || !imageBitmap) {
    imageBitmap?.close?.();
    return;
  }

  // PSM may be overridden per request (e.g. main thread chooses 7 for crop, 11 for full frame).
  if (psm && String(psm) !== currentPsm) {
    currentPsm = String(psm);
    await tess.setParameters({ tessedit_pageseg_mode: currentPsm });
  }

  const w = imageBitmap.width;
  const h = imageBitmap.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0);
  imageBitmap.close?.();
  const blob = await canvas.convertToBlob({ type: 'image/png' });

  const result = await tess.recognize(blob, {}, { blocks: false });
  const data = result.data || {};

  // Word and line bboxes are returned in the cropped-bitmap coordinate space;
  // translate to original camera-frame coordinates so the main thread's
  // overlay projection (frameW/H = originalW/H) places them correctly.
  // bitmapScale = (crop region size in original frame) / (bitmap size).
  const s = bitmapScale;
  const toOrig = (b) => [
    b.x0 * s + cropOffsetX,
    b.y0 * s + cropOffsetY,
    (b.x1 - b.x0) * s,
    (b.y1 - b.y0) * s
  ];

  const words = (data.words || [])
    .filter((wd) => wd.confidence > 30 && wd.text && wd.text.trim().length > 0)
    .map((wd) => ({
      text: wd.text,
      confidence: wd.confidence / 100,
      bbox: toOrig(wd.bbox)
    }));

  const lines = (data.lines || [])
    .filter((ln) => ln.confidence > 30 && ln.text && ln.text.trim().length > 0)
    .map((ln) => ({
      text: ln.text.trim(),
      confidence: ln.confidence / 100,
      bbox: toOrig(ln.bbox),
      words: (ln.words || [])
        .filter((wd) => wd.text && wd.text.trim().length > 0)
        .map((wd) => ({ text: wd.text, bbox: toOrig(wd.bbox) }))
    }));

  let match = null;
  if (target && (mode === 'label' || mode === 'auto')) {
    const fuseThreshold = typeof threshold?.fuse === 'number' ? threshold.fuse : 0.35;

    // 1. Fuzzy-match against full lines (best for multi-word labels).
    const lineFuse = new Fuse(lines, {
      keys: ['text'],
      includeScore: true,
      threshold: fuseThreshold,
      ignoreLocation: true,
      minMatchCharLength: 2
    });
    const lineHits = lineFuse.search(target);
    if (lineHits.length > 0) {
      const top = lineHits[0];
      const matchedWordsBbox = unionBboxFromWords(top.item.words, target);
      match = {
        text: top.item.text,
        confidence: 1 - top.score,
        bbox: matchedWordsBbox || top.item.bbox,
        kind: 'line',
        rawConfidence: top.item.confidence
      };
    }

    // 2. Also try word-level matches (better bbox precision for single tokens).
    if (!match || match.confidence < 0.85) {
      const wordFuse = new Fuse(words, {
        keys: ['text'],
        includeScore: true,
        threshold: fuseThreshold,
        ignoreLocation: true,
        minMatchCharLength: 2
      });
      const wordHits = wordFuse.search(target);
      if (wordHits.length > 0) {
        const top = wordHits[0];
        const score = 1 - top.score;
        if (!match || score > match.confidence) {
          match = {
            text: top.item.text,
            confidence: score,
            bbox: top.item.bbox,
            kind: 'word',
            rawConfidence: top.item.confidence
          };
        }
      }
    }

    // 3. Final fallback: substring-match against the whole frame's text.
    if (!match) {
      const allText = (data.text || '').replace(/\s+/g, ' ').trim();
      if (allText) {
        const fuseAll = new Fuse([{ text: allText }], {
          keys: ['text'],
          includeScore: true,
          threshold: fuseThreshold,
          ignoreLocation: true,
          minMatchCharLength: 2
        });
        const hits = fuseAll.search(target);
        if (hits.length > 0) {
          match = {
            text: target,
            confidence: 1 - hits[0].score,
            bbox: null,
            kind: 'frame',
            rawConfidence: 0.5
          };
        }
      }
    }
  }

  self.postMessage({
    type: 'ocr',
    frameId,
    width: originalW || w,
    height: originalH || h,
    cropOffsetX: offX,
    cropOffsetY: offY,
    words,
    lines: lines.map(({ words: _w, ...rest }) => rest),
    match,
    target,
    oem: currentOem
  });
}

// Given a list of word objects { text, bbox } and a target phrase, find the
// words that most likely make up the match, return the unioned bbox.
function unionBboxFromWords(wordItems, target) {
  if (!wordItems || wordItems.length === 0) return null;
  const tokens = target.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const matched = [];
  for (const w of wordItems) {
    const norm = w.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm.length < 2) continue;
    for (const t of tokens) {
      const tn = t.replace(/[^a-z0-9]/g, '');
      if (tn.length < 2) continue;
      if (norm.includes(tn) || tn.includes(norm)) {
        matched.push(w);
        break;
      }
    }
  }
  if (matched.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of matched) {
    const [x, y, ww, hh] = w.bbox;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x + ww > x1) x1 = x + ww;
    if (y + hh > y1) y1 = y + hh;
  }
  return [x0, y0, x1 - x0, y1 - y0];
}
