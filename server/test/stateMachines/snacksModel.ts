// The reference model for beach snacks and pets: specs/tla/Snacks.tla with
// Fixed = TRUE, one action at a time. Each method is one TLA+ action and
// returns the HTTP status the server should answer with; the test applies
// the same action to the real server and compares (docs/STATE_MACHINES.md).
import { BEFRIEND_FEED_THRESHOLD, SNACK_OUT_MS } from '../../src/animals.js';

export type Player = 'owner' | 'visitor';
interface Snack { wild: boolean; at: number; prev: number }
interface Pet { src: 'befriended' | 'shop'; fed: number; last: number }

export class SnacksModel {
  bag: Record<Player, number> = { owner: 0, visitor: 0 };
  petItem = 0;
  snack: Snack | null = null;
  progress = 0;
  pet: Pet | null = null;
  fedToday = new Set<Player>();
  // ghosts, as in the spec
  wildNet = 0;
  befriendedAt = -1;
  freeFeeds = 0;
  granted = 0;

  returnable(now: number): boolean {
    return !!this.snack && this.snack.at > now - SNACK_OUT_MS;
  }

  grant(p: Player, n: number) {
    this.bag[p] += n;
    if (p === 'owner') this.granted += n;
  }

  /** Toss: POST /animals/feed */
  toss(now: number): number {
    if (this.bag.owner === 0) return 409;
    this.bag.owner--;
    // a snack already out is replaced: it counts as eaten
    if (this.pet) {
      this.snack = { wild: false, at: now, prev: this.pet.last };
      this.pet = { ...this.pet, fed: this.pet.fed + 1, last: now };
    } else {
      this.snack = { wild: true, at: now, prev: 0 };
      this.progress++;
      this.wildNet++;
    }
    return 200;
  }

  /** PickUp: POST /animals/feed/return */
  pickUp(now: number): number {
    if (!this.snack || !this.returnable(now)) return 409;
    const s = this.snack;
    this.snack = null;
    this.bag.owner++;
    if (s.wild) {
      this.progress = Math.max(0, this.progress - 1);
      this.wildNet--;
    } else if (this.pet && this.pet.last === s.at) {
      this.pet = { ...this.pet, last: s.prev, fed: Math.max(0, this.pet.fed - 1) };
    }
    return 200;
  }

  /** AdoptCheck + AdoptInsert, atomic: POST /pet/adopt {mode: befriend} */
  adoptBefriend(now: number): number {
    if (this.pet || this.progress < BEFRIEND_FEED_THRESHOLD) return 409;
    this.befriendedAt = this.wildNet;
    this.snack = null; // the befriended crab ate the snack that was out
    this.progress = 0;
    this.pet = { src: 'befriended', fed: 1, last: now };
    return 200;
  }

  /** ShopConsume + ShopInsert: POST /pet/adopt {mode: shop} */
  adoptShop(now: number): number {
    if (this.pet || this.petItem === 0) return 409;
    this.petItem--;
    this.pet = { src: 'shop', fed: 1, last: now };
    return 200;
  }

  /** VisitCheck + VisitFeed, atomic: POST /beaches/:code/pet/feed by the visitor */
  visit(now: number, useFood: boolean): number {
    if (!this.pet) return 404;
    const free = !this.fedToday.has('visitor') && !useFood;
    if (!free) {
      if (this.bag.visitor === 0) return 409;
      this.bag.visitor--;
    } else this.freeFeeds++;
    this.pet = { ...this.pet, fed: this.pet.fed + 1, last: now };
    this.fedToday.add('visitor');
    return 200;
  }

  /** The spec's invariants, checked on the model itself. */
  invariants(now: number): string[] {
    const bad: string[] = [];
    const eatenSnacks = this.granted - this.bag.owner - (this.returnable(now) ? 1 : 0);
    if (eatenSnacks < 0) bad.push('SnacksConserved');
    if (!this.pet && this.progress !== this.wildNet) bad.push('ProgressMatches');
    if (this.befriendedAt !== -1 && this.befriendedAt < BEFRIEND_FEED_THRESHOLD) bad.push('BefriendedFairly');
    if (this.freeFeeds > 1) bad.push('OneFreeFeedADay');
    return bad;
  }
}
