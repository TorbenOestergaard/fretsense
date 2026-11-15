import { describe, expect, it } from 'vitest';
import { hrefOf, parseRoute, type Route } from './route';

describe('routes', () => {
  it('reads every page back from its own address', () => {
    for (const route of ['practice', 'progress', 'mic', 'about', 'account', 'round'] as Route[]) {
      expect(parseRoute(hrefOf(route))).toBe(route);
    }
  });

  it('treats no hash as the Practice page', () => {
    expect(parseRoute('')).toBe('practice');
    expect(parseRoute('#')).toBe('practice');
    expect(parseRoute('#/')).toBe('practice');
  });

  it('is lenient about case, a missing slash and a trailing slash', () => {
    expect(parseRoute('#progress')).toBe('progress');
    expect(parseRoute('#/Progress/')).toBe('progress');
  });

  it('rejects addresses that are not pages', () => {
    expect(parseRoute('#/nowhere')).toBeNull();
    expect(parseRoute('#/progress/extra')).toBeNull();
  });
});
