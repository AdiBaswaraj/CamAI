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
  ocrStatus,
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
          <span className="hud-pill pill-mode">{MODE_LABEL[session.mode]}</span>
          <span className="hud-pill pill-thresh">{t.label} · {t.pct}%</span>
          <span className="hud-pill lock pill-privacy">
            🔒 ON-DEVICE
            {showOcrToggle && (
              <span
                className={`status-dot ${ocrStatus || 'idle'}`}
                aria-label={`OCR ${ocrStatus || 'idle'}`}
              />
            )}
          </span>
          <span className={`hud-pill pill-locked ${locked ? 'is-on' : ''}`}>LOCKED</span>
        </div>
      </div>
      {showOcrToggle && (
        <button
          className={`hud-toggle ${ocrMode === 'fast' ? 'is-fast' : 'is-accurate'} ${ocrLoading ? 'is-loading' : ''}`}
          onClick={onToggleOcrMode}
          disabled={ocrLoading}
          aria-label="Toggle OCR engine"
        >
          {ocrLoading ? '…' : (ocrMode === 'fast' ? '⚡ Fast' : '🎯 Accurate')}
        </button>
      )}
    </div>
  );
}
