// Addresses of the pages. They live in the hash (`#/progress`), so the static site needs no
// server rewrite under /fretsense/ and the query string (`?debug`) is left alone.

export type Route = 'practice' | 'progress' | 'mic' | 'about' | 'account' | 'round';

const PATHS: Record<Route, string> = {
  practice: '',
  progress: 'progress',
  mic: 'mic',
  about: 'about',
  account: 'account',
  round: 'round',
};

export const ROUTE_TITLES: Record<Route, string> = {
  practice: 'Practice',
  progress: 'Progress',
  mic: 'Mic & tuner',
  about: 'About',
  account: 'Account and sync',
  round: 'Round',
};

/** The value for a link's `href`. Relative, so the path and `?debug` stay as they are. */
export const hrefOf = (route: Route): string => `#/${PATHS[route]}`;

/** The page a hash points at, or null when it is not one of ours. No hash is the Practice page. */
export function parseRoute(hash: string): Route | null {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
  const found = (Object.keys(PATHS) as Route[]).find((r) => PATHS[r] === path);
  return found ?? null;
}
