// Build-time facts for the footer: the version in package.json and the short commit hash.
// Plain JavaScript so that vite.config.ts needs no Node type definitions.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/** Short hash of the commit being built, or '' when git or the repository is not there. */
export function commitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}
