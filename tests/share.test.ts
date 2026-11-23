import { describe, expect, it } from 'vitest';
import { SHORE_URL, beachShareText, shareUrl, shoreBeachUrl, visitCodeFromUrl, withoutVisitParam } from '../src/net/share';

describe('share links', () => {
  it('builds a link with the beach code on any host and path', () => {
    expect(shareUrl('https://beech.markjen.com', '/', 'K7F2QX')).toBe('https://beech.markjen.com/?visit=K7F2QX');
    expect(shareUrl('https://markjen.com', '/beech/', 'K7F2QX')).toBe('https://markjen.com/beech/?visit=K7F2QX');
    expect(shareUrl('https://markjen.com', '/beech', 'K7F2QX')).toBe('https://markjen.com/beech/?visit=K7F2QX');
  });

  it('reads the ?visit= code, forgiving about case, spaces and dashes', () => {
    expect(visitCodeFromUrl('?visit=K7F2QX')).toBe('K7F2QX');
    expect(visitCodeFromUrl('?visit=k7f-2qx')).toBe('K7F2QX');
    expect(visitCodeFromUrl('?visit=K7F 2QX&seed=1')).toBe('K7F2QX');
    expect(visitCodeFromUrl('?seed=1')).toBeNull();
    expect(visitCodeFromUrl('?visit=short')).toBeNull();
    expect(visitCodeFromUrl('?visit=TOOLONGCODE')).toBeNull();
    expect(visitCodeFromUrl('')).toBeNull();
  });

  it('strips the visit parameter and keeps the rest', () => {
    expect(withoutVisitParam('?visit=K7F2QX')).toBe('');
    expect(withoutVisitParam('?visit=K7F2QX&seed=1')).toBe('?seed=1');
    expect(withoutVisitParam('?seed=1')).toBe('?seed=1');
    expect(withoutVisitParam('')).toBe('');
  });
});

describe('beechshore links', () => {
  it('are short enough to text', () => {
    expect(SHORE_URL).toBe('https://beechshore.com');
    expect(shoreBeachUrl('K7F2QX')).toBe('https://beechshore.com/K7F2QX');
    expect(shoreBeachUrl('K7F2QX', 'http://localhost:8787/shore/')).toBe('http://localhost:8787/shore/K7F2QX');
  });

  it('come with a line of text', () => {
    expect(beachShareText('Ana')).toBe('Look at Ana’s beach on the shore 🏖️');
    expect(beachShareText('Ana', 'Moat Town')).toContain('“Moat Town”, Ana’s beach');
    expect(beachShareText('', undefined)).toContain('Someone’s beach');
    expect(beachShareText('Ana', undefined, true)).toBe('Come and see my beach on the shore 🏖️');
    expect(beachShareText('Ana', 'Moat Town', true)).toContain('“Moat Town”, my beach');
  });
});
