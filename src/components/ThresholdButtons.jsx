import { THRESHOLD_KEYS, THRESHOLDS } from '../utils/thresholdMap.js';

export default function ThresholdButtons({ value, onChange }) {
  return (
    <div className="threshold-row">
      {THRESHOLD_KEYS.map((k) => {
        const t = THRESHOLDS[k];
        return (
          <button
            key={k}
            className={`threshold ${value === k ? 'active' : ''}`}
            onClick={() => onChange(k)}
          >
            <span>{t.label}</span>
            <span className="pct">{t.pct}%</span>
          </button>
        );
      })}
    </div>
  );
}
