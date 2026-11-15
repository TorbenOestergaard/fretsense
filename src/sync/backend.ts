import { NHOST } from './config';
import { createNhostBackend } from './nhostAdapter';
import type { SyncBackend } from './types';

/** The sync backend in use, or null when the app is built without one. */
export const backend: SyncBackend | null = NHOST.subdomain ? createNhostBackend(NHOST) : null;
