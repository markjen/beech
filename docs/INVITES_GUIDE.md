# Invites and the beach guide

Status: **built** (2026-11-23; updated 2026-11-24, 2026-11-26). Viral sharing that also teaches the game.

**Updated 2026-11-26 (owner): invites give sand bucks, and live on
beechshore.** A friend who makes an account through your link gets **S$ 50**
at once, and you get **S$ 50** too, at the same moment, for your first 10
friends (no waiting for them to settle in). The invite panel moved out of
the game to your account page on beechshore (`/account#invite`, docs/SAND_BUCKS.md);
"invite friends" and the guide's invite step open it. Sand bucks are
spendable in the apps now (SAND_BUCKS.md), so the reason below for items no
longer holds. State machine: [`specs/tla/Invites.tla`](../specs/tla/Invites.tla)
(see [State machine](#state-machine)). Referrals from before (migration 35's
`bonus_bucks` NULL) still finish on the ladder below when the friend settles
in.

**Updated 2026-11-24:** the game now shows no explanations (CLAUDE.md). The
coach card and the checklist show each step's name only, and the invite
panel shows no blurb. Each has a "how it works" link to the web guide,
which has a Beach guide and an Invites section (`server/src/guide.ts`,
generated from `server/src/referrals.ts`, which now holds each step's
`how`). **Links to a beach count as invites** too: someone who opens
`?visit=CODE` signed out and then signs up claims that beach's owner, like
`?invite=` (owner decision, INBOX_NOTIFICATIONS.md).

Two features that feed each other:

1. **The beach guide**: a short checklist that teaches each mechanic by
   doing it once (dig, build, undo, put something down, sit on the beach,
   the claw machine, visit, star, invite). Each step gives a small gift.
2. **Invites**: your own invite link. A friend who joins through it gets a
   welcome gift at once; you get a reward once they've **settled in** (done
   three steps of the guide). Rewards climb a ladder, with an extra beach at
   three friends.

The guide's last step is "invite a friend", so everyone who learns the game
is walked to the invite at the moment they like it most. And every invited
friend is walked through the guide, which is what earns the inviter's reward.

## Why items, not store credit (until 2026-11-26)

Account credit (GIFT_CARDS_PROMOS.md) is **web only**: the App Store
(3.1.1) and Play payments policy don't allow spending it in the apps, so
`codesAllowed()` hides it there. Credit for invites would be invisible to
most players. Inventory items work everywhere, on every device, and the shop
items among them **glow on the beach**, so neighbors walking past see them —
the same advertising the claw machine's deckchair does (PRICING.md).

Rewards are ordinary inventory rows with `source = 'reward'`. They can be
placed, gifted and kept like anything else.

## The guide

| Step | Teaches | How (as the guide says it) | Gift | Checked by |
|---|---|---|---|---|
| `dig` | the shovel | Pick the shovel and drag on the sand. Hold still to dig deeper. | Conch | app |
| `pile` | building | Pick the build tool and drag to heap sand up. | Sand dollar | app |
| `undo` | undo | Tap ↶ to take back your last stroke. | Conch | app |
| `place` | the bag | Open the bag, pick a rock or a shell, and tap the sand. | Sand dollar | app |
| `chair` | chair view | Tap the chair to sit and look out to sea. Hold ‹ › to walk. | Conch | app |
| `claw` | claw machine | Open the bag and play the claw machine: it's free. | (the claw's own prize) | **server** (a pull exists) |
| `visit` | the shore | Walk down the shore, or open the most-starred beaches. | Sand dollar | app |
| `star` | stars | Tap ☆ on a beach you like. | Conch | **server** (a star exists) |
| `invite` | invites | Share your invite link. You each get a gift. | (the invite ladder) | **server** (a friend joined) |

Finishing the first eight earns a **Starfish** as well.

- Steps are done **once per account**. `POST /api/guide/:step` inserts a
  row (`guide_steps`, primary key `(user_id, step)`) and grants the gift in
  the same statement only if the row was new, so a retried request or two
  devices can't double a gift.
- App-checked steps trust the app. That's fine: the gifts are commons, each
  is once per account, and an account needs a Google or Apple sign-in.
- The **sandbox build** (no accounts) runs the guide locally for teaching:
  the five app-checked steps that don't need a server, no gifts, progress in
  `localStorage`. With accounts, steps done before signing in are kept on
  the device and sent after sign-in, so they still earn their gifts.
- The guide button (a compass) shows progress (`3/9`), and a small coach
  chip above the tools shows the next step with its hint. The chip can be
  dismissed ("hide the tips"); the button stays. `?nointro` and `?smoke`
  (the test scripts) leave the coach card out, like the start screen, so it
  can't sit under a scripted tap; the guide still records steps.

## Invites

### The link

```
https://beech.markjen.com/?invite=K7F2QX
```

The code is the inviter's **home beach code** (their neighbor code), so no
new id is needed. Like `?visit=`, it's built from the page the inviter is on.
If the inviter later takes a new code, old invite links stop working, the
same as old visit links. That's the trade for not adding a second code.

### Landing

1. On startup the app reads `?invite=` and keeps it in `localStorage`
   (it has to survive the Google / Apple sign-in), then strips it from the
   URL. The invite also acts as a visit: once signed in, you land on the
   inviter's beach.
2. Signed out, the start screen says **"Ana invited you"**
   (`GET /api/invites/:code`, no sign-in, rate-limited per IP) and the
   settings sheet's sign-in says signing in brings a welcome gift.
3. After sign-in the app calls `POST /api/referrals/claim`. The friend gets
   the **welcome gift** (a parasol) and a note: "A welcome gift from Ana: a
   parasol. Ask to be Ana's neighbor?", with a button that asks for a free
   side next to the inviter's home beach (the usual neighbor request, which
   the inviter accepts).

### Who can be invited

- Only an account **made in the last 7 days**: existing players can't
  attach themselves to each other after the fact.
- Only once: `referrals.invitee_id` is the primary key.
- Not yourself (any of your own beaches' codes is refused).

### The inviter's ladder (referrals from before 2026-11-26)

A friend **settles in** when they've done three guide steps (any three,
not counting `invite`). At that moment, inside their guide request, the
server marks the referral qualified and gives the inviter the next rung:

| Friend | Reward |
|---|---|
| 1st | Parasol |
| 2nd | Surfboard |
| 3rd | **Extra beach** |
| 4th | Tiki torch |
| 5th | Sandcastle |
| 6th–10th | Starfish |
| 11th on | counted, no more rewards |

- Each qualified referral takes the next **rank** for its inviter, with
  `UNIQUE (inviter_id, reward_rank)`: two friends settling in at the same
  moment can't both take rank 2; the loser retries and takes rank 3.
- The cap of ten rewards limits what throwaway accounts can farm. Each
  one needs its own Google or Apple account and three guide steps.
- The inviter sees the result the next time the app loads
  `GET /api/referrals` (on sign-in, and when the invite panel opens): a note
  "Ana settled in: a surfboard is in your bag", once per reward (the app
  remembers the last count it told you about).

### The invite panel (moved to beechshore, 2026-11-26)

Opened from the guide's last step and from the account panel
("invite friends"):

- your link, with **Share** (the system share sheet where there is one,
  with a line of text) and **Copy**;
- the ladder, with the rungs you've reached ticked and the next one
  highlighted;
- your friends: first name, and "joined" or "settled in ✓".

### Link previews

`?invite=CODE` gets Open Graph tags like `?visit=` does
(`server/src/shareMeta.ts`): **"Ana invited you to beech"** / "Dig in the
sand, watch the waves wash it away, and get a welcome gift."

## API

```
GET  /api/guide                       -> { done: [{ step, at }] }
POST /api/guide/:step                 -> { step, new, gift: item | null, bonus: item | null }
       400 unknown step · 409 a server-checked step that isn't true yet
GET  /api/invites/:code   (no auth)   -> { name }            404 no beach has that code
POST /api/referrals/claim { code }    -> { inviter: { name, code }, gift }
       400 bad code / your own · 404 unknown · 409 already invited, or the account is too old
GET  /api/referrals                   -> { code, joined, settled, friends: [{ name, settled }],
                                           ladder: [{ rank, item }], cap }
```

## Data

Migration 23:

```sql
ALTER TABLE inventory: source may also be 'reward'
guide_steps (user_id, step, done_at, PRIMARY KEY (user_id, step))
referrals (invitee_id PRIMARY KEY, inviter_id, code, created_at,
           qualified_at, reward_rank, reward_item,
           UNIQUE (inviter_id, reward_rank))
```

Deleting an account deletes its rows (`ON DELETE CASCADE`); a referral goes
when either side is deleted.

## Tests

- `server/test/referrals.test.ts`: guide steps are once-only with one gift;
  server-checked steps refuse until true; the bonus after eight; invite
  lookup; claim rules (own code, unknown, twice, old account); welcome gift;
  settling in rewards the inviter once; the ladder order and the cap;
  concurrent settles take different ranks.
- `server/test/shareMeta.test.ts`: invite previews.
- `tests/guide.test.ts`: step order, next step, sandbox steps, the app and
  server step lists and gifts agree with the catalog.
- `tests/share.test.ts`: invite link builder and parser.

## Decisions for the owner

- **The ladder** (parasol, surfboard, extra beach at 3, tiki torch,
  sandcastle, then starfish, ten rewards at most). An extra beach is the
  $2.99 core purchase; giving one for three real friends is generous on
  purpose. Easy to change in `server/src/referrals.ts`.
- **Settled in = three guide steps.** Stricter (a day later, or a saved
  beach with things on it) is easy to add if farming shows up.
- **The welcome gift is a parasol** (a $0.99 shop item, so new friends see
  the glow on day one).

## Follow-ups

- Universal Links / App Links, so an invite opens in the phone apps (the
  same gap as visit links).
- An `og:image` for previews (the same gap as visit links).
- Admin console: a referrals view (who invited whom) for disputes.
- Push for "your friend settled in" instead of waiting for the next load.

## State machine

[`specs/tla/Invites.tla`](../specs/tla/Invites.tla): one inviter, friends
with two devices each. `InvitesFixed.cfg` passes; `Invites.cfg` (read "not
claimed yet" and the next rank in one statement, write in another) breaks
`OneBonusEach` (two devices both claim) and `CapHolds` (two friends both take
the last rank).

| Action | Route | Code |
| --- | --- | --- |
| `ClaimAtomic` | `POST /referrals/claim` | one transaction: `INSERT INTO referrals … ON CONFLICT (invitee_id) DO NOTHING` with `reward_rank` = MAX + 1 (NULL past the cap; `UNIQUE (inviter_id, reward_rank)` makes a racing friend retry), then `creditBalance` for the friend and, with a rank, the inviter |

Invariants: `OneBonusEach`, `CapHolds`, `InviterPaid`. Tests:
`server/test/referrals.test.ts`, `server/test/stateMachines/invites.test.ts`
(two devices at once, and random walks against `invitesModel.ts`).
