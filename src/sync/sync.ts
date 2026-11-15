import { emptyProgress, progressStore } from '../game/progress';
import { backend as defaultBackend } from './backend';
import { fingerprint, fromSyncDoc, mergeProgress, toSyncDoc } from './merge';
import { SyncError, type SyncBackend, type SyncUser } from './types';

// Keeps the progress in this browser and the copy on the server in step. localStorage stays
// the master copy: practice never waits for the network, and every failure here only changes
// the small status line.
//
// One sync is always: download the server copy (if it changed), merge it into the local
// progress, upload the result (if the server lacks anything).

export interface SyncState {
  /** False when the app was built without a backend. */
  available: boolean;
  label: string;
  user: SyncUser | null;
  phase: 'signed-out' | 'idle' | 'syncing' | 'off';
  /** Why sync is off, when it is. */
  problem: string | null;
  lastSynced: number | null;
}

interface Meta {
  /** Whose progress this browser was last synced with. */
  userId: string | null;
  version: string | null;
  lastSynced: number | null;
  /** Fingerprint of the progress at the last successful sync. */
  print: string | null;
}

const META_KEY = 'fretsense.sync.v1';
const EMPTY_META: Meta = { userId: null, version: null, lastSynced: null, print: null };

export function createSync(backend: SyncBackend | null, storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
  let meta: Meta = EMPTY_META;
  try {
    meta = { ...EMPTY_META, ...(JSON.parse(storage?.getItem(META_KEY) ?? '{}') as Partial<Meta>) };
  } catch {
    // Start without sync history.
  }
  const saveMeta = (next: Meta) => {
    meta = next;
    try {
      storage?.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      // Not being able to remember the last sync only costs one extra download.
    }
  };

  const user = backend?.currentUser() ?? null;
  let state: SyncState = {
    available: !!backend,
    label: backend?.label ?? '',
    user,
    phase: user ? 'idle' : 'signed-out',
    problem: null,
    lastSynced: user && meta.userId === user.id ? meta.lastSynced : null,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<SyncState>) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };

  let running: Promise<void> | null = null;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** True while the sign-in form is handling a sign-in, so it is not handled twice. */
  let viaForm = false;

  async function runSync(): Promise<void> {
    if (!backend || !state.user) return;
    const userId = state.user.id;
    update({ phase: 'syncing' });
    try {
      const sameUser = meta.userId === userId;
      const pulled = await backend.pull(sameUser ? meta.version : null);
      // No awaits between reading the local progress and writing the merge back, so an
      // answer given meanwhile cannot be lost.
      const local = progressStore.get();
      let merged = local;
      let upload: boolean;
      let version = sameUser ? meta.version : null;
      if (pulled.kind === 'doc') {
        const remote = fromSyncDoc(pulled.doc);
        merged = mergeProgress(local, remote);
        if (fingerprint(merged) !== fingerprint(local)) progressStore.set(merged);
        upload = fingerprint(merged) !== fingerprint(remote);
        version = pulled.version;
      } else {
        upload = pulled.kind === 'none' || fingerprint(local) !== meta.print;
      }
      if (upload) version = await backend.push(toSyncDoc(merged));
      if (state.user?.id !== userId) return;
      saveMeta({ userId, version, lastSynced: Date.now(), print: fingerprint(merged) });
      update({ phase: 'idle', problem: null, lastSynced: meta.lastSynced });
    } catch (err) {
      if (state.user?.id !== userId) return;
      const problem = err instanceof SyncError ? err.message : 'Sync failed.';
      if (err instanceof SyncError && err.code === 'signed-out') update({ user: null, phase: 'signed-out', problem });
      else update({ phase: 'off', problem });
    }
  }

  function syncNow(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = runSync().finally(() => {
      running = null;
      if (again) {
        again = false;
        void syncNow();
      }
    });
    return running;
  }

  const hasHistory = () => progressStore.get().events.length > 0 || progressStore.get().sessions.length > 0;

  async function signedIn(next: SyncUser, keepLocal: () => boolean) {
    // Progress here that was synced to someone else's account: ask before mixing it in.
    if (meta.userId && meta.userId !== next.id && hasHistory() && !keepLocal()) {
      progressStore.set({ ...emptyProgress(), settings: progressStore.get().settings });
    }
    if (meta.userId !== next.id) saveMeta({ ...EMPTY_META, userId: meta.userId });
    update({ user: next, phase: 'idle', problem: null, lastSynced: null });
    await syncNow();
  }

  return {
    getState: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Call once at startup: syncs on load, when the page is hidden, and when back online. */
    start() {
      if (!backend) return;
      backend.onUserChange((next) => {
        if (viaForm || next?.id === state.user?.id) return;
        if (next) void signedIn(next, () => true);
        else update({ user: null, phase: 'signed-out', lastSynced: null });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && fingerprint(progressStore.get()) !== meta.print) void syncNow();
      });
      window.addEventListener('online', () => void syncNow());
      void syncNow();
    },

    syncNow,

    /** Sync shortly, e.g. after a finished round. Repeated calls collapse into one. */
    requestSync(delayMs = 1500) {
      if (!backend || !state.user) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void syncNow();
      }, delayMs);
    },

    /**
     * `keepLocal` is asked only when this browser holds progress synced to another account:
     * true adds it to the account being signed in to, false replaces it.
     */
    async signIn(email: string, password: string, keepLocal: () => boolean) {
      if (!backend) return;
      viaForm = true;
      try {
        await signedIn(await backend.signIn(email, password), keepLocal);
      } finally {
        viaForm = false;
      }
    },

    /** Resolves to false when the account must be confirmed by email before signing in. */
    async signUp(email: string, password: string, keepLocal: () => boolean): Promise<boolean> {
      if (!backend) return false;
      viaForm = true;
      try {
        const created = await backend.signUp(email, password);
        if (!created) return false;
        await signedIn(created, keepLocal);
        return true;
      } finally {
        viaForm = false;
      }
    },

    /** Progress stays in this browser. */
    async signOut() {
      if (!backend) return;
      update({ user: null, phase: 'signed-out', problem: null, lastSynced: null });
      await backend.signOut();
    },

    /** Deletes the server copy (and the account, if the backend allows). Local progress stays. */
    async deleteAccount(): Promise<boolean> {
      if (!backend) return false;
      const gone = await backend.deleteAccount();
      saveMeta(EMPTY_META);
      update({ user: null, phase: 'signed-out', problem: null, lastSynced: null });
      return gone;
    },
  };
}

export const sync = createSync(defaultBackend, typeof localStorage === 'undefined' ? null : localStorage);
