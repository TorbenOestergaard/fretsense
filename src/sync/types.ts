import type { SyncDoc } from './merge';

// The app talks to its sync backend only through this interface. To move to another backend
// (PocketBase, Supabase, your own server) write one more file that implements it and change
// the single line in backend.ts.

export interface SyncUser {
  id: string;
  email: string | null;
}

export type SyncErrorCode =
  | 'invalid-credentials'
  | 'user-exists'
  | 'weak-password'
  | 'unverified'
  /** The server could not be reached: offline, or the backend is paused. */
  | 'unreachable'
  /** The server answered, but refused or failed (for example the table is missing). */
  | 'server'
  | 'signed-out';

export class SyncError extends Error {
  constructor(
    public code: SyncErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type PullResult =
  | { kind: 'none' }
  /** The server copy is still the version the caller already has. */
  | { kind: 'unchanged' }
  | { kind: 'doc'; doc: unknown; version: string };

export interface SyncBackend {
  /** Shown in the account section, e.g. "Nhost (Frankfurt)". */
  readonly label: string;
  currentUser(): SyncUser | null;
  /** Calls back when someone signs in or out (also from another tab). Returns an unsubscribe. */
  onUserChange(fn: (user: SyncUser | null) => void): () => void;
  /** `user` is null when the account was created but must be confirmed by email first. */
  signUp(email: string, password: string): Promise<SyncUser | null>;
  signIn(email: string, password: string): Promise<SyncUser>;
  signOut(): Promise<void>;
  /** `knownVersion` is the version from the last pull or push, to skip downloading it again. */
  pull(knownVersion?: string | null): Promise<PullResult>;
  /** Replaces the server copy and returns its new version. */
  push(doc: SyncDoc): Promise<string>;
  /**
   * Deletes the signed-in user's progress and, if the backend allows it, the account itself.
   * Resolves to false when the progress is gone but the account could not be removed.
   */
  deleteAccount(): Promise<boolean>;
}
