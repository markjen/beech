// "Buy what's missing" keeps its request ID across an uncertain failure
// (PR #118 review): a lost answer, then a retry, must not charge twice.
import { describe, expect, it } from 'vitest';
import type { Account } from '../src/net/account';
import { ShopApi } from '../src/net/shop';

function fakeAccount(answers: (() => Promise<Response>)[]) {
  const sent: string[] = [];
  const account = {
    user: { id: 'u1' },
    fetch: async (_path: string, init?: RequestInit) => {
      sent.push((JSON.parse(String(init?.body)) as { requestId: string }).requestId);
      return answers.shift()!();
    },
  } as unknown as Account;
  return { account, sent };
}
const ok = () => Promise.resolve(new Response(JSON.stringify({ paid: 30, bucks: 0 }), { status: 200 }));
const lost = () => Promise.reject(new TypeError('Failed to fetch'));
const status = (n: number) => () => Promise.resolve(new Response(JSON.stringify({ error: 'no' }), { status: n }));
const basket = [{ product: 'item_lighthouse', quantity: 1 }];

describe('buying a basket', () => {
  it('sends the same request ID again after a lost answer or a server error, and a new one after a receipt', async () => {
    const { account, sent } = fakeAccount([lost, status(502), ok, ok]);
    const api = new ShopApi(account);
    await expect(api.buyBasket(basket)).rejects.toThrow();
    await expect(api.buyBasket(basket)).rejects.toThrow();
    await expect(api.buyBasket(basket)).resolves.toEqual({ paid: 30, bucks: 0 });
    await api.buyBasket(basket);
    expect(sent[1]).toBe(sent[0]);
    expect(sent[2]).toBe(sent[0]);
    expect(sent[3]).not.toBe(sent[0]);
  });

  it('starts afresh after a definite no, and keeps a different basket apart', async () => {
    const { account, sent } = fakeAccount([status(402), ok, lost, ok]);
    const api = new ShopApi(account);
    await expect(api.buyBasket(basket)).rejects.toThrow('no');
    await api.buyBasket(basket);
    expect(sent[1]).not.toBe(sent[0]);
    await expect(api.buyBasket([{ product: 'item_parasol', quantity: 2 }])).rejects.toThrow();
    await api.buyBasket(basket);
    expect(sent[3]).not.toBe(sent[2]);
  });
});
