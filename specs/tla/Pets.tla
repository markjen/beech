----------------------------- MODULE Pets -----------------------------
(***************************************************************************)
(* Pets as things you own and move (docs/PETS.md).                         *)
(*                                                                         *)
(* One owner, a few beaches, a few pets. A pet is always in exactly one    *)
(* place: on one beach (beach_pets) or in the owner's bag (pet_bag). The   *)
(* owner puts a pet in the bag (Stow), puts a pet from the bag on a beach  *)
(* (Place), or puts a shop pet on a beach (ShopPlace, which spends the     *)
(* pet-<species> item). Moving a pet to another beach is Stow then Place.  *)
(* Two devices can send requests at once, so two Place requests can race. *)
(*                                                                         *)
(* Fixed = FALSE: Place reads the bag and the beach, inserts the beach_pets *)
(* row (ON CONFLICT DO NOTHING), then deletes the bag row: three steps.    *)
(* Fixed = TRUE: Place is one transaction holding the player lock and the  *)
(* beach lock (server/src/pets.ts, placePet).                              *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS
    Beaches,        \* the owner's beaches
    Pets,           \* pets the owner has adopted (start in the bag)
    Tokens0,        \* shop pet items in the bag at the start
    Requests,       \* concurrent Place requests (two devices)
    Fixed

None == "none"

VARIABLES
    onBeach,        \* [Beaches -> Pets \cup {None}]: beach_pets (one per beach: the primary key)
    bag,            \* SUBSET Pets: pet_bag rows
    tokens,         \* pet-<species> shop items in the bag
    shopPets,       \* how many pets were made from shop items (ghost: fresh ids)
    pc,             \* [Requests -> [st: {"idle","checked","inserted"}, pet, beach]]
    lost            \* ghost: pets deleted from the bag whose insert did nothing

vars == <<onBeach, bag, tokens, shopPets, pc, lost>>

Idle == [st |-> "idle", pet |-> None, beach |-> None]

TypeOK ==
    /\ onBeach \in [Beaches -> Pets \cup {None} \cup {"shop"}]
    /\ bag \subseteq Pets
    /\ tokens \in 0..Tokens0
    /\ lost \subseteq Pets

Init ==
    /\ onBeach = [b \in Beaches |-> None]
    /\ bag = Pets
    /\ tokens = Tokens0
    /\ shopPets = 0
    /\ pc = [r \in Requests |-> Idle]
    /\ lost = {}

Empty(b) == onBeach[b] = None

(* POST /pet/stow: one transaction under the beach lock. *)
Stow(b) ==
    /\ onBeach[b] \in Pets
    /\ bag' = bag \cup {onBeach[b]}
    /\ onBeach' = [onBeach EXCEPT ![b] = None]
    /\ UNCHANGED <<tokens, shopPets, pc, lost>>

(* POST /pet/place {petId}: check, insert, delete from the bag. *)
PlaceCheck(r, p, b) ==
    /\ pc[r].st = "idle" /\ p \in bag /\ Empty(b)
    /\ IF Fixed
         THEN /\ onBeach' = [onBeach EXCEPT ![b] = p]
              /\ bag' = bag \ {p}
              /\ UNCHANGED <<pc, lost>>
         ELSE /\ pc' = [pc EXCEPT ![r] = [st |-> "checked", pet |-> p, beach |-> b]]
              /\ UNCHANGED <<onBeach, bag, lost>>
    /\ UNCHANGED <<tokens, shopPets>>

PlaceInsert(r) ==
    /\ pc[r].st = "checked"
    /\ LET b == pc[r].beach p == pc[r].pet IN
       onBeach' = IF Empty(b) THEN [onBeach EXCEPT ![b] = p] ELSE onBeach   \* ON CONFLICT DO NOTHING
    /\ pc' = [pc EXCEPT ![r].st = "inserted"]
    /\ UNCHANGED <<bag, tokens, shopPets, lost>>

PlaceDelete(r) ==
    /\ pc[r].st = "inserted"
    /\ LET b == pc[r].beach p == pc[r].pet IN
       /\ bag' = bag \ {p}
       /\ lost' = IF onBeach[b] # p /\ \A c \in Beaches : onBeach[c] # p THEN lost \cup {p} ELSE lost
    /\ pc' = [pc EXCEPT ![r] = Idle]
    /\ UNCHANGED <<onBeach, tokens, shopPets>>

(* POST /pet/adopt {mode: shop}: one transaction under the beach lock. *)
ShopPlace(b) ==
    /\ tokens > 0 /\ Empty(b)
    /\ tokens' = tokens - 1
    /\ onBeach' = [onBeach EXCEPT ![b] = "shop"]
    /\ shopPets' = shopPets + 1
    /\ UNCHANGED <<bag, pc, lost>>

Next ==
    \/ \E b \in Beaches : Stow(b) \/ ShopPlace(b)
    \/ \E r \in Requests, p \in Pets, b \in Beaches : PlaceCheck(r, p, b)
    \/ \E r \in Requests : PlaceInsert(r) \/ PlaceDelete(r)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Invariants *)

PlacesOf(p) == {b \in Beaches : onBeach[b] = p}
InFlight(p) == {r \in Requests : pc[r].pet = p /\ pc[r].st # "idle"}

\* A pet is never on two beaches at once.
NeverTwice == \A p \in Pets : Cardinality(PlacesOf(p)) <= 1

\* A pet is never lost: it's on a beach, in the bag, or a Place is still under way.
NeverLost == \A p \in Pets : Cardinality(PlacesOf(p)) + (IF p \in bag THEN 1 ELSE 0) >= 1
                                \/ InFlight(p) # {}

\* No pet ends up both in the bag and on a beach once requests are done.
OnePlace == (\A r \in Requests : pc[r].st = "idle") =>
              \A p \in Pets : Cardinality(PlacesOf(p)) + (IF p \in bag THEN 1 ELSE 0) = 1

\* A shop pet item becomes exactly one pet.
TokensConserved == tokens + shopPets = Tokens0
                   /\ shopPets >= Cardinality({b \in Beaches : onBeach[b] = "shop"})

Invariants == NeverTwice /\ NeverLost /\ OnePlace /\ TokensConserved
=============================================================================
