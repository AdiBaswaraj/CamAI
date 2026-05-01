export default function MatchSheet({ match, onResume, onDone }) {
  const open = !!match;
  return (
    <div className={`sheet ${open ? 'open' : ''}`}>
      <div className="sheet-handle" />
      <div className="sheet-title">
        <span className="sheet-badge">✓ MATCH</span>
      </div>
      <h2>{match?.label || ''}</h2>
      <div className="sheet-meta">
        <span>{match?.subtitle || ''}</span>
        <span>{match ? `${Math.round(match.confidence * 100)}% confidence` : ''}</span>
      </div>
      <div className="sheet-actions">
        <button onClick={onResume}>Keep Scanning</button>
        <button className="primary" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
