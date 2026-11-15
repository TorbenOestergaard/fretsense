import { describe, expect, it } from 'vitest';
import { applyAnswer, emptyProgress, itemKey, progressStore, type ProgressData } from '../game/progress';
import type { SyncDoc } from './merge';
import { createSync } from './sync';
import { SyncError, type SyncBackend, type SyncUser } from './types';

/** A server with one progress row per user, shared by the "browsers" in a test. */
function fakeServer() {
  const rows = new Map<string, { doc: SyncDoc; version: string }>();
  let clock = 0;
  let down = false;
  return {
    rows,
    setDown: (value: boolean) => (down = value),
    browser(): SyncBackend {
      let user: SyncUser | null = null;
      const check = () => {
        if (down) throw new SyncError('unreachable', 'The sync server cannot be reached.');
        if (!user) throw new SyncError('signed-out', 'Not signed in.');
        return user;
      };
      return {
        label: 'fake',
        currentUser: () => user,
        onUserChange: () => () => {},
        signUp: async (email) => (user = { id: email, email }),
        signIn: async (email) => (user = { id: email, email }),
        signOut: async () => void (user = null),
        async pull(known) {
          const row = rows.get(check().id);
          if (!row) return { kind: 'none' };
          if (row.version === known) return { kind: 'unchanged' };
          return { kind: 'doc', doc: JSON.parse(JSON.stringify(row.doc)), version: row.version };
        },
        async push(doc) {
          const version = `v${++clock}`;
          rows.set(check().id, { doc: JSON.parse(JSON.stringify(doc)), version });
          return version;
        },
        async deleteAccount() {
          rows.delete(check().id);
          user = null;
          return true;
        },
      };
    },
  };
}

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
}

const T0 = new Date(2026, 10, 1, 12).getTime();
function play(data: ProgressData, t: number, n: number): ProgressData {
  let next = data;
  for (let i = 0; i < n; i++) {
    next = applyAnswer(next, { mode: 'notes', key: itemKey(0, i % 4), pc: i % 4, string: 0, fret: i % 4, firstTry: true, ms: 1500, combo: 0 }, t + i * 10000).data;
  }
  return next;
}

// The progress store is one per page, so each "browser" keeps its own copy and puts it in
// the store while it is the one acting.
describe('sync between two browsers', () => {
  it('first sign-in uploads, a second browser merges, and both end up equal', async () => {
    const server = fakeServer();
    const chrome = createSync(server.browser(), memoryStorage());
    const safari = createSync(server.browser(), memoryStorage());

    progressStore.set(play(emptyProgress(), T0, 10));
    await chrome.signUp('me@example.test', 'x', () => true);
    expect(chrome.getState().phase).toBe('idle');
    expect(server.rows.get('me@example.test')!.doc.events).toHaveLength(10);
    expect(server.rows.get('me@example.test')!.doc.settings).not.toHaveProperty('deviceId');
    let chromeData = progressStore.get();

    progressStore.set(play(emptyProgress(), T0 + 86400000, 4));
    await safari.signIn('me@example.test', 'x', () => true);
    expect(progressStore.get().events).toHaveLength(14);
    expect(server.rows.get('me@example.test')!.doc.events).toHaveLength(14);
    const safariData = progressStore.get();

    progressStore.set(chromeData);
    await chrome.syncNow();
    chromeData = progressStore.get();
    expect(chromeData.events).toHaveLength(14);
    expect(chromeData.xp).toBe(safariData.xp);
    expect(chromeData.stats).toEqual(safariData.stats);

    // Nothing new on either side: no upload.
    const version = server.rows.get('me@example.test')!.version;
    await chrome.syncNow();
    expect(server.rows.get('me@example.test')!.version).toBe(version);
  });

  it('keeps working when the server is unreachable and catches up later', async () => {
    const server = fakeServer();
    const browser = createSync(server.browser(), memoryStorage());
    progressStore.set(play(emptyProgress(), T0, 3));
    await browser.signIn('me@example.test', 'x', () => true);

    server.setDown(true);
    progressStore.set(play(progressStore.get(), T0 + 3600000, 2));
    await browser.syncNow();
    expect(browser.getState().phase).toBe('off');
    expect(browser.getState().problem).toMatch(/cannot be reached/);
    expect(progressStore.get().events).toHaveLength(5);

    server.setDown(false);
    await browser.syncNow();
    expect(browser.getState().phase).toBe('idle');
    expect(server.rows.get('me@example.test')!.doc.events).toHaveLength(5);
  });

  it('does not mix one person’s local progress into another account unless asked to', async () => {
    const server = fakeServer();
    const browser = createSync(server.browser(), memoryStorage());
    progressStore.set(play(emptyProgress(), T0, 6));
    await browser.signIn('a@example.test', 'x', () => true);
    await browser.signOut();
    expect(progressStore.get().events).toHaveLength(6);

    await browser.signIn('b@example.test', 'x', () => false);
    expect(progressStore.get().events).toHaveLength(0);
    expect(server.rows.get('b@example.test')!.doc.events).toHaveLength(0);
    expect(server.rows.get('a@example.test')!.doc.events).toHaveLength(6);
  });

  it('deleting the account removes the server copy and keeps local progress', async () => {
    const server = fakeServer();
    const browser = createSync(server.browser(), memoryStorage());
    progressStore.set(play(emptyProgress(), T0, 6));
    await browser.signIn('a@example.test', 'x', () => true);
    await browser.deleteAccount();
    expect(server.rows.size).toBe(0);
    expect(browser.getState().phase).toBe('signed-out');
    expect(progressStore.get().events).toHaveLength(6);
  });
});
