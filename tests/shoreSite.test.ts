import { describe, expect, it } from 'vitest';
import { createShoreSite } from '../server/src/shoreSite';
import type { Db } from '../server/src/db';

// beechshore tiles render contiguously: no gutter between beach cards in
// the grid (home, lists, by place) or between tiles in the "Along the
// shore" strip on a beach page. The stylesheet is shared by every page via
// layout(), so fetching the home page exercises both rules.
describe('beechshore tile gaps', () => {
  const db = { query: async () => [] } as unknown as Db;
  const app = createShoreSite(db, { base: '', gameUrl: 'https://play.beech.games' });

  const rule = (css: string, sel: string) => {
    const m = css.match(new RegExp(`\\${sel}\\{[^}]*\\}`));
    expect(m, `${sel} rule present`).not.toBeNull();
    return m![0];
  };

  it('serves the grid and the strip with a zero gap', async () => {
    const res = await app.request('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(style).not.toBe('');

    expect(rule(style, '.grid')).toContain('gap:0');
    expect(rule(style, '.strip')).toContain('gap:0');
    // the old gutters are gone from both tile containers
    expect(rule(style, '.grid')).not.toMatch(/gap:(12|16)px/);
    expect(rule(style, '.strip')).not.toMatch(/gap:(12|16)px/);
  });

  it('keeps gaps that are not between beach tiles', async () => {
    const res = await app.request('http://localhost/');
    const html = await res.text();
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    // header, buttons and chips keep their own spacing
    expect(rule(style, '.top')).toContain('gap:16px');
    expect(rule(style, '.chips')).toContain('gap:8px');
  });
});
