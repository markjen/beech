---------------------------- MODULE Snacks ----------------------------
(***************************************************************************)
(* Beach snacks and pets on one beach (docs/STATE_MACHINES.md).            *)
(*                                                                         *)
(* The owner tosses snacks (one out at a time), picks them back up, lets   *)
(* them be eaten (expire), befriends a wild crab after Threshold feeds or  *)
(* adopts one from the shop. Visitors feed the pet: once a day for free,   *)
(* then with their own snacks.                                             *)
(*                                                                         *)
(* Route handlers that are not one transaction are split into steps, so    *)
(* TLC explores other requests landing between them (as on Postgres, and   *)
(* as on PGlite between awaits). Fixed = TRUE models the transactional     *)
(* versions (server/src/animals.ts after the fix).                         *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS
    Threshold,      \* BEFRIEND_FEED_THRESHOLD (10 in the game; small here)
    Snacks0,        \* snacks in each player's bag at the start
    Requests,       \* concurrent visitor feed requests (all from one visitor)
    MaxT,           \* bound on the logical clock, to keep the model finite
    Fixed           \* TRUE: adopt and visitor feeds are atomic (the fix)

Players == {"owner", "visitor"}
None == "none"

VARIABLES
    bag,            \* [Players -> Nat]: beach snacks in each bag
    petItem,        \* the owner's shop pet-crab items (0 or 1)
    snack,          \* the snack out on the beach (beach_snacks row)
    progress,       \* wild_feed_progress.feed_count
    pet,            \* beach_pets row, or [exists |-> FALSE, ...]
    t,              \* logical clock: each feed gets a fresh time
    fedToday,       \* visitors with a pet_feed_log row today
    pcAdopt,        \* befriend adopt: "idle" | "checked"
    pcShop,         \* shop adopt: "idle" | "consumed"
    pcVisit,        \* [Requests -> "idle" | "free" | "paid"]
    \* ghosts (not in the database; used by the invariants)
    gone,           \* the owner's snacks that are gone for good (eaten)
    wildNet,        \* wild feeds that still count (tossed, not picked up)
    befriendedAt,   \* wildNet when a befriended pet moved in (-1: none yet)
    freeFeeds       \* [Requests -> Nat]: free feeds the visitor got today

vars == <<bag, petItem, snack, progress, pet, t, fedToday, pcAdopt, pcShop,
          pcVisit, gone, wildNet, befriendedAt, freeFeeds>>

NoSnack == [out |-> FALSE, fresh |-> FALSE, wild |-> FALSE, at |-> 0, prev |-> 0]
NoPet == [exists |-> FALSE, src |-> None, fed |-> 0, last |-> 0]

TypeOK ==
    /\ bag \in [Players -> 0..Snacks0]
    /\ petItem \in 0..1
    /\ progress \in Nat
    /\ t \in 0..MaxT
    /\ pcAdopt \in {"idle", "checked"}
    /\ pcShop \in {"idle", "consumed"}
    /\ pcVisit \in [Requests -> {"idle", "free", "paid"}]

Init ==
    /\ bag = [p \in Players |-> Snacks0]
    /\ petItem = 1
    /\ snack = NoSnack
    /\ progress = 0
    /\ pet = NoPet
    /\ t = 0
    /\ fedToday = {}
    /\ pcAdopt = "idle"
    /\ pcShop = "idle"
    /\ pcVisit = [r \in Requests |-> "idle"]
    /\ gone = 0
    /\ wildNet = 0
    /\ befriendedAt = -1
    /\ freeFeeds = [r \in Requests |-> 0]

Returnable == snack.out /\ snack.fresh
\* a snack out that can't be picked up any more was eaten
GoneIfReplaced == IF Returnable THEN 1 ELSE 0

(* POST /animals/feed: one transaction holding the beach lock. *)
Toss ==
    /\ bag["owner"] > 0 /\ t < MaxT
    /\ bag' = [bag EXCEPT !["owner"] = @ - 1]
    /\ t' = t + 1
    /\ gone' = gone + GoneIfReplaced           \* the earlier snack is replaced
    /\ IF pet.exists
         THEN /\ snack' = [out |-> TRUE, fresh |-> TRUE, wild |-> FALSE, at |-> t + 1, prev |-> pet.last]
              /\ pet' = [pet EXCEPT !.fed = @ + 1, !.last = t + 1]
              /\ UNCHANGED <<progress, wildNet>>
         ELSE /\ snack' = [out |-> TRUE, fresh |-> TRUE, wild |-> TRUE, at |-> t + 1, prev |-> 0]
              /\ progress' = progress + 1
              /\ wildNet' = wildNet + 1
              /\ UNCHANGED pet
    /\ UNCHANGED <<petItem, fedToday, pcAdopt, pcShop, pcVisit, befriendedAt, freeFeeds>>

(* POST /animals/feed/return: one transaction holding the beach lock. *)
PickUp ==
    /\ Returnable
    /\ bag' = [bag EXCEPT !["owner"] = @ + 1]
    /\ snack' = NoSnack
    /\ IF snack.wild
         THEN /\ progress' = IF progress > 0 THEN progress - 1 ELSE 0
              /\ wildNet' = wildNet - 1
              /\ UNCHANGED pet
         ELSE /\ pet' = IF pet.exists /\ pet.last = snack.at
                          THEN [pet EXCEPT !.last = snack.prev, !.fed = IF @ > 0 THEN @ - 1 ELSE 0]
                          ELSE pet
              /\ UNCHANGED <<progress, wildNet>>
    /\ UNCHANGED <<petItem, t, fedToday, pcAdopt, pcShop, pcVisit, gone, befriendedAt, freeFeeds>>

(* SNACK_OUT_MS passes: the snack was eaten and can't be picked up. *)
Eaten ==
    /\ Returnable
    /\ snack' = [snack EXCEPT !.fresh = FALSE]
    /\ gone' = gone + 1
    /\ UNCHANGED <<bag, petItem, progress, pet, t, fedToday, pcAdopt, pcShop, pcVisit, wildNet, befriendedAt, freeFeeds>>

(* POST /pet/adopt {mode: befriend}. adoptPet reads the bond, then inserts. *)
AdoptBefriend ==
    /\ befriendedAt' = wildNet
    /\ pet' = [exists |-> TRUE, src |-> "befriended", fed |-> 1, last |-> t]
    /\ progress' = 0
    /\ gone' = gone + GoneIfReplaced          \* the befriended crab ate the snack out
    /\ snack' = NoSnack

AdoptCheck ==
    /\ pcAdopt = "idle" /\ ~pet.exists /\ progress >= Threshold
    /\ IF Fixed
         THEN /\ AdoptBefriend                \* one transaction under the beach lock
              /\ UNCHANGED pcAdopt
         ELSE /\ pcAdopt' = "checked"
              /\ UNCHANGED <<pet, progress, gone, snack, befriendedAt>>
    /\ UNCHANGED <<bag, petItem, t, fedToday, pcShop, pcVisit, wildNet, freeFeeds>>

AdoptInsert ==
    /\ pcAdopt = "checked"
    /\ pcAdopt' = "idle"
    /\ IF pet.exists
         THEN UNCHANGED <<pet, progress, gone, snack, befriendedAt>>   \* ON CONFLICT DO NOTHING
         ELSE AdoptBefriend
    /\ UNCHANGED <<bag, petItem, t, fedToday, pcShop, pcVisit, wildNet, freeFeeds>>

(* POST /pet/adopt {mode: shop}: spend the pet-crab, insert, refund on a clash. *)
ShopConsume ==
    /\ pcShop = "idle" /\ petItem > 0 /\ ~pet.exists
    /\ petItem' = petItem - 1
    /\ pcShop' = "consumed"
    /\ UNCHANGED <<bag, snack, progress, pet, t, fedToday, pcAdopt, pcVisit, gone, wildNet, befriendedAt, freeFeeds>>

ShopInsert ==
    /\ pcShop = "consumed"
    /\ pcShop' = "idle"
    /\ IF pet.exists
         THEN /\ petItem' = petItem + 1 /\ UNCHANGED pet
         ELSE /\ pet' = [exists |-> TRUE, src |-> "shop", fed |-> 1, last |-> t]
              /\ UNCHANGED petItem
    /\ UNCHANGED <<bag, snack, progress, t, fedToday, pcAdopt, pcVisit, gone, wildNet, befriendedAt, freeFeeds>>

(* POST /beaches/:code/pet/feed by the visitor: hasVisitorFedToday, then feed. *)
FeedPet(r, free) ==
    /\ pet' = [pet EXCEPT !.fed = @ + 1, !.last = t + 1]
    /\ t' = t + 1
    /\ fedToday' = fedToday \cup {"visitor"}
    /\ freeFeeds' = IF free THEN [freeFeeds EXCEPT ![r] = @ + 1] ELSE freeFeeds

VisitCheck(r) ==
    /\ pcVisit[r] = "idle" /\ pet.exists /\ t < MaxT
    /\ LET free == "visitor" \notin fedToday IN
       IF Fixed
         THEN \* one transaction under the beach lock
              IF free
                THEN /\ FeedPet(r, TRUE) /\ UNCHANGED <<bag, pcVisit>>
                ELSE IF bag["visitor"] > 0
                       THEN /\ bag' = [bag EXCEPT !["visitor"] = @ - 1]
                            /\ FeedPet(r, FALSE) /\ UNCHANGED pcVisit
                       ELSE UNCHANGED <<bag, pet, t, fedToday, freeFeeds, pcVisit>>
         ELSE /\ pcVisit' = [pcVisit EXCEPT ![r] = IF free THEN "free" ELSE "paid"]
              /\ UNCHANGED <<bag, pet, t, fedToday, freeFeeds>>
    /\ UNCHANGED <<petItem, snack, progress, pcAdopt, pcShop, gone, wildNet, befriendedAt>>

VisitFeed(r) ==
    /\ pcVisit[r] # "idle" /\ t < MaxT
    /\ pcVisit' = [pcVisit EXCEPT ![r] = "idle"]
    /\ IF pcVisit[r] = "free"
         THEN FeedPet(r, TRUE) /\ UNCHANGED bag
         ELSE IF bag["visitor"] > 0
                THEN /\ bag' = [bag EXCEPT !["visitor"] = @ - 1]
                     /\ FeedPet(r, FALSE)
                ELSE UNCHANGED <<bag, pet, t, fedToday, freeFeeds>>
    /\ UNCHANGED <<petItem, snack, progress, pcAdopt, pcShop, gone, wildNet, befriendedAt>>

Next ==
    \/ Toss \/ PickUp \/ Eaten
    \/ AdoptCheck \/ AdoptInsert
    \/ ShopConsume \/ ShopInsert
    \/ \E r \in Requests : VisitCheck(r) \/ VisitFeed(r)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Invariants *)

\* Every one of the owner's snacks is in the bag, out on the sand, or eaten.
SnacksConserved == bag["owner"] + (IF Returnable THEN 1 ELSE 0) + gone = Snacks0

\* The bond counter is exactly the wild feeds that still count.
ProgressMatches == ~pet.exists => progress = wildNet

\* A befriended crab took Threshold feeds that were never taken back.
BefriendedFairly == befriendedAt # -1 => befriendedAt >= Threshold

\* One free feed per visitor per day, however many requests race.
OneFreeFeedADay == \A r \in Requests : freeFeeds[r] + (IF Cardinality(Requests) > 1
                         THEN freeFeeds[CHOOSE q \in Requests \ {r} : TRUE] ELSE 0) <= 1

\* At most one pet, and the shop pet-crab is never lost or duplicated.
PetItemConserved == petItem + (IF pcShop = "consumed" THEN 1 ELSE 0)
                    + (IF pet.src = "shop" THEN 1 ELSE 0) = 1

Invariants == SnacksConserved /\ BefriendedFairly /\ OneFreeFeedADay /\ PetItemConserved
=============================================================================
