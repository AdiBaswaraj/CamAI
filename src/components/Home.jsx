import { useRef } from 'react';
import PrivacyBadge from './PrivacyBadge.jsx';
import ModeSelector from './ModeSelector.jsx';
import ThresholdButtons from './ThresholdButtons.jsx';
import { blobToDataURL } from '../utils/imageData.js';

export default function Home({ session, onChange, onStart, modelsReady }) {
  const fileRef = useRef(null);

  const update = (patch) => onChange((s) => ({ ...s, ...patch }));

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = await blobToDataURL(f);
    update({ referenceImage: { name: f.name, dataUrl: url, blob: f } });
  };

  const placeholderForMode = (mode) => {
    switch (mode) {
      case 'object': return 'e.g. blue tie, red car, white mug';
      case 'label': return 'e.g. Johnnie Walker Black';
      case 'reference': return 'optional caption (or leave empty)';
      case 'auto': return 'e.g. blue Hendricks gin bottle';
    }
  };

  const canStart =
    modelsReady &&
    (session.mode === 'reference'
      ? !!session.referenceImage
      : session.target.trim().length > 0);

  return (
    <div className="home">
      <div className="home-header">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div className="brand-name">ScoutAI</div>
        </div>
        <PrivacyBadge />
      </div>

      <div className="section">
        <div className="label">What are you looking for?</div>
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={placeholderForMode(session.mode)}
          value={session.target}
          onChange={(e) => update({ target: e.target.value })}
        />
      </div>

      <div className="section">
        <div className="label">Mode</div>
        <ModeSelector
          value={session.mode}
          onChange={(mode) => update({ mode })}
        />
      </div>

      <div className="section">
        <div className="label">Match threshold</div>
        <ThresholdButtons
          value={session.threshold}
          onChange={(threshold) => update({ threshold })}
        />
      </div>

      {(session.mode === 'reference' || session.mode === 'auto') && (
        <div className="section">
          <div className="label">Reference photo {session.mode === 'reference' ? '(required)' : '(optional)'}</div>
          <div className="upload">
            <div
              className="upload-thumb"
              style={{
                backgroundImage: session.referenceImage
                  ? `url(${session.referenceImage.dataUrl})`
                  : 'none'
              }}
            />
            <div className="upload-actions">
              <div className="name">
                {session.referenceImage?.name || 'No image selected'}
              </div>
              <div className="upload-buttons">
                <button onClick={() => fileRef.current?.click()}>
                  {session.referenceImage ? 'Replace' : 'Upload'}
                </button>
                {session.referenceImage && (
                  <button
                    className="ghost"
                    onClick={() => update({ referenceImage: null })}
                  >
                    Clear
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleFile}
              />
            </div>
          </div>
        </div>
      )}

      <button
        className="primary start-btn"
        disabled={!canStart}
        onClick={() => onStart(session)}
      >
        {modelsReady ? 'Start Scanning' : 'Loading models…'}
      </button>

      <div className="tip">
        Models cache after first load. Works offline. No data leaves your device.
      </div>
    </div>
  );
}
