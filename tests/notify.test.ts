import { describe, expect, it } from 'vitest';
import { ANNOUNCE } from '../src/ui/inboxText';
import { PUSH_KINDS } from '../server/src/notifyKinds';

describe('notifications', () => {
  it('every pushed kind is also announced in the app', () => {
    for (const k of Object.keys(PUSH_KINDS)) expect(ANNOUNCE.has(k), k).toBe(true);
  });
});
