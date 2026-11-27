// Beech bucks and trade-ins, against specs/tla/SandBucks.tla (docs/BEECH_BUCKS.md,
// docs/STATE_MACHINES.md). Fast: the real server in-process, no rendering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { revokeStorePurchase } from '../../src/store.js';
import { beachBytes, rng, startServer, type Server } from './harness.js';
import { BucksModel, type BucksAnswer } from './bucksModel.js';

let s: Server;
beforeAll(async () => {
  s = await startServer();
});
afterAll(() => s.close());

const ITEM = 'parasol'; // 10 beech bucks

interface Who {
  token: string;
  id: string;
  edit: string;
  code: string;
}
let n = 0;
async function person(label = 'Bucks'): Promise<Who> {
  n++;
  const u = await s.signIn(`${label} ${n}`);
  const edit = await s.claim(u.token);
  const code = (await s.db.query<{ code: string }>('SELECT code FROM beach WHERE id = $1', [u.id]))[0].code;
  return { ...u, edit, code };
}

let tx = 0;
/** a beech-buck pack through the pretend store; returns its transaction id */
async function buyPack(w: Who, product = 'bucks_10') {
  const token = `t-${++tx}`;
  const r = await s.post('/store/purchase', w.token, { platform: 'dev', productId: product, token });
  expect(r.status).toBe(200);
  return token;
}
const refund = (token: string) => revokeStorePurchase(s.db, 'dev' as 'apple', token, s.clock.now);
const spend = (w: Who) =>
  s.post('/store/credit-purchase', w.token, { productId: 'item_parasol', requestId: crypto.randomUUID() });
const tradeIn = (w: Who, item = ITEM, quantity = 1) => s.post('/bag/trade-in', w.token, { item, quantity });
const gift = (from: Who, to: Who) => s.post('/gifts', from.token, { code: to.code, item: ITEM });
async function save(w: Who, k: number) {
  const epoch = Number((await s.db.query<{ epoch: number }>('SELECT epoch FROM beach WHERE id = $1', [w.id]))[0].epoch);
  return s.req(
    `/beaches/mine/${w.id}/sand`,
    {
      method: 'PUT',
      body: beachBytes(k ? { [ITEM]: k } : {}),
      headers: {
        'X-Beach-Location': 'bondi',
        'X-Beach-Nx': '16',
        'X-Beach-Ny': '16',
        'X-Beach-Max': '2000',
        'X-Beach-Epoch': String(epoch),
        'X-Edit-Token': w.edit,
      },
    },
    w.token,
  );
}
const balance = async (w: Who) => {
  const [r] = await s.db.query<{ credit_cents: number; creator_credit_debt_cents: number }>(
    'SELECT credit_cents, creator_credit_debt_cents FROM users WHERE id = $1',
    [w.id],
  );
  return { bal: Number(r.credit_cents) / 10, debt: Number(r.creator_credit_debt_cents) / 10 };
};
/** the bag's units, oldest first, by trade-in value (bucks) */
async function units(w: Who): Promise<number[]> {
  const r = await s.req('/bag', {}, w.token);
  const bag = (await r.json()) as { items: { item: string; values: number[] }[] };
  return [...(bag.items.find((i) => i.item === ITEM)?.values ?? [])].reverse();
}
async function answer(r: Response): Promise<BucksAnswer> {
  if (r.status !== 409) return { status: r.status };
  const why = ((await r.clone().json()) as { error: string }).error;
  return why === 'short' ? { status: 409, why } : { status: 409 };
}

describe('beech bucks: one transition at a time', () => {
  it('a pack fills the balance; spending moves it into the bag; trading in gives exactly that back', async () => {
    const w = await person();
    await buyPack(w, 'bucks_30');
    expect(await balance(w)).toEqual({ bal: 33, debt: 0 });
    expect((await spend(w)).status).toBe(200);
    expect(await balance(w)).toEqual({ bal: 23, debt: 0 });
    expect(await units(w)).toEqual([10]);
    const r = await tradeIn(w);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ credited: 10, bucks: 33 });
    expect(await units(w)).toEqual([]);
  });

  it('a free thing is worth its shop price', async () => {
    const w = await person();
    await buyPack(w);
    expect((await spend(w)).status).toBe(200);
    await s.grant(w.token, ITEM);
    expect(await units(w)).toEqual([10, 10]);
    expect(await (await tradeIn(w)).json()).toMatchObject({ credited: 10 });
    expect(await (await tradeIn(w)).json()).toMatchObject({ credited: 10 });
    expect(await balance(w)).toEqual({ bal: 20, debt: 0 });
  });

  it('only what is not on a beach can be traded in', async () => {
    const w = await person();
    await s.grant(w.token, ITEM, 2);
    expect((await save(w, 2)).status).toBe(200);
    const r = await tradeIn(w);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'pick it up off your beach first' });
    expect((await save(w, 1)).status).toBe(200);
    expect((await tradeIn(w)).status).toBe(200);
    expect((await tradeIn(w)).status).toBe(409);
  });

  it('an extra beach trades in only while unused; snacks, the pet and free things never', async () => {
    const w = await person();
    await s.grant(w.token, 'beach');
    expect(await (await tradeIn(w, 'beach')).json()).toMatchObject({ credited: 30 });
    await s.grant(w.token, 'beach');
    expect((await s.post('/beaches/mine', w.token, { name: 'Two' }, { 'X-Edit-Token': w.edit })).status).toBe(200);
    expect(await (await tradeIn(w, 'beach')).json()).toMatchObject({ error: 'every extra beach is in use' });
    for (const item of ['crab-treat', 'pet-crab', 'rock']) expect((await tradeIn(w, item)).status, item).toBe(400);
  });

  it('a refunded pack takes its bucks back; what was spent becomes debt, paid off by the next bucks in', async () => {
    const w = await person();
    const t = await buyPack(w);
    expect((await spend(w)).status).toBe(200);
    await refund(t);
    expect(await balance(w)).toEqual({ bal: 0, debt: 10 });
    await buyPack(w, 'bucks_30');
    expect(await balance(w)).toEqual({ bal: 23, debt: 0 });
  });

  it('a gift carries its value', async () => {
    const a = await person();
    const b = await person();
    await buyPack(a);
    expect((await spend(a)).status).toBe(200);
    expect((await gift(a, b)).status).toBe(200);
    expect(await units(b)).toEqual([10]);
    expect(await (await tradeIn(b)).json()).toMatchObject({ credited: 10 });
  });

  it('an old app’s item receipt still grants the thing; its refund takes back the bucks of a trade-in', async () => {
    const w = await person();
    const token = `t-${++tx}`;
    expect((await s.post('/store/purchase', w.token, { platform: 'dev', productId: 'item_lighthouse', token })).status).toBe(200);
    expect(await (await tradeIn(w, 'lighthouse')).json()).toMatchObject({ credited: 30 });
    await refund(token);
    expect(await balance(w)).toEqual({ bal: 0, debt: 0 });
  });

  it('a basket is one purchase, and each thing keeps its share of the price', async () => {
    const w = await person();
    await buyPack(w, 'bucks_100');
    const r = await s.post('/store/buy', w.token, { basket: [{ product: 'item_lighthouse' }, { product: 'item_tikitorch' }], requestId: crypto.randomUUID() });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await r.json()).toMatchObject({ paid: 45, bucks: 85 });
    const bag = (await (await s.req('/bag', {}, w.token)).json()) as { items: { item: string; values: number[] }[] };
    expect(bag.items.find((i) => i.item === 'lighthouse')?.values).toEqual([30]);
    expect(bag.items.find((i) => i.item === 'tikitorch')?.values.sort()).toEqual([7, 8]);
    // the same basket sent again with its request ID (the answer was lost): the first receipt, no second charge
    const requestId = crypto.randomUUID();
    const once = { basket: [{ product: 'item_parasol' }], requestId };
    expect((await s.post('/store/buy', w.token, once)).status).toBe(200);
    const again = await s.post('/store/buy', w.token, once);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ paid: 10, bucks: 75 });
    expect(await balance(w)).toEqual({ bal: 75, debt: 0 });
    expect(await units(w)).toEqual([10]);
    // short of bucks: refused, nothing changes
    const poor = await person();
    expect((await s.post('/store/buy', poor.token, { basket: [{ product: 'item_lighthouse' }] })).status).toBe(402);
  });
});

describe('beech bucks: TLC counterexamples, replayed against the server', () => {
  // SandBucks.cfg, NoPhantomUnits: TradeCheck(r1), TradeCheck(r2), TradeWrite(r1), TradeWrite(r2).
  it('two trade-ins of the last one at once credit it once', async () => {
    const w = await person();
    await s.grant(w.token, ITEM);
    const gate = s.gate.pauseBefore(/^$/, { orTransaction: true });
    const first = tradeIn(w);
    await Promise.race([gate.reached, first]);
    const second = tradeIn(w);
    gate.release();
    const statuses = (await Promise.all([first, second])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(await balance(w)).toEqual({ bal: 10, debt: 0 });
  });

  // SandBucks.cfg, NeverTradePlaced: TradeCheck, Save(1), TradeWrite.
  it('a save placing it while a trade-in is on its way: the trade-in is refused', async () => {
    const w = await person();
    await s.grant(w.token, ITEM);
    const gate = s.gate.pauseBefore(/^$/, { orTransaction: true });
    const trading = tradeIn(w);
    await Promise.race([gate.reached, trading]);
    expect((await save(w, 1)).status).toBe(200); // Save in the gap
    gate.release();
    expect((await trading).status).toBe(409);
    expect(await balance(w)).toEqual({ bal: 0, debt: 0 });
  });
});

describe('beech bucks: random walks, server vs model', () => {
  type Action = 'pack' | 'refund' | 'spend' | 'free' | 'gift' | 'save' | 'trade';
  const actions: Action[] = ['pack', 'pack', 'refund', 'spend', 'spend', 'free', 'gift', 'save', 'save', 'trade', 'trade', 'trade'];

  for (const seed of [31, 32, 33, 34, 35, 36]) {
    it(`seed ${seed}: 40 steps agree with the model and keep its invariants`, async () => {
      const r = rng(seed);
      const w = await person('Walker');
      const friend = await person('Friend');
      const m = new BucksModel();
      const packs: string[] = [];
      const trace: string[] = [];
      for (let step = 0; step < 40; step++) {
        s.clock.now += 1000;
        const a = r.pick(actions);
        let got: BucksAnswer = { status: 200 };
        let want: BucksAnswer = { status: 200 };
        trace.push(a);
        if (a === 'pack') {
          packs.push(await buyPack(w));
          m.buyPack(10);
        } else if (a === 'refund') {
          const t = packs.pop();
          if (t) {
            await refund(t);
            m.refundPack();
          }
        } else if (a === 'spend') {
          [got, want] = [{ status: (await spend(w)).status }, m.spend(10)];
        } else if (a === 'free') {
          await s.grant(w.token, ITEM);
          m.freeGrant(10);
        } else if (a === 'gift') {
          [got, want] = [{ status: (await gift(w, friend)).status }, m.giftOut1()];
        } else if (a === 'save') {
          const k = r.int(3);
          trace[trace.length - 1] = `save(${k})`;
          [got, want] = [await answer(await save(w, k)), m.save(k)];
        } else {
          const res = await tradeIn(w);
          const wanted = m.tradeIn();
          [got, want] = [{ status: res.status }, { status: wanted.status }];
        }
        const where = `seed ${seed} step ${step}: ${trace.join(' ')}`;
        expect(got, where).toEqual(want);
        expect(await balance(w), where).toEqual({ bal: m.bal, debt: m.debt });
        expect(await units(w), where).toEqual(m.units);
        expect(m.invariants(), where).toEqual([]);
      }
    });
  }
});
