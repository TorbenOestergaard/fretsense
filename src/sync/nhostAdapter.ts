import { createClient } from '@nhost/nhost-js';
import { FetchError } from '@nhost/nhost-js/fetch';
import type { SyncDoc } from './merge';
import { SyncError, type PullResult, type SyncBackend, type SyncUser } from './types';

// The only file that knows about Nhost. Progress lives in one table, `fretsense_progress`,
// with one row per user: (user_id, data jsonb, updated_at). See backend/nhost-setup.sql.

interface NhostConfig {
  subdomain: string;
  region: string;
  label: string;
}

const VERSION_QUERY = `query FretsenseVersion { fretsense_progress(limit: 1) { updated_at } }`;
const PULL_QUERY = `query FretsensePull { fretsense_progress(limit: 1) { data updated_at } }`;
const PUSH_MUTATION = `mutation FretsensePush($data: jsonb!) {
  insert_fretsense_progress_one(
    object: { data: $data }
    on_conflict: { constraint: fretsense_progress_pkey, update_columns: [data] }
  ) { updated_at }
}`;
const DELETE_PROGRESS = `mutation FretsenseDelete { delete_fretsense_progress(where: {}) { affected_rows } }`;
const DELETE_USER = `mutation FretsenseDeleteUser($id: uuid!) { deleteUser(id: $id) { id } }`;

type Row = { data?: unknown; updated_at: string };

function toSyncError(err: unknown): SyncError {
  if (err instanceof SyncError) return err;
  if (err instanceof FetchError) {
    const body = err.body as { error?: string; message?: string; errors?: { message?: string }[] } | null;
    const code = body?.error;
    if (code === 'invalid-email-password') return new SyncError('invalid-credentials', 'Wrong email or password.');
    if (code === 'user-already-exists') return new SyncError('user-exists', 'There is already an account with this email. Sign in instead.');
    if (code === 'password-too-short' || code === 'password-in-hibp-database') return new SyncError('weak-password', 'Choose a longer password (at least 9 characters).');
    if (code === 'unverified-user') return new SyncError('unverified', 'Confirm your email address first (check your inbox), then sign in.');
    if (code === 'invalid-refresh-token' || err.status === 401) return new SyncError('signed-out', 'You have been signed out. Sign in again to sync.');
    // Status 0 or a gateway error is what a paused or unreachable project looks like.
    if (!err.status || err.status >= 502) return new SyncError('unreachable', 'The sync server cannot be reached.');
    return new SyncError('server', body?.message ?? body?.errors?.[0]?.message ?? `The sync server answered with an error (${err.status}).`);
  }
  return new SyncError('unreachable', 'The sync server cannot be reached.');
}

export function createNhostBackend(config: NhostConfig): SyncBackend {
  const nhost = createClient({ subdomain: config.subdomain, region: config.region });

  const userOf = (session: ReturnType<typeof nhost.getUserSession>): SyncUser | null =>
    session?.user ? { id: session.user.id, email: session.user.email ?? null } : null;

  async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    if (!nhost.getUserSession()) throw new SyncError('signed-out', 'Not signed in.');
    try {
      const res = await nhost.graphql.request<T>({ query, variables });
      if (!res.body.data) throw new SyncError('server', 'The sync server sent an empty answer.');
      return res.body.data;
    } catch (err) {
      throw toSyncError(err);
    }
  }

  return {
    label: config.label,

    currentUser: () => userOf(nhost.getUserSession()),

    onUserChange(fn) {
      let lastId = userOf(nhost.getUserSession())?.id ?? null;
      return nhost.sessionStorage.onChange((session) => {
        // Also fires on every token refresh; only report real sign-ins and sign-outs.
        const user = userOf(session);
        if ((user?.id ?? null) === lastId) return;
        lastId = user?.id ?? null;
        fn(user);
      });
    },

    async signUp(email, password) {
      try {
        const res = await nhost.auth.signUpEmailPassword({ email, password });
        return res.body.session ? userOf(nhost.getUserSession()) : null;
      } catch (err) {
        throw toSyncError(err);
      }
    },

    async signIn(email, password) {
      try {
        await nhost.auth.signInEmailPassword({ email, password });
      } catch (err) {
        throw toSyncError(err);
      }
      const user = userOf(nhost.getUserSession());
      if (!user) throw new SyncError('server', 'Signing in did not complete. This account may need an extra sign-in step that this app does not support.');
      return user;
    },

    async signOut() {
      const session = nhost.getUserSession();
      try {
        if (session) await nhost.auth.signOut({ refreshToken: session.refreshToken });
      } catch {
        // Offline: the server-side session expires by itself.
      }
      nhost.clearSession();
    },

    async pull(knownVersion): Promise<PullResult> {
      if (knownVersion) {
        const head = await gql<{ fretsense_progress: Row[] }>(VERSION_QUERY);
        if (head.fretsense_progress[0]?.updated_at === knownVersion) return { kind: 'unchanged' };
      }
      const row = (await gql<{ fretsense_progress: Row[] }>(PULL_QUERY)).fretsense_progress[0];
      return row ? { kind: 'doc', doc: row.data, version: row.updated_at } : { kind: 'none' };
    },

    async push(doc: SyncDoc) {
      const res = await gql<{ insert_fretsense_progress_one: Row | null }>(PUSH_MUTATION, { data: doc });
      if (!res.insert_fretsense_progress_one) throw new SyncError('server', 'The sync server did not save the progress.');
      return res.insert_fretsense_progress_one.updated_at;
    },

    async deleteAccount() {
      const user = userOf(nhost.getUserSession());
      if (!user) throw new SyncError('signed-out', 'Not signed in.');
      await gql(DELETE_PROGRESS);
      try {
        // Works when the project lets users delete their own row in auth.users (see the
        // setup file). The progress row above is already gone either way.
        await gql(DELETE_USER, { id: user.id });
        nhost.clearSession();
        return true;
      } catch {
        await this.signOut();
        return false;
      }
    },
  };
}
