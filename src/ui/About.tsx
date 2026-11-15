import { useSync } from './hooks';
import { hrefOf } from './route';

export const REPO_URL = 'https://github.com/TorbenOestergaard/fretsense';

const outside = { target: '_blank', rel: 'noopener noreferrer' } as const;

export function About() {
  const sync = useSync();
  return (
    <main className="page-body">
      <section className="panel prose">
        <h1>About Fretsense</h1>
        <p>
          Fretsense is a fretboard memorisation trainer that listens to your guitar. It asks for a note, you play it on the real instrument, and the
          microphone checks it, with no cable or audio interface. Three exercises (String sweep, Note finder and Scale positions) each keep their own
          statistics and bring back the notes you are slow on.
        </p>
      </section>

      <section className="panel prose">
        <h2>What is stored, and where</h2>
        <ul className="tips">
          <li>Your progress and settings are stored in this browser. Without an account nothing leaves it.</li>
          <li>The microphone sound is analysed on your computer. It is not recorded and not sent anywhere.</li>
          <li>
            {sync.available ? (
              <>
                Optional: with an <a href={hrefOf('account')}>account</a>, a copy of your practice record is kept on the server ({sync.label}) so it
                follows you between browsers. You can delete it there at any time.
              </>
            ) : (
              <>This copy of the app has no sync server, so there is no account to sign in to.</>
            )}
          </li>
          <li>No analytics, no cookies, no ads, no third-party scripts.</li>
        </ul>
      </section>

      <section className="panel prose">
        <h2>Version, source and feedback</h2>
        <p>
          Version <b>{__APP_VERSION__}</b>
          {__APP_COMMIT__ && (
            <>
              , commit{' '}
              <a href={`${REPO_URL}/commit/${__APP_COMMIT__}`} {...outside}>
                {__APP_COMMIT__}
              </a>
            </>
          )}
          .
        </p>
        <p>
          The source code is on GitHub:{' '}
          <a href={REPO_URL} {...outside}>
            TorbenOestergaard/fretsense
          </a>
          , under the MIT licence.
        </p>
        <p>
          Found a bug, or have an idea? Open an issue in the{' '}
          <a href={`${REPO_URL}/issues`} {...outside}>
            repository’s issues
          </a>
          .
        </p>
      </section>
    </main>
  );
}
