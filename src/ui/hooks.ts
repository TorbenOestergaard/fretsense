import { useEffect, useState, useSyncExternalStore } from 'react';
import { mic, type MicState } from '../audio/mic';
import type { Frame } from '../audio/pitch';
import { progressStore, type ProgressData } from '../game/progress';
import { sync, type SyncState } from '../sync/sync';

export function useProgress(): ProgressData {
  return useSyncExternalStore(progressStore.subscribe, progressStore.get);
}

export function useSync(): SyncState {
  return useSyncExternalStore(sync.subscribe, sync.getState);
}

export function useMicState(): MicState {
  return useSyncExternalStore(mic.subscribe, mic.getState);
}

/** Latest audio frame, re-rendering at most once per animation frame. */
export function useFrame(): Frame | null {
  const [frame, setFrame] = useState<Frame | null>(mic.lastFrame);
  useEffect(() => {
    let latest: Frame | null = null;
    let raf = 0;
    const off = mic.onFrame((f) => {
      latest = f;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setFrame(latest);
        });
      }
    });
    return () => {
      off();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return frame;
}

/** Maps a linear level to 0..1 on a -72..-12 dBFS scale for meters. */
export function levelToUnit(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 72) / 60));
}
