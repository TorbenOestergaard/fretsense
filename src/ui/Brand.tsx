import { hrefOf } from './route';

/**
 * The logo at the top left of every screen. It is a link to the Practice page; during a round
 * it is given `onQuit` instead and leaves the round the same way the Quit button does.
 */
export function Brand({ onQuit }: { onQuit?: () => void }) {
  const mark = <span className="brand-mark" aria-hidden="true" />;
  return (
    <div className="brand">
      {onQuit ? (
        <button className="brand-home" onClick={onQuit} title="Quit the round and go back to Practice">
          {mark}
          <span className="brand-name">Fretsense</span>
        </button>
      ) : (
        <a className="brand-home" href={hrefOf('practice')} onClick={() => window.scrollTo({ top: 0 })} title="Practice">
          {mark}
          <span className="brand-name">Fretsense</span>
        </a>
      )}
    </div>
  );
}
