import { THRESHOLDS } from '../utils/thresholdMap.js';

const MODE_LABEL = {
  object: 'Object Hunt',
  label: 'Label Hunt',
  reference: 'Reference',
  auto: 'Auto / Hybrid'
};

export default function HUD({
  session,
  onExit,
  locked,
  ocrMode,
  ocrLoading,
  showOcrToggle,
  onToggleOcrMode
}) {
  const t = THRESHOLDS[session.threshold];
  const target = session.mode === 'reference' && !session.target
    ? (session.referenceImage?.name || 'Reference image')
    : session.target;
  return (
    <div className="hud">
      <button className="hud-back" onClick={onExit} aria-label="Back">←</button>
      <div className="hud-info">
        <div className="hud-target">{target || 'Scanning…'}</div>
        <div className="hud-meta">
          <span className="hud-pill">{MODE_LABEL[session.mode]}</span>
          <span className="hud-pill">{t.label} · {t.pct}%</span>
          <span className="hud-pill lock">🔒 ON-DEVICE</span>
          {locked && <span className="hud-pill lock">LOCKED</span>}
        </div>
      </div>
      {showOcrToggle && (
        <button
          className={`hud-toggle ${ocrMode === 'fast' ? 'is-fast' : 'is-accurate'} ${ocrLoading ? 'is-loading' : ''}`}
          onClick={onToggleOcrMode}
          disabled={ocrLoading}
          aria-label="Toggle OCR engine"
        >
          {ocrLoading ? '…' : (ocrMode === 'fast' ? 'Fast' : 'Accurate')}
        </button>
      )}
    </div>
  );
}
