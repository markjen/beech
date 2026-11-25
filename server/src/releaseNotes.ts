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
    date: '2026-11-25',
    title: 'Live beaches, visitors, your inbox, new controls, and sandcastle molds',
    changes: [
      'The waves follow you along the shore: pan onto another of your beaches and the sea comes alive there, and Undo now steps back through edits on all your beaches in order. Moving between your beaches no longer reloads them.',
      'A new, quieter screen: at rest it’s just the beach and a palm button in the lower right. Tap the palm to open the toolbar; it turns into a × that closes everything again (this replaces the eye button).',
      'The toolbar is one column: Inbox, Hand, Dirt, Bag, Store, View and Manage, with Undo just above the ×. It always opens on the hand. On a phone on its side it lies along the bottom.',
      'All the dirt tools — dig, build up, smooth, flatten, vacuum, bulldozer and the two sandcastle molds — are under one Dirt button.',
      'The top-left status pane shows whose beach you’re on, the time and the swell, without floating name pills over the sand. ⌄ adds the tide, the wave strength, saving, and actions while you’re on someone else’s beach (leave something, ask to be neighbors, feed their pet, star, and the way home); × tucks it away to an “i”.',
      'Invite links keep you on the beach you came to visit after signing in. A first delivery to an empty inbox now shows a notice on the beach.',
      'Everything social is behind the Inbox: tabs for your inbox, the leaderboard, your starred beaches and visiting by code. Neighbor requests put a dot on the Inbox button.',
      'The Store has its own button; the claw and capsule machines are tiles in the Bag, which now opens in the middle of the screen.',
      'The View button cycles chair, isometric, and a new reverse view looking back at the beach from the sea.',
      'Manage has Beaches, Checkpoints, Settings and Help tabs. Wave strength moved to Settings, with four steps: calm, gentle, lively and surf.',
      'The sea now keeps working while you’re away: tides wear down sand near the waterline, wash up fresh shells and driftwood, and send anything you own that floats out to sea back to your bag. Coming back shows a “While you were away” card with a one-tap “Before the tide” restore after long gaps.',
      'Visiting someone else’s beach while they’re playing now shows their digging and building live every few seconds.',
      'The beach guide (the compass) now keeps its how-tos in the web guide. In the game, you’ll see the checklist and your progress.',
      'Visitors can leave something: a rating in shells, a note, or a gift from their bag, from “leave something” next to the beach’s name (tap the name, top left).',
      'Your inbox (the envelope, top right) shows who visited and what they left, gifts, neighbor requests, stars and ratings. Say thanks, report a note or block someone from there.',
      'Someone who signs up from a link to your beach counts as your invite.',
      'Edit any of your beaches you can see. Dig, build, clear or drag things across the seam, and each beach saves as you play.',
      'Starting a big clear-out with the bulldozer, flatten or vacuum — or any change that reshapes a tenth of your beach — first keeps the beach as it was, as a checkpoint you can go back to (Settings → checkpoints).',
      'Settings has Beach, Shore, Display and Account tabs. Open Shore to connect your own beaches side by side in one step.',
      'Switching between your beaches quickly no longer risks one beach’s sand overwriting another’s.',
      'Edit, Shop, Chair, Move, and Beach settings now have their own controls on the right. Settings, Help, and the leaderboard sit above them.',
      'The bag and paid shop now fit on short phone screens and scroll to the last item.',
      'Mold round or square sandcastle towers from Edit and use the sand tools to build walls or dig a moat.',
      'Dig and build across linked beaches you own without opening each one in Beach settings.',
      'The bag no longer slides up underneath the beach name at the top, and the beach info moved from the floating “i” into the beach name itself — tap it while visiting to see whose beach it is and get home.',
      'Beach names no longer float all over the sand: while you’re looking at someone else’s beach they stack under the beach name at the top left, with the way home and the feed-pet button right there.',
      'Vacuuming something up now says what you took, in a small note right under the beach name at the top left.',
      'After the claw or vending machine gives you a prize, the card now has a Close button — and the × at its corner works again — so you can just admire it and put it away for later instead of placing it right away.',
    ],
  },
  {
    date: '2026-11-24',
    title: 'Linked beaches, shiny prizes, and rocks that stay put',
    changes: [
      'Beach animals are now much easier to spot: sand crabs are bigger and visit far more often (the first one usually turns up within a minute), and dolphins are bigger and swim closer to the surf.',
      'Wild dolphins now occasionally cruise through the deeper water in front of your beach and leap across the waves.',
      'Visitors can now feed your beach’s pet (one free snack per beach each day, or anytime using their own beach snacks), and you’ll see a note when someone feeds yours.',
      'Adopt a resident sand crab for your beach — either by feeding wild crabs enough times to befriend one or straight from the shop. Pets stay on your beach, cozy up in a burrow to nap if unfed for a couple of days, and wake right up when you feed them.',
      'Toss Beach snacks from your bag to attract wild sand crabs sooner or feed one to keep it around longer — earned occasionally from digging finds or available in packs in the shop.',
      'A wild sand crab now pops out of the sand from time to time, scurries sideways across the beach, dodges waves and your brush, and burrows back down.',
      'Even when you aren’t signed in, other players’ public beaches now appear along the shore beside your empty beach so you can pan down the coast for ideas.',
      'You can now zoom out further to see more beaches along the shore at once.',
      'Default wave strength now rises and falls with your beach’s tide schedule (stronger around high tide, gentler around low tide), and tapping away from the bag or picking another tool now closes the bag.',
      'Combined the sand tools (dig with a shovel, build up a sand dune, and blend with a rake) into one button like the bulldozer, put the bulldozer first in the clearing menu with an upright vacuum icon, added a hide-toolbars button (or H) for distraction-free panning, and moved other players’ name tags to float along the side edges so they don’t block the beach.',
      'Design an item for Beech and submit it on beechshore.com. Propose a price and availability, follow its review, and earn Beech shop credit when your approved item sells.',
      'beechshore.com has a refreshed look, a beach finder (by code or name), and a share studio on every beach page: grab a Postcard, Square, Story, or Clean preview snapshot to share directly, copy to your clipboard, or download for Instagram, X, Bluesky, Threads, Reddit, Discord, WhatsApp, Facebook, and Messages.',
      'Refreshed the beech.games home page with a live time-of-day beach preview, a Play now on web button, a Google Play link, and an iOS coming soon note.',
      'Removed the “off the shore” setting for now — saved beaches stay on the shore.',
      'Visit any public beach in 3D and walk the shore without signing in (from beechshore.com or a shared link).',
      'Every beach page on beechshore.com now has Flat / 3D / From the sea buttons on its picture: the 3D views show your beach as an isometric diorama, from the land looking out to sea or from the sea looking in, with the beaches either side.',
      'The 3D views on a beach page now zoom into the beach being shared, with just a sliver of the beaches either side before they crop off.',
      'Settings now lists the beaches along the shore to visit, and signing in there saves your beach so you can keep it on any device.',
      'The shop no longer squeezes a pack’s description into a word per line when the “Buy with credit” button is showing: the buttons sit on a row of their own under the text.',
      'Linked neighbors now blend edge to edge into one continuous beach — sand, water, and rolling wave fronts flow smoothly across the seam with no gap, and the surf blends seamlessly out into the open sea. Unlinked beaches along the shore keep their space.',
      'Prizes from the claw and vending machines now look the part on your beach: the pink shell is properly pink, the golden sand dollar is shiny gold, and the rest of the week’s set stands out from the free shells and sea glass.',
      'The golden sand dollar is now giant: it starts at twice the size of the largest regular sand dollar and scales up from there.',
      'Sand piled over rocks now stays over them when you reload, export a beach, or restore a checkpoint.',
      'Rocks placed against each other no longer pile sand up into a tall spike. Beaches that grew one smooth it away the next time they’re opened.',
      'The sea now brings in more than shells and sea glass: a crumpled bright bottle or can, a strand of seaweed, and a spotted cowrie now and then. Pick one up and put it down and it’s yours — the bag’s “Found” section keeps track.',
      'Next week the vending machine has a beach ball, a pair of sandals and a bucket to win, alongside last week’s sea glass, pebble, conch, bottle and nautilus.',
      'The claw machine has two new prizes to win: a branching piece of coral and a coconut.',
      'The shop has five new centrepieces: a palm tree, a lifeguard tower, a bonfire, a hammock and a beach towel.',
      'The guide now lists everything you can put on your beach — free things, washed-ashore finds, claw and vending prizes, and shop items with their prices.',
      'When you’re looking at someone else’s beach, the name tags no longer float over the sand: a small “i” sits at the bottom instead, and tapping it opens the beach’s name card (with its star and “ask to be neighbors”) and a way back to your own beach.',
      'beechshore.com now has an item catalog: every item with a picture, its size and price, and how to get it. Vote for the ones you like and leave a comment — it’s linked from the guide.',
      'Footprints are free now: press a trail of them into the sand, as many as you like.',
      'Invite friends to Beech: anyone who joins from your invite starts with a parasol, and you earn a gift each time a friend settles in — up to ten friends.',
      'Only one tab or device edits your beach at a time now: opening it somewhere else takes over editing there, and the older one turns view-only, with a button to take editing back.',
      'Your beach is now auto-saved once a day as a checkpoint, so you can always go back to yesterday’s beach (Settings → checkpoints).',
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
