import { useState, type FormEvent } from 'react';
import { sync, type SyncState } from '../sync/sync';
import { useSync } from './hooks';

function ago(t: number, now: number): string {
  const min = Math.round((now - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(t).toLocaleDateString();
}

/** One line for the status of sync, used on the home screen and in the account section. */
export function syncStatus(state: SyncState, now: number): { text: string; tone: 'ok' | 'off' | 'none' } {
  if (!state.available) return { text: 'Progress is stored in this browser only.', tone: 'none' };
  if (!state.user) return { text: 'Sync off: not signed in. Progress is stored in this browser only.', tone: 'none' };
  const last = state.lastSynced ? `Last synced ${ago(state.lastSynced, now)}.` : 'Not synced yet.';
  if (state.phase === 'syncing') return { text: 'Syncing…', tone: 'ok' };
  if (state.phase === 'off') return { text: `Sync off: ${state.problem ?? 'something went wrong.'} ${last} Practice is saved in this browser.`, tone: 'off' };
  return { text: `Synced. ${last}`, tone: 'ok' };
}

const keepLocal = () =>
  confirm(
    'This browser holds progress that was synced to a different account.\n\nOK: add it to the account you are signing in to.\nCancel: replace it with that account’s progress.',
  );

export function Account({ onBack }: { onBack: () => void }) {
  const state = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const status = syncStatus(state, Date.now());

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await action();
      if (text) setMessage({ text, bad: false });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Something went wrong.', bad: true });
    } finally {
      setBusy(false);
    }
  };

  const signIn = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await sync.signIn(email.trim(), password, keepLocal);
      setPassword('');
    });
  };
  const signUp = () =>
    void run(async () => {
      const ready = await sync.signUp(email.trim(), password, keepLocal);
      setPassword('');
      if (!ready) return 'Account created. Confirm your email address (check your inbox), then sign in here.';
    });
  const remove = () => {
    if (!confirm('Delete your account and the copy of your progress on the server?\n\nThe progress in this browser stays. The account is also your sign-in for any other app that shares this backend. This cannot be undone.')) return;
    void run(async () =>
      (await sync.deleteAccount())
        ? 'Your account and synced progress have been deleted.'
        : 'Your synced progress has been deleted and you are signed out. The account itself could not be removed from here; ask the site owner to remove it.',
    );
  };

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Account and sync
        </div>
        <button className="ghost" onClick={onBack}>
          Back to practice
        </button>
      </header>

      <section className="panel">
        {!state.available ? (
          <>
            <h2>Sync is not set up</h2>
            <p className="muted">This copy of the app has no sync server. Your progress is stored in this browser, and you can back it up to a file from the Progress page.</p>
          </>
        ) : state.user ? (
          <>
            <h2>Signed in{state.user.email ? ` as ${state.user.email}` : ''}</h2>
            <p className={status.tone === 'off' ? 'warn' : 'muted'} role="status">
              {status.text}
            </p>
            <div className="start-row">
              <button onClick={() => void run(() => sync.syncNow())} disabled={busy || state.phase === 'syncing'}>
                Sync now
              </button>
              <button className="ghost" onClick={() => void run(() => sync.signOut())} disabled={busy}>
                Sign out
              </button>
            </div>
            <p className="muted small account-note">Signing out leaves the progress in this browser as it is.</p>
          </>
        ) : (
          <>
            <h2>Sign in to sync</h2>
            <p className="muted">
              Optional. With an account, your progress follows you between browsers and computers. The first sign-in uploads what is in this browser; signing in
              somewhere else merges, so nothing is lost on either side.
            </p>
            <form className="account-form" onSubmit={signIn}>
              <label>
                <span className="option-label">Email</span>
                <input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label>
                <span className="option-label">Password</span>
                <input type="password" name="password" autoComplete="current-password" required minLength={9} value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <div className="start-row">
                <button className="primary" type="submit" disabled={busy}>
                  Sign in
                </button>
                <button type="button" onClick={signUp} disabled={busy || !email.trim() || password.length < 9}>
                  Create account
                </button>
              </div>
              <p className="muted small account-note">Passwords need at least 9 characters. There is no “forgot password” email, so keep it in a password manager.</p>
            </form>
          </>
        )}
        {message && (
          <p className={message.bad ? 'warn' : 'good'} role="status">
            {message.text}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Privacy</h2>
        <ul className="tips">
          <li>Without an account nothing leaves this browser. The microphone sound is analysed on your computer and never sent anywhere.</li>
          <li>
            With an account, the server stores your email address, a scrambled (hashed) password, and your practice record: which notes you were asked, how fast
            you answered, XP, and exercise settings. Nothing else.
          </li>
          <li>{state.available ? `The server is ${state.label}, in the EU.` : 'No server is configured.'} No analytics, no ads, no tracking cookies, no third-party scripts.</li>
          <li>Only you can read or change your record. You can delete the account and the server copy at any time, below.</li>
        </ul>
        {state.user && (
          <button className="ghost danger" onClick={remove} disabled={busy}>
            Delete account and synced progress
          </button>
        )}
      </section>
    </main>
  );
}
