// The app's view of push (src/platform/notify.ts) agrees with the server's.
import { describe, expect, it } from 'vitest';
import { PUSHED_KINDS } from '../src/platform/notify';
import { ANNOUNCE } from '../src/ui/inboxText';
import { PUSH_KINDS } from '../server/src/push';

describe('notifications', () => {
  it('the app and the server push the same kinds, under the same settings', () => {
    expect(PUSHED_KINDS).toEqual(PUSH_KINDS);
  });
  it('every pushed kind is also announced in the app', () => {
    for (const k of Object.keys(PUSHED_KINDS)) expect(ANNOUNCE.has(k), k).toBe(true);
  });
});
