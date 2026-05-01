import { useEffect, useRef, useState } from 'react';

// Loads VisionWorker (TF.js + COCO-SSD + color analysis) and OCRWorker
// (Tesseract.js + Fuse.js). Surfaces a unified loading-progress for the
// progress bar shown on first run. Models are cached by the service worker
// + IndexedDB after first load.
export function useWorkers() {
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState({ show: true, label: 'Initializing models', value: 0 });
  const [error, setError] = useState(null);
  const visionRef = useRef(null);
  const ocrRef = useRef(null);
  const stateRef = useRef({ vision: 0, ocr: 0, visionReady: false, ocrReady: false });

  useEffect(() => {
    let visionWorker, ocrWorker;
    try {
      visionWorker = new Worker(
        new URL('../workers/visionWorker.js', import.meta.url),
        { type: 'module' }
      );
      ocrWorker = new Worker(
        new URL('../workers/ocrWorker.js', import.meta.url),
        { type: 'module' }
      );
    } catch (e) {
      setError('Failed to start workers: ' + e.message);
      return;
    }

    visionRef.current = visionWorker;
    ocrRef.current = ocrWorker;

    const updateProgress = () => {
      const total = (stateRef.current.vision + stateRef.current.ocr) / 2;
      setProgress((p) => ({
        ...p,
        value: Math.round(total * 100),
        label: stateRef.current.visionReady && stateRef.current.ocrReady
          ? 'Ready'
          : (stateRef.current.visionReady ? 'Loading OCR engine' :
             stateRef.current.ocrReady ? 'Loading vision model' : 'Loading models')
      }));
      if (stateRef.current.visionReady && stateRef.current.ocrReady) {
        setReady(true);
        setTimeout(() => setProgress({ show: false, label: '', value: 100 }), 600);
      }
    };

    visionWorker.onmessage = (e) => {
      const { type, value, error: err } = e.data || {};
      if (type === 'progress') {
        stateRef.current.vision = value;
        updateProgress();
      } else if (type === 'ready') {
        stateRef.current.vision = 1;
        stateRef.current.visionReady = true;
        updateProgress();
      } else if (type === 'error') {
        setError('Vision worker: ' + err);
      }
    };

    ocrWorker.onmessage = (e) => {
      const { type, value, error: err } = e.data || {};
      if (type === 'progress') {
        stateRef.current.ocr = value;
        updateProgress();
      } else if (type === 'ready') {
        stateRef.current.ocr = 1;
        stateRef.current.ocrReady = true;
        updateProgress();
      } else if (type === 'error') {
        setError('OCR worker: ' + err);
      }
    };

    visionWorker.postMessage({ type: 'init' });
    ocrWorker.postMessage({ type: 'init' });

    return () => {
      visionWorker?.terminate();
      ocrWorker?.terminate();
    };
  }, []);

  return {
    ready,
    progress,
    error,
    vision: visionRef.current,
    ocr: ocrRef.current
  };
}
