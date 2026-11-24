// Release notes: what changed for players, newest first. Shown at
// https://beech.games/guide/releases (server/src/guide.ts).
//
// Every change a player can notice adds a line here in the same commit
// (CLAUDE.md). Write for players, not engineers: what they'll see or can now
// do, in plain words. Same day, same entry: add to the top entry if its date
// is today. Starter gifts are a surprise (#9): never mention them here.

export interface ReleaseNote {
  /** ISO date (UTC) the change shipped */
  date: string;
  /** a few words for the day */
  title: string;
  changes: string[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    date: '2026-11-24',
    title: 'Linked beaches, shiny prizes, and rocks that stay put',
    changes: [
      'Linked neighbors now touch edge to edge as one continuous stretch of sand, with no gap between them. Unlinked beaches along the shore keep their space.',
      'Prizes from the claw and vending machines now look the part on your beach: the pink shell is properly pink, the golden sand dollar is shiny gold, and the rest of the week’s set stands out from the free shells and sea glass.',
      'Rocks placed against each other no longer pile sand up into a tall spike. Beaches that grew one smooth it away the next time they’re opened.',
    ],
  },
  {
    date: '2026-11-23',
    title: 'A quieter screen, and a guide',
    changes: [
      'beech.games has a home page now: what beech is, how to play, and what’s new. The game itself lives at play.beech.games.',
      'The game no longer shows explanations, tips or small print. Everything is in this guide instead, with release notes like these. Settings → “guide & help” opens it.',
      'The claw machine rests for a random time between 5 minutes and 3 hours after each go: usually shorter when the ball slips out of the claw, usually longer when you win. It used to double each go, up to a day.',
      'Dig long enough and you may turn something up from this week’s vending set (up to 3 finds a day).',
      'Checkpoints: keep named copies of a beach and put them back, on that beach or another of yours.',
      'Export a beach as a file and import it again, on the web and in the apps.',
      'A beach holds 2000 things (it was 400).',
      'The Clearing tool brings the bulldozer, flatten and a vacuum together; the bulldozer and vacuum can now pick up rocks too.',
      'The vending machine: one free ball a day, from a set that changes every week.',
      'The leaderboard: the most-starred beaches of all time, and the ones rising this week.',
      'The shop: a deckchair, parasol, surfboard, tiki torches, sandcastle, beach hut and lighthouse, plus extra beaches. Gift cards and promo codes on the web.',
      'More than one beach of your own, each open on a different device at once, and a map of where they are.',
    ],
  },
  {
    date: '2026-11-22',
    title: 'Neighbors, the shore and the claw machine',
    changes: [
      'Share your beach by link, and gift things from your bag to another beach’s owner.',
      'The claw machine can drop the ball: a miss spends the go.',
      'Neighbors ask and accept, and past your neighbors the shore carries on into everyone’s beaches.',
      'The bulldozer; the sea reaches 8 m further out; waves come in sets, with a big set now and then, and at an angle.',
      'The look tool; walk the whole shore; a home button; visit any beach by its code; favorites.',
      'Zoom in closer, and choose how big things are when you set them down.',
      'The free claw machine, with its prizes in your bag.',
      'The chair view: sit on the sand facing the open sea, and walk along the beach.',
      'Neighbors’ sand updates while you watch.',
      'Shells, sea glass and flags, and the sea washes things in.',
      'Sign in with Google or Apple in the phone apps.',
      'Rocks and driftwood from the bag: rocks shape the water and the sand, driftwood floats.',
    ],
  },
];
