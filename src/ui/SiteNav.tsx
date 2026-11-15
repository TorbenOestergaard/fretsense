import { DAILY_GOAL, dayKey, levelInfo, pointsOf, streakOf } from '../game/progress';
import { syncStatus } from './Account';
import { Brand } from './Brand';
import { useProgress, useSync } from './hooks';
import { ROUTE_TITLES, hrefOf, type Route } from './route';

const PAGES: Route[] = ['practice', 'progress', 'mic', 'about'];

/**
 * The navigation at the top of every page outside a round: the logo, the pages, the level,
 * streak and today figures, and the account with its sync status.
 */
export function SiteNav({ current }: { current: Route }) {
  const data = useProgress();
  const syncState = useSync();
  const now = Date.now();
  const points = pointsOf(data);
  const level = levelInfo(points.total);
  const today = data.days[dayKey(now)]?.correct ?? 0;
  const streak = streakOf(data.days, now);

  const status = syncStatus(syncState, now);
  // Short form of the sync status; the full sentence is the tooltip and is on the account page.
  let account: { text: string; tone: 'ok' | 'off' | 'none' };
  if (!syncState.available) account = { text: 'Local only', tone: 'none' };
  else if (!syncState.user) account = { text: 'Sign in', tone: 'none' };
  else if (syncState.phase === 'syncing') account = { text: 'Syncing…', tone: 'ok' };
  else if (status.tone === 'off') account = { text: 'Sync off', tone: 'off' };
  else account = { text: 'Synced', tone: 'ok' };

  // The round summary has no entry of its own; it belongs to Practice.
  const marked = current === 'round' ? 'practice' : current;

  return (
    <header className="site-nav">
      <Brand />
      <nav className="nav-links" aria-label="Pages">
        {PAGES.map((page) => (
          <a key={page} href={hrefOf(page)} className={marked === page ? 'nav-link nav-on' : 'nav-link'} aria-current={current === page ? 'page' : undefined}>
            {ROUTE_TITLES[page]}
          </a>
        ))}
      </nav>
      <div className="stats" aria-label="Your practice">
        <div className="stat" title={`${points.total} points: ${points.time} for minutes practised, ${points.knowledge} for Solid and Instant items. ${level.need - level.into} more to level ${level.level + 1}.`}>
          <span className="stat-label">Level {level.level}</span>
          <div className="bar xp">
            <div style={{ width: `${(level.into / level.need) * 100}%` }} />
          </div>
        </div>
        <div className="stat" title={`Days in a row with ${DAILY_GOAL} correct notes`}>
          <span className="stat-label">Streak</span>
          <b>
            {streak} {streak === 1 ? 'day' : 'days'}
          </b>
        </div>
        <div className="stat" title="Correct first-try notes today">
          <span className="stat-label">Today</span>
          <b className={today >= DAILY_GOAL ? 'good' : ''}>
            {Math.min(today, 999)} / {DAILY_GOAL}
          </b>
        </div>
      </div>
      <a
        href={hrefOf('account')}
        className={current === 'account' ? 'stat nav-account nav-on' : 'stat nav-account'}
        aria-current={current === 'account' ? 'page' : undefined}
        title={status.text}
      >
        <span className="stat-label">Account</span>
        <b className={`sync-${account.tone}`} role="status">
          {account.tone !== 'none' && <i aria-hidden="true" />}
          {account.text}
        </b>
      </a>
    </header>
  );
}
