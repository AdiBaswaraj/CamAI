import { useEffect, useRef, useState } from 'react';
import HUD from './HUD.jsx';
import MatchSheet from './MatchSheet.jsx';
import { useCamera } from '../hooks/useCamera.js';
import { OffFrameTracker } from '../utils/tracking.js';
import { THRESHOLDS } from '../utils/thresholdMap.js';
import { imageDataFromBlob } from '../utils/imageData.js';

const VISION_INTERVAL = 250; // ms between TF.js detections
const OCR_INTERVAL = 1200;   // ms between OCR passes

export default function CameraView({ session, vision, ocr, onExit }) {
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
    matchedBox: null,
    arrow: null,
    fps: 0,
    lastDrawT: performance.now(),
    drawCount: 0
  });

  const [match, setMatch] = useState(null);
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState('Initializing camera…');
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const { error, ready: camReady } = useCamera(videoRef);

  const threshold = THRESHOLDS[session.threshold] || THRESHOLDS.strict;

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
      if (m?.type !== 'ocr') return;
      ocrBusyRef.current = false;
      stateRef.current.ocrLines = m.lines || [];
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
  }, [camReady, session, paused]);

  function handleVisionResult(m) {
    const wantObject = session.mode === 'object' || session.mode === 'auto';
    const wantReference = session.mode === 'reference';

    let best = null;

    if (wantObject) {
      const candidates = (m.objects || []).filter((o) => {
        if (m.targetClasses?.length && !o.classMatch) return false;
        return o.score >= threshold.conf;
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
          subtitle: 'Object detected'
        };
      }
    }

    if (wantReference && m.referenceMatch) {
      const r = m.referenceMatch;
      if (r.score >= threshold.color) {
        const candidate = {
          bbox: r.bbox,
          frameW: m.width,
          frameH: m.height,
          confidence: r.score,
          label: 'Reference match',
          subtitle: `Color ${(r.colorScore * 100).toFixed(0)}% · Edges ${(r.edgeScore * 100).toFixed(0)}%`
        };
        if (!best || candidate.confidence > best.confidence) best = candidate;
      }
    }

    if (best) {
      stateRef.current.matchedBox = best;
      trackerRef.current.update(best.bbox);
      maybeRaiseMatch(best);
    } else {
      stateRef.current.matchedBox = null;
    }
  }

  function handleOcrResult(m) {
    if (session.mode !== 'label' && session.mode !== 'auto') return;
    if (!m.match) return;
    if (m.match.confidence < threshold.conf) return;

    const matchedBox = m.match.bbox
      ? {
          bbox: m.match.bbox,
          frameW: m.width,
          frameH: m.height,
          confidence: m.match.confidence,
          label: `“${m.match.text}”`,
          subtitle: 'Text matched'
        }
      : null;

    if (matchedBox) {
      // Override only if no stronger object match already.
      const cur = stateRef.current.matchedBox;
      if (!cur || matchedBox.confidence > cur.confidence) {
        stateRef.current.matchedBox = matchedBox;
        trackerRef.current.update(matchedBox.bbox);
      }
      maybeRaiseMatch(matchedBox);
    } else {
      maybeRaiseMatch({
        bbox: null,
        frameW: m.width,
        frameH: m.height,
        confidence: m.match.confidence,
        label: `“${m.match.text}”`,
        subtitle: 'Text matched'
      });
    }
  }

  function prettyLabel(obj, targetColors) {
    const color = obj.dominantColor && targetColors?.length ? `${obj.dominantColor} ` : '';
    return `${color}${obj.class}`;
  }

  function maybeRaiseMatch(box) {
    if (pausedRef.current) return;
    setMatch((prev) => {
      if (prev && prev.confidence >= box.confidence) return prev;
      return box;
    });
    setPaused(true);
  }

  function maybeDispatch() {
    if (pausedRef.current) return;
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

    if (wantOcr && !ocrBusyRef.current && now - lastOcrRef.current > OCR_INTERVAL) {
      lastOcrRef.current = now;
      ocrBusyRef.current = true;
      grabBitmap(video, 0.75).then((bm) => {
        if (!bm) { ocrBusyRef.current = false; return; }
        ocr.postMessage({
          type: 'recognize',
          imageBitmap: bm,
          frameId: ++frameIdRef.current,
          target: session.target,
          mode: session.mode,
          threshold
        }, [bm]);
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

    // Compute the projection (object-fit: cover) from video → canvas.
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

    // OCR text bboxes (blue).
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#29c2ff';
    ctx.fillStyle = 'rgba(41, 194, 255, 0.08)';
    for (const ln of stateRef.current.ocrLines.slice(0, 12)) {
      const [x, y, w, h] = project(ln.bbox, ln.frameW || vw, ln.frameH || vh);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }

    // Object boxes (yellow).
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

    // Matched box (green glow).
    if (matched && matched.bbox) {
      const [x, y, w, h] = project(matched.bbox, matched.frameW || vw, matched.frameH || vh);
      ctx.save();
      ctx.shadowColor = '#39ff88';
      ctx.shadowBlur = 30;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#39ff88';
      ctx.fillStyle = 'rgba(57, 255, 136, 0.12)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
      ctx.fillStyle = '#39ff88';
      ctx.font = '700 13px -apple-system, system-ui, sans-serif';
      const label = `${matched.label} ${(matched.confidence * 100).toFixed(0)}%`;
      const tw = ctx.measureText(label).width + 10;
      ctx.fillRect(x, y - 22, tw, 20);
      ctx.fillStyle = '#04130a';
      ctx.fillText(label, x + 5, y - 8);
    }

    // Off-frame arrow (only when no match drawn this frame and tracker has data)
    if (!matched) {
      const arrow = trackerRef.current.getArrow(cssW, cssH);
      stateRef.current.arrow = arrow;
    } else {
      stateRef.current.arrow = null;
    }

    // FPS sampling
    stateRef.current.drawCount++;
    const now = performance.now();
    if (now - stateRef.current.lastDrawT > 500) {
      const f = (stateRef.current.drawCount * 1000) / (now - stateRef.current.lastDrawT);
      stateRef.current.lastDrawT = now;
      stateRef.current.drawCount = 0;
      setFps(Math.round(f));
    }
  }

  function sameBox(a, b) {
    if (!a || !b) return false;
    return Math.abs(a[0] - b[0]) < 2 && Math.abs(a[1] - b[1]) < 2;
  }

  const arrow = stateRef.current.arrow;

  return (
    <div className="camera">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} className="overlay" />

      <HUD
        session={session}
        onExit={onExit}
        locked={!!match}
      />

      {error && <div className="error-banner">{error}</div>}
      {!error && !camReady && <div className="status-toast">{status}</div>}
      {camReady && !match && <div className="status-toast">Point camera at the scene</div>}

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
        onResume={() => {
          setMatch(null);
          setPaused(false);
        }}
        onDone={onExit}
      />
    </div>
  );
}
