import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { mic } from './audio/mic';
import './styles.css';

// With ?debug in the URL, expose the audio engine so the whole chain can be driven with
// synthesised plucks from the console: fretsense.mic.startSynth(), then fretsense.mic.pluck(48).
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { fretsense: unknown }).fretsense = { mic };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
