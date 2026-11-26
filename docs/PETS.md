# Pets (design)

Status: **built 2026-11-26.** Extends the crab-only pets of
[ANIMALS.md](ANIMALS.md) (A3/A4) into a collection of six wild species that
can be kept by feeding or bought, and makes a pet something you own and move,
like the other things in your bag.

## Rules

1. **One pet per beach.** A beach holds at most one pet (`beach_pets` is
   keyed by beach). A beach with a pet gets no wild visitors.
2. **Every pet is wild first.** Each species visits beaches on its own. Feed
   one enough times on a beach and it stays: that's befriending, the free path.
3. **Feeding costs a quarter of the price.** Befriending takes `feeds`
   snacks; one snack is 1 sand buck (`food_pack_10`: 10 snacks for 10
   bucks). For every species `feeds × 1 buck = price ÷ 4` (`FEED_SHARE`), so
   befriending is quick: 5 to 20 snacks. Checked by tests on both sides so a
   future price change can't break it.
7. **Sand bucks only.** Pets are offers in the sand-bucks shop
   (`/store/catalog`), bought on every platform with sand bucks. New pet
   products have no App Store, Play, Steam or Xsolla item: `bucksOnly` keeps
   them out of `/store/products` and refuses them at `/store/purchase`,
   `/store/web-checkout` and `/store/steam/init`. Only `pet_crab` keeps its
   old listing, for the app versions already in the stores, until those
   listings come off sale. The pier (`item_pier`) is `bucksOnly` too: it
   never had a store item, so the Steam id it was given is dropped.
4. **Pets are items.** A pet you own is on one of your beaches or in your bag.
   Pick it up on the beach (long-press) to carry it to a new spot, or put it
   in your bag; place it from the bag on any of your beaches with no pet.
   Moving between beaches = put in bag, then place. Name, fed count and
   hunger come with it; a pet in the bag doesn't get hungrier.
5. **Water pets are visible.** Sea pets swim at the surface: the dolphin's
   back and fin, the turtle's shell and head, the seal's head, the octopus's
   mantle in the shallows always break the water. A unit test holds every sea
   pet's top above the water line while swimming.
6. **Cozy.** As before: moods from `last_fed_at` (happy, peckish, hungry,
   sleepy), pets never die or leave. Visitors: 1 free feed a day, then their
   own snacks.

## The price sheet

1 sand buck = 10¢. 1 snack = 1 buck. Every pet is bought with sand bucks, on every platform.

| Pet | Lives | Buy (bucks) | Feeds to befriend (= ¼) | Wild rarity | What it does |
|---|---|---|---|---|---|
| **Sand crab** | sand | **20** | 5 | common | Scuttles sideways, dodges waves, waves its claws, burrows to nap. |
| **Sandpiper** | wave edge | **28** | 7 | common | Runs down after each wave as it pulls back and races up ahead of the next one, pecking the wet sand; hops up and flutters off from your brush. |
| **Octopus** | shallows (sea) | **40** | 10 | uncommon | Creeps along the bottom near the waterline with its mantle at the surface, changes colour to blend with the sand when still, and squirts a puff of ink when your brush comes near. |
| **Harbor seal** | sand and sea | **48** | 12 | uncommon | Swims in the surf with its head up, then hauls out on the sand to sunbathe and roll; slides back in when the waves reach it. |
| **Sea turtle** | sand and sea | **60** | 15 | rare | Paddles offshore at the surface, crawls up the beach leaving flipper tracks, rests, then crawls back to the sea. |
| **Dolphin** | sea | **80** | 20 | rare | Patrols along the beach past the surf with its fin up, breaches, and spins in the air when fed. |

Food goes where the animal lives: snacks on dry sand bring land and
amphibious animals; snacks tossed into the water (up to 1.5 m deep) float
and bring sea and amphibious animals. Visitor feeding works on every species.

Why these prices: the crab stays at its old 20 bucks. The others are
multiples of 4 so a quarter is a whole number of snacks. Each step up is a
bigger, rarer animal that does more on screen; the dolphin tops out at 80,
under the 100-buck Founder's pack.

## Data model

Migration 35:

- `beach_pets` gets `home_x`, `home_z` (where the pet hangs out; null = the
  default spot). Its owner is the beach's owner.
- `pet_bag`: pets in a player's bag: `id`, `user_id`, `species`, `name`,
  `variant`, `source`, `fed_count`, `hunger_ms` (time since fed when it was
  put away, restored on placing), `created_at`.
- Shop items `pet-sandpiper`, `pet-octopus`, `pet-seal`, `pet-turtle`,
  `pet-dolphin` join `pet-crab`. Products `pet_<species>`, sand bucks only
  (rule 7). None can be traded in (an adopted pet is one of a kind).

## Routes

| Route | What it does |
|---|---|
| `POST /animals/feed {species}` | tosses a snack; counts toward befriending that species (default crab) |
| `POST /pet/adopt {species, mode}` | befriend (bond ≥ that species' feeds) or shop (spends `pet-<species>`) |
| `POST /pet/stow {beachId}` | puts the beach's pet in your bag |
| `POST /pet/place {petId, beachId}` | puts a bagged pet on a beach of yours with no pet |
| `PATCH /pet {home: {x, z}}` | moves the pet's spot on its beach |
| `DELETE /beaches/mine/:id` | puts that beach's pet in the bag before removing it |
| `GET /pet/bag` | your bagged pets |

## State machine

`specs/tla/Pets.tla` (with `Snacks.tla` for feeding, unchanged by species).
Place in three steps (check, insert, delete from the bag) lets two devices
put one pet on two beaches (`NeverTwice`) or lose it when another pet lands
first (`NeverLost`, `OnePlace`). Fixed: `placePet` is one transaction
holding the player lock and the beach lock; `stowPet` holds the beach lock.
Shop placing spends the item in the same transaction (`TokensConserved`).
