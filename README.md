# ScoutAI 🔒

A fully offline, mobile-first React web app — a camera-based AI object & text
finder. **Zero data leaves the device.** All AI runs in the browser.

## Stack

- **React + Vite** — fast dev server, ES module workers
- **TensorFlow.js + COCO-SSD** — on-device object detection
- **Tesseract.js** — on-device OCR (LSTM)
- **Fuse.js** — fuzzy text matching
- **Canvas overlay** — bounding boxes, glow, off-frame arrows
- **PWA** — manifest + service worker, installable, offline-capable

## Detection modes

| Mode             | What it does                                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| **Object Hunt**  | "blue tie" → COCO-SSD detects `tie` → canvas pixel sampling verifies `blue`  |
| **Label Hunt**   | "Johnnie Walker Black" → Tesseract OCR reads frame → Fuse.js fuzzy matches   |
| **Reference**    | Upload a photo → extract color histogram + edge orientation → compare        |
| **Auto/Hybrid**  | "blue Hendricks gin bottle" → object + OCR signals combined                  |

## Match thresholds

Four preset buttons mapping to Fuse / confidence / color-similarity values:

| Preset   | %    | Fuse | Confidence | Color sim |
| -------- | ---- | ---- | ---------- | --------- |
| Exact    | 100% | 0.0  | 0.90       | 0.92      |
| Strict   | 90%  | 0.15 | 0.70       | 0.82      |
| Loose    | 70%  | 0.35 | 0.50       | 0.65      |
| Similar  | 50%  | 0.55 | 0.35       | 0.50      |

## Architecture

```
                  Main thread (UI + canvas drawing)
                     │              ▲
       postMessage   │              │  detection / ocr results
   (ImageBitmap)     ▼              │
                ┌─────────────┐  ┌─────────────┐
                │ VisionWorker│  │ OCRWorker   │
                │  TF.js      │  │ Tesseract   │
                │  COCO-SSD   │  │ Fuse.js     │
                │  Color      │  │             │
                └─────────────┘  └─────────────┘
```

- **VisionWorker** runs ~4 fps, samples per-bbox pixels for color verification.
- **OCRWorker** runs ~0.8 fps with back-pressure (drops frames if busy).
- Models download once and are cached by the **service worker** (and by
  IndexedDB internal to TF.js / Tesseract).

## Off-frame tracking

Last seen bbox + velocity → if target leaves frame, an animated 8-way
directional arrow points at the projected position.

## PWA

- `public/manifest.json` makes it installable ("Add to Home Screen")
- `public/sw.js` caches the app shell + model assets
- Works fully offline after first load

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
npm run build
npm run preview
```

For camera access on mobile, serve over HTTPS or localhost. For LAN testing on
a phone, use a tunnel (cloudflared, ngrok) or `vite preview --host` over HTTPS.

## Privacy

The 🔒 ON-DEVICE badge is permanent. The only network calls are first-load
fetches of TF.js + Tesseract model assets from public CDNs; afterwards
everything runs locally and the service worker serves models from cache.
