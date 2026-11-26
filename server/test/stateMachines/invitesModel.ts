// The reference model for invite bonuses: specs/tla/Invites.tla with
// Fixed = TRUE (docs/INVITES_GUIDE.md, docs/STATE_MACHINES.md). One inviter;
// each method returns what the server should answer.
export class InvitesModel {
  claimed = new Set<string>();
  ranks = 0;
  friendBal = new Map<string, number>();
  inviterBal = 0;
  constructor(
    readonly cap: number,
    readonly bonus: number,
  ) {}

  /** ClaimAtomic: 200 the first time for a friend, 409 after */
  claim(friend: string): { status: number; inviterRewarded?: boolean } {
    if (this.claimed.has(friend)) return { status: 409 };
    this.claimed.add(friend);
    this.friendBal.set(friend, this.bonus);
    const rewarded = this.ranks < this.cap;
    if (rewarded) {
      this.ranks++;
      this.inviterBal += this.bonus;
    }
    return { status: 200, inviterRewarded: rewarded };
  }

  /** the spec's invariants */
  check(): string[] {
    const bad: string[] = [];
    for (const [f, b] of this.friendBal) if (b !== (this.claimed.has(f) ? this.bonus : 0)) bad.push(`OneBonusEach ${f}`);
    if (this.inviterBal > this.cap * this.bonus) bad.push('CapHolds');
    if (this.inviterBal !== this.bonus * Math.min(this.claimed.size, this.cap)) bad.push('InviterPaid');
    return bad;
  }
}
