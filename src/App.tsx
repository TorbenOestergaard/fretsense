import { useCallback, useEffect, useState } from 'react';
import { mic } from './audio/mic';
import { progressStore } from './game/progress';
import { sync } from './sync/sync';
import { About } from './ui/About';
import { Account } from './ui/Account';
import { Game, type RoundSummary } from './ui/Game';
import { Home } from './ui/Home';
import { MicCheck } from './ui/MicCheck';
import { Progress } from './ui/Progress';
import { ROUTE_TITLES, hrefOf, parseRoute, type Route } from './ui/route';
import { SiteNav } from './ui/SiteNav';
import { Summary } from './ui/Summary';

/** What `#/round` shows. It lives in memory only: after a reload there is no round to show. */
type Round = { kind: 'game'; id: number } | { kind: 'summary'; summary: RoundSummary };

/** Marks the history entry that starting a round added, so that quitting can step back over it. */
const ROUND_ENTRY = 'fretsense-round';

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash) ?? 'practice');
  const [round, setRound] = useState<Round | null>(null);

  useEffect(() => {
    mic.setSensitivity(progressStore.get().settings.sensitivity);
  }, []);

  // The address is the source of truth for the page: links, typed addresses, back and forward
  // all arrive here.
  useEffect(() => {
    const read = () => {
      const next = parseRoute(location.hash);
      if (!next) history.replaceState(null, '', hrefOf('practice'));
      setRoute(next ?? 'practice');
    };
    read();
    window.addEventListener('hashchange', read);
    window.addEventListener('popstate', read);
    return () => {
      window.removeEventListener('hashchange', read);
      window.removeEventListener('popstate', read);
    };
  }, []);

  // `#/round` without a round (reload, bookmark, forward after quitting) is the Practice page.
  const page: Route = route === 'round' && !round ? 'practice' : route;
  useEffect(() => {
    if (route === 'round' && !round) {
      history.replaceState(null, '', hrefOf('practice'));
      setRoute('practice');
    }
    // Leaving a round by any route, the back button included, ends it, the same as Quit.
    // Answers are recorded as they are given, so nothing is lost. A finished round's summary
    // is kept, so going forward again shows it.
    if (route !== 'round' && round?.kind === 'game') setRound(null);
  }, [route, round]);

  useEffect(() => {
    const title = page === 'round' && round?.kind === 'summary' ? 'Round complete' : ROUTE_TITLES[page];
    document.title = page === 'practice' ? 'Fretsense' : `${title} · Fretsense`;
  }, [page, round]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [page]);

  const start = useCallback(async () => {
    // Asking for the microphone here keeps the permission prompt tied to the button press.
    // If it is refused the round still starts, with clicking the fretboard as the fallback.
    if (mic.getState().status !== 'running') await mic.start(progressStore.get().settings.deviceId);
    setRound({ kind: 'game', id: Date.now() });
    if (parseRoute(location.hash) !== 'round') history.pushState(ROUND_ENTRY, '', hrefOf('round'));
    setRoute('round');
  }, []);

  const quit = useCallback(() => {
    // Step back over the entry that starting the round added, so that Back does not lead into
    // the round again. The effect above then ends the round.
    if (history.state === ROUND_ENTRY) history.back();
    else {
      history.replaceState(null, '', hrefOf('practice'));
      setRoute('practice');
    }
  }, []);

  if (page === 'round' && round?.kind === 'game') {
    return (
      <div className="page">
        <Game
          key={round.id}
          onDone={(summary) => {
            sync.requestSync();
            setRound({ kind: 'summary', summary });
          }}
          onQuit={quit}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <SiteNav current={page} />
      {page === 'round' && round?.kind === 'summary' && <Summary summary={round.summary} onAgain={() => void start()} />}
      {page === 'practice' && <Home onStart={() => void start()} />}
      {page === 'progress' && <Progress />}
      {page === 'mic' && <MicCheck />}
      {page === 'account' && <Account />}
      {page === 'about' && <About />}
      <footer className="app-foot muted small">
        Fretsense {__APP_VERSION__}
        {__APP_COMMIT__ && ` · ${__APP_COMMIT__}`} · <a href={hrefOf('about')}>About</a>
      </footer>
    </div>
  );
}
