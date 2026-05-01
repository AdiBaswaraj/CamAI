const MODES = [
  { key: 'object', label: 'Object', sub: 'COCO + color' },
  { key: 'label', label: 'Label', sub: 'OCR text' },
  { key: 'reference', label: 'Reference', sub: 'Photo match' },
  { key: 'auto', label: 'Auto', sub: 'Hybrid' }
];

export default function ModeSelector({ value, onChange }) {
  return (
    <div className="tab-row">
      {MODES.map((m) => (
        <button
          key={m.key}
          className={`tab ${value === m.key ? 'active' : ''}`}
          onClick={() => onChange(m.key)}
        >
          <div>{m.label}</div>
          <div style={{ fontSize: 10, marginTop: 2, opacity: 0.7 }}>{m.sub}</div>
        </button>
      ))}
    </div>
  );
}
