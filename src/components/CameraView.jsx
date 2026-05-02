import { useEffect, useRef, useState } from 'react';
import HUD from './HUD.jsx';
import MatchSheet from './MatchSheet.jsx';
import { useCamera } from '../hooks/useCamera.js';
import { OffFrameTracker } from '../utils/tracking.js';
import { THRESHOLDS } from '../utils/thresholdMap.js';
import { imageDataFromBlob } from '../utils/imageData.js';

const VISION_INTERVAL = 250;        // ms between TF.js detections
const OCR_INTERVAL_FAST = 500;      // ~2 fps for OEM 0 + center-crop
const OCR_INTERVAL_ACCURATE = 1200; // ~0.8 fps for OEM 1 LSTM full frame

// Fast-mode crop: 60% width × 70% height of the camera frame, centered.
const CROP_W_FRACTION = 0.6;
const CROP_H_FRACTION = 0.7;

// How many consecutive scans without seeing the target before the match
// panel auto-clears. (Spec: clear after >2 consecutive misses.)
const MAX_MISSES = 2;

// How long the green "detected" dot flash lasts.
const DETECTED_FLASH_MS = 400;

export default function CameraView({ session, vision, ocr, onExit, onSessionChange }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(0);
  const lastVisionRef = useRef(0);
  const lastOcrRef = useRef(0);
  const visionBusyRef = useRef(false);
  const ocrBusyRef = useRef(false);
  const trackerRef = useRef(new OffFrameTracker());
  const frameIdRef = useRef(0);
  const stateRef = useRef({
    objects: [],
    ocrLines: [],
    ocrWords: [],
    matchedBox: null,
    arrow: null,
    fps: 0,
    lastDrawT: performance.now(),
    drawCount: 0,
    objectMisses: 0,
    ocrMisses: 0,
    detectedFlashUntil: 0
  });

  const [match, setMatch] = useState(null);
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState('Initializing camera…');
  const [ocrLoading, setOcrLoading] = useState(false);
  // 'idle' | 'processing' | 'detected'
  const [ocrStatus, setOcrStatus] = useState('idle');

  const { error, ready: camReady } = useCamera(videoRef);

  const threshold = THRESHOLDS[session.threshold] || THRESHOLDS.strict;
  const ocrMode = session.ocrMode || 'fast';

  // The user-facing percentage (Exact 100% / Strict 90% / Loose 70% /
  // Similar 50%) is the literal display gate — only matches whose confidence
  // meets or exceeds this percentage are surfaced in the match panel.
  const displayThreshold = threshold.pct / 100;

  // Push reference image into vision worker on mount.
  useEffect(() => {
    if (!vision) return;
    if (session.mode === 'reference' || session.mode === 'auto') {
      if (session.referenceImage?.blob) {
        imageDataFromBlob(session.referenceImage.blob, 256)
          .then((imageData) => {
            vision.postMessage({ type: 'setReference', imageData });
          })
          .catch(() => {});
      }
    } else {
      vision.postMessage({ type: 'clearReference' });
    }
  }, [vision, session.mode, session.referenceImage]);

  // Notify OCR worker when fast/accurate mode changes.
  const ocrModeInitialized = useRef(false);
  useEffect(() => {
    if (!ocr) return;
    if (!ocrModeInitialized.current) {
      ocrModeInitialized.current = true;
      if (ocrMode !== 'fast') {
        setOcrLoading(true);
        ocr.postMessage({ type: 'setMode', ocrMode });
      }
      return;
    }
    setOcrLoading(true);
    ocr.postMessage({ type: 'setMode', ocrMode });
  }, [ocr, ocrMode]);

  // Wire worker responses.
  useEffect(() => {
    if (!vision || !ocr) return;

    const onVision = (e) => {
      const m = e.data;
      if (m?.type !== 'detection') return;
      visionBusyRef.current = false;
      stateRef.current.objects = m.objects || [];
      handleVisionResult(m);
    };
    const onOcr = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.type === 'modeChanging') {
        setOcrLoading(true);
        ocrBusyRef.current = false;
        return;
      }
      if (m.type === 'ready') {
        setOcrLoading(false);
        return;
      }
      if (m.type !== 'ocr') return;
      ocrBusyRef.current = false;
      stateRef.current.ocrLines = m.lines || [];
      stateRef.current.ocrWords = m.words || [];
      // Any successfully read text triggers a brief green "detected" flash on
      // the HUD status dot. The dot drops back to processing / idle after the
      // flash window expires (see updateOcrStatus).
      if (stateRef.current.ocrWords.length > 0) {
        stateRef.current.detectedFlashUntil = performance.now() + DETECTED_FLASH_MS;
      }
      handleOcrResult(m);
    };

    vision.addEventListener('message', onVision);
    ocr.addEventListener('message', onOcr);
    return () => {
      vision.removeEventListener('message', onVision);
      ocr.removeEventListener('message', onOcr);
    };
  }, [vision, ocr, session, threshold]);

  // Main render loop.
  useEffect(() => {
    if (!camReady) return;
    setStatus('Scanning…');
    const loop = () => {
      animRef.current = requestAnimationFrame(loop);
      drawFrame();
      maybeDispatch();
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [camReady, session]);

  function handleVisionResult(m) {
    const wantObject = session.mode === 'object' || session.mode === 'auto';
    const wantReference = session.mode === 'reference';
    if (!wantObject && !wantReference) return;

    let best = null;

    if (wantObject) {
      const candidates = (m.objects || []).filter((o) => {
        if (m.targetClasses?.length && !o.classMatch) return false;
        return o.score >= displayThreshold;
      });
      candidates.sort((a, b) => b.score - a.score);
      const top = candidates[0];
      if (top) {
        best = {
          bbox: top.bbox,
          frameW: m.width,
          frameH: m.height,
          confidence: top.score,
          label: prettyLabel(top, m.targetColors),
          subtitle: 'Object detected',
          source: 'object'
        };
      }
    }

    if (wantReference && m.referenceMatch) {
      const r = m.referenceMatch;
      if (r.score >= displayThreshold) {
        const candidate = {
          bbox: r.bbox,
          frameW: m.width,
          frameH: m.height,
          confidence: r.score,
          label: 'Reference match',
          subtitle: `Color ${(r.colorScore * 100).toFixed(0)}% · Edges ${(r.edgeScore * 100).toFixed(0)}%`,
          source: 'reference'
        };
        if (!best || candidate.confidence > best.confidence) best = candidate;
      }
    }

    if (best) {
      stateRef.current.objectMisses = 0;
      stateRef.current.matchedBox = best;
      trackerRef.current.update(best.bbox);
      setMatch(best);
    } else {
      stateRef.current.objectMisses += 1;
      maybeClearStaleMatch();
    }
  }

  function handleOcrResult(m) {
    const wantOcr = session.mode === 'label' || session.mode === 'auto';
    if (!wantOcr) return;

    const hasMatch = m.match && m.match.confidence >= displayThreshold;
    if (hasMatch) {
      stateRef.current.detectedFlashUntil = performance.now() + DETECTED_FLASH_MS;
      const matchedBox = m.match.bbox
        ? {
            bbox: m.match.bbox,
            frameW: m.width,
            frameH: m.height,
            confidence: m.match.confidence,
            label: `“${m.match.text}”`,
            subtitle: 'Text matched',
            source: 'ocr'
          }
        : {
            bbox: null,
            frameW: m.width,
            frameH: m.height,
            confidence: m.match.confidence,
            label: `“${m.match.text}”`,
            subtitle: 'Text matched',
            source: 'ocr'
          };

      stateRef.current.ocrMisses = 0;
      const cur = stateRef.current.matchedBox;
      if (matchedBox.bbox && (!cur || matchedBox.confidence >= cur.confidence)) {
        stateRef.current.matchedBox = matchedBox;
        trackerRef.current.update(matchedBox.bbox);
      }
      setMatch((prev) => {
        if (!prev) return matchedBox;
        if (prev.source === 'ocr' || matchedBox.confidence > prev.confidence) return matchedBox;
        return prev;
      });
    } else {
      stateRef.current.ocrMisses += 1;
      maybeClearStaleMatch();
    }
  }

  // If the active source has missed for more than MAX_MISSES consecutive
  // scans, clear the match panel and the on-canvas matched box.
  function maybeClearStaleMatch() {
    setMatch((prev) => {
      if (!prev) return prev;
      const misses =
        prev.source === 'ocr'
          ? stateRef.current.ocrMisses
          : stateRef.current.objectMisses;
      if (misses > MAX_MISSES) {
        if (
          stateRef.current.matchedBox &&
          stateRef.current.matchedBox.source === prev.source
        ) {
          stateRef.current.matchedBox = null;
        }
        return null;
      }
      return prev;
    });
  }

  function prettyLabel(obj, targetColors) {
    const color = obj.dominantColor && targetColors?.length ? `${obj.dominantColor} ` : '';
    return `${color}${obj.class}`;
  }

  function maybeDispatch() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const now = performance.now();

    const wantVision =
      session.mode === 'object' ||
      session.mode === 'auto' ||
      session.mode === 'reference';
    const wantOcr = session.mode === 'label' || session.mode === 'auto';

    if (wantVision && !visionBusyRef.current && now - lastVisionRef.current > VISION_INTERVAL) {
      lastVisionRef.current = now;
      visionBusyRef.current = true;
      grabBitmap(video, 0.6).then((bm) => {
        if (!bm) { visionBusyRef.current = false; return; }
        vision.postMessage({
          type: 'detect',
          imageBitmap: bm,
          frameId: ++frameIdRef.current,
          mode: session.mode,
          target: session.target,
          threshold
        }, [bm]);
      });
    }

    const ocrInterval = ocrMode === 'accurate' ? OCR_INTERVAL_ACCURATE : OCR_INTERVAL_FAST;
    if (wantOcr && !ocrBusyRef.current && !ocrLoading && now - lastOcrRef.current > ocrInterval) {
      lastOcrRef.current = now;
      ocrBusyRef.current = true;
      setOcrStatus('processing');
      grabOcrBitmap(video, ocrMode).then((bm) => {
        if (!bm) { ocrBusyRef.current = false; return; }
        ocr.postMessage({
          type: 'recognize',
          imageBitmap: bm.bitmap,
          frameId: ++frameIdRef.current,
          target: session.target,
          mode: session.mode,
          threshold,
          cropOffsetX: bm.cropOffsetX,
          cropOffsetY: bm.cropOffsetY,
          bitmapScale: bm.bitmapScale,
          originalW: bm.originalW,
          originalH: bm.originalH,
          psm: ocrMode === 'accurate' ? '11' : '7'
        }, [bm.bitmap]);
      });
    }
  }

  async function grabBitmap(video, scale) {
    if (!video.videoWidth) return null;
    const w = Math.floor(video.videoWidth * scale);
    const h = Math.floor(video.videoHeight * scale);
    try {
      return await createImageBitmap(video, 0, 0, video.videoWidth, video.videoHeight, {
        resizeWidth: w,
        resizeHeight: h,
        resizeQuality: 'medium'
      });
    } catch {
      return null;
    }
  }

  async function grabOcrBitmap(video, mode) {
    if (!video.videoWidth) return null;
    const fullW = video.videoWidth;
    const fullH = video.videoHeight;

    if (mode === 'accurate') {
      const sw = Math.max(1, Math.floor(fullW * 0.75));
      const sh = Math.max(1, Math.floor(fullH * 0.75));
      try {
        const bm = await createImageBitmap(video, 0, 0, fullW, fullH, {
          resizeWidth: sw,
          resizeHeight: sh,
          resizeQuality: 'medium'
        });
        return {
          bitmap: bm,
          cropOffsetX: 0,
          cropOffsetY: 0,
          bitmapScale: fullW / sw,
          originalW: fullW,
          originalH: fullH
        };
      } catch { return null; }
    }

    // Fast mode: center crop.
    const cropW = Math.max(1, Math.floor(fullW * CROP_W_FRACTION));
    const cropH = Math.max(1, Math.floor(fullH * CROP_H_FRACTION));
    const cropX = Math.floor((fullW - cropW) / 2);
    const cropY = Math.floor((fullH - cropH) / 2);
    const targetW = Math.min(cropW, 720);
    const ratio = targetW / cropW;
    const targetH = Math.max(1, Math.floor(cropH * ratio));
    try {
      const bm = await createImageBitmap(video, cropX, cropY, cropW, cropH, {
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'medium'
      });
      return {
        bitmap: bm,
        cropOffsetX: cropX,
        cropOffsetY: cropY,
        bitmapScale: cropW / targetW,
        originalW: fullW,
        originalH: fullH
      };
    } catch { return null; }
  }

  // Translate ocrStatus driven by ocrBusyRef + recent detection flash on
  // each render-loop frame so the indicator reflects live activity.
  function updateOcrStatus(now) {
    const wantOcr = session.mode === 'label' || session.mode === 'auto';
    let next = 'idle';
    if (!wantOcr) {
      next = 'idle';
    } else if (now < stateRef.current.detectedFlashUntil) {
      next = 'detected';
    } else if (ocrBusyRef.current) {
      next = 'processing';
    }
    setOcrStatus((prev) => (prev === next ? prev : next));
  }

  function drawFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!video.videoWidth) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(cssW / vw, cssH / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (cssW - dw) / 2;
    const dy = (cssH - dh) / 2;
    const project = ([x, y, w, h], frameW, frameH) => {
      const fx = dx + (x / frameW) * dw;
      const fy = dy + (y / frameH) * dh;
      const fw = (w / frameW) * dw;
      const fh = (h / frameH) * dh;
      return [fx, fy, fw, fh];
    };

    const matched = stateRef.current.matchedBox;
    const wantOcr = session.mode === 'label' || session.mode === 'auto';
    const tNow = performance.now();

    // ─── Viewfinder scanning zone (Fast OCR only) ───
    let viewfinder = null;
    if (wantOcr && ocrMode === 'fast') {
      const vfFullW = vw * CROP_W_FRACTION;
      const vfFullH = vh * CROP_H_FRACTION;
      const vfFullX = (vw - vfFullW) / 2;
      const vfFullY = (vh - vfFullH) / 2;
      const [vx, vy, vwid, vhei] = project([vfFullX, vfFullY, vfFullW, vfFullH], vw, vh);
      viewfinder = { x: vx, y: vy, w: vwid, h: vhei };

      const radius = 20;
      ctx.save();
      // Outside-the-box dim, inside fully clear (even-odd fill).
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.rect(0, 0, cssW, cssH);
      tracePath(ctx, viewfinder.x, viewfinder.y, viewfinder.w, viewfinder.h, radius);
      ctx.fill('evenodd');

      // Border 2px solid white at 0.7 opacity.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      tracePath(ctx, viewfinder.x, viewfinder.y, viewfinder.w, viewfinder.h, radius);
      ctx.stroke();

      // L-shaped corner accents — bright white, 20px each, animated pulse.
      const cornerLen = 20;
      const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(tNow / 1000 * 2 * Math.PI));
      ctx.strokeStyle = `rgba(255, 255, 255, ${pulse})`;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      drawCornerBrackets(ctx, viewfinder, cornerLen);
      ctx.restore();
    }

    // ─── Live word rectangles (OCR feedback) ───
    if (wantOcr && stateRef.current.ocrWords.length) {
      ctx.save();
      ctx.fillStyle = 'rgba(41, 194, 255, 0.30)';
      for (const wd of stateRef.current.ocrWords.slice(0, 60)) {
        const [x, y, w, h] = project(wd.bbox, vw, vh);
        if (w < 4 || h < 4) continue;
        // Skip if it's the matched word (drawn in green below).
        if (matched && matched.bbox && sameBox(wd.bbox, matched.bbox)) continue;
        ctx.fillRect(x, y, w, h);
      }
      ctx.restore();
    }

    // ─── Object boxes (yellow) ───
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffcc33';
    ctx.fillStyle = 'rgba(255, 204, 51, 0.05)';
    for (const o of stateRef.current.objects.slice(0, 12)) {
      if (matched && sameBox(o.bbox, matched.bbox)) continue;
      const [x, y, w, h] = project(o.bbox, o.frameW || vw, o.frameH || vh);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#ffcc33';
      ctx.font = '600 12px -apple-system, system-ui, sans-serif';
      const label = `${o.class} ${(o.score * 100).toFixed(0)}%`;
      const tw = ctx.measureText(label).width + 8;
      ctx.fillRect(x, y - 18, tw, 16);
      ctx.fillStyle = '#1a1a00';
      ctx.fillText(label, x + 4, y - 6);
      ctx.fillStyle = 'rgba(255, 204, 51, 0.05)';
    }

    // ─── Matched box: pulsing green glow (1 Hz opacity pulse) ───
    if (matched && matched.bbox) {
      const phase = 0.5 + 0.5 * Math.sin(tNow / 1000 * 2 * Math.PI);
      const fillAlpha = 0.10 + 0.18 * phase;
      const strokeAlpha = 0.65 + 0.35 * phase;
      const [x, y, w, h] = project(matched.bbox, matched.frameW || vw, matched.frameH || vh);
      ctx.save();
      ctx.shadowColor = '#39ff88';
      ctx.shadowBlur = 18 + phase * 22;
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(57, 255, 136, ${strokeAlpha})`;
      ctx.fillStyle = `rgba(57, 255, 136, ${fillAlpha})`;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
      // Label badge (no pulse).
      ctx.fillStyle = '#39ff88';
      ctx.font = '700 13px -apple-system, system-ui, sans-serif';
      const label = `${matched.label} ${(matched.confidence * 100).toFixed(0)}%`;
      const tw = ctx.measureText(label).width + 10;
      ctx.fillRect(x, y - 22, tw, 20);
      ctx.fillStyle = '#04130a';
      ctx.fillText(label, x + 5, y - 8);
    }

    // Off-frame arrow (only when no on-frame match drawn this frame).
    if (!matched) {
      const arrow = trackerRef.current.getArrow(cssW, cssH);
      stateRef.current.arrow = arrow;
    } else {
      stateRef.current.arrow = null;
    }

    // FPS sampling
    stateRef.current.drawCount++;
    if (tNow - stateRef.current.lastDrawT > 500) {
      const f = (stateRef.current.drawCount * 1000) / (tNow - stateRef.current.lastDrawT);
      stateRef.current.lastDrawT = tNow;
      stateRef.current.drawCount = 0;
      setFps(Math.round(f));
    }

    // Update OCR status indicator on the HUD.
    updateOcrStatus(tNow);
  }

  function sameBox(a, b) {
    if (!a || !b) return false;
    return Math.abs(a[0] - b[0]) < 2 && Math.abs(a[1] - b[1]) < 2;
  }

  const arrow = stateRef.current.arrow;

  const toggleOcrMode = () => {
    if (ocrLoading) return;
    const next = ocrMode === 'fast' ? 'accurate' : 'fast';
    onSessionChange?.((s) => ({ ...s, ocrMode: next }));
  };

  return (
    <div className="camera">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} className="overlay" />

      <HUD
        session={session}
        onExit={onExit}
        locked={!!match}
        ocrMode={ocrMode}
        ocrLoading={ocrLoading}
        ocrStatus={ocrStatus}
        onToggleOcrMode={toggleOcrMode}
        showOcrToggle={session.mode === 'label' || session.mode === 'auto'}
      />

      {error && <div className="error-banner">{error}</div>}
      {!error && !camReady && <div className="status-toast">{status}</div>}
      {camReady && !match && ocrLoading && (
        <div className="status-toast">Switching OCR engine…</div>
      )}
      {camReady && !match && !ocrLoading && (
        <div className="status-toast">
          {(session.mode === 'label' || session.mode === 'auto') && ocrMode === 'fast'
            ? 'Center the label in the box'
            : 'Point camera at the scene'}
        </div>
      )}

      <div className="fps">{fps} fps</div>

      {arrow && (
        <div
          className="arrow"
          style={{ left: arrow.x - 18, top: arrow.y - 18, width: 36, height: 36 }}
          aria-hidden
        >
          {arrow.dir}
        </div>
      )}

      <MatchSheet
        match={match}
        onResume={() => setMatch(null)}
        onDone={onExit}
      />
    </div>
  );
}

function tracePath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
  }
}

function drawCornerBrackets(ctx, vf, len) {
  const { x, y, w, h } = vf;
  ctx.beginPath();
  // Top-left
  ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  // Top-right
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  // Bottom-right
  ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
  // Bottom-left
  ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
  ctx.stroke();
}
