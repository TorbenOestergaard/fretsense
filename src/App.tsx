import { useCallback, useEffect, useState } from 'react';
import { mic } from './audio/mic';
import { progressStore } from './game/progress';
import { Game, type RoundSummary } from './ui/Game';
import { Home } from './ui/Home';
import { MicCheck } from './ui/MicCheck';
import { Summary } from './ui/Summary';

type View = { name: 'home' } | { name: 'mic' } | { name: 'game'; id: number } | { name: 'summary'; summary: RoundSummary };

export function App() {
  const [view, setView] = useState<View>({ name: 'home' });

  useEffect(() => {
    mic.setSensitivity(progressStore.get().settings.sensitivity);
  }, []);

  const start = useCallback(async () => {
    // Asking for the microphone here keeps the permission prompt tied to the button press.
    // If it is refused the round still starts, with clicking the fretboard as the fallback.
    if (mic.getState().status !== 'running') await mic.start(progressStore.get().settings.deviceId);
    setView({ name: 'game', id: Date.now() });
  }, []);
  const home = useCallback(() => setView({ name: 'home' }), []);

  switch (view.name) {
    case 'home':
      return <Home onStart={() => void start()} onMic={() => setView({ name: 'mic' })} />;
    case 'mic':
      return <MicCheck onBack={home} />;
    case 'game':
      return <Game key={view.id} onDone={(summary) => setView({ name: 'summary', summary })} onQuit={home} />;
    case 'summary':
      return <Summary summary={view.summary} onAgain={() => void start()} onHome={home} />;
  }
}
