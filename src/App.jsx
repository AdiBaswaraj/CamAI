import { useEffect, useState } from 'react';
import Home from './components/Home.jsx';
import CameraView from './components/CameraView.jsx';
import ProgressBar from './components/ProgressBar.jsx';
import { useWorkers } from './hooks/useWorkers.js';
import './App.css';

const STORAGE_KEY = 'scoutai.session.v1';

export default function App() {
  const [screen, setScreen] = useState('home');
  const [session, setSession] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      mode: 'object',
      target: '',
      threshold: 'strict',
      ocrMode: 'fast',
      referenceImage: null
    };
  });

  const { ready, progress, vision, ocr } = useWorkers();

  useEffect(() => {
    try {
      const { referenceImage, ...rest } = session;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch {}
  }, [session]);

  const startScan = (config) => {
    setSession((s) => ({ ...s, ...config }));
    setScreen('camera');
  };

  const stopScan = () => setScreen('home');

  return (
    <div className="app">
      {!ready && progress.show && (
        <ProgressBar
          label={progress.label}
          value={progress.value}
        />
      )}

      {screen === 'home' && (
        <Home
          session={session}
          onChange={setSession}
          onStart={startScan}
          modelsReady={ready}
        />
      )}

      {screen === 'camera' && (
        <CameraView
          session={session}
          vision={vision}
          ocr={ocr}
          onExit={stopScan}
          onSessionChange={setSession}
        />
      )}
    </div>
  );
}
