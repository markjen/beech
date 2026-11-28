------------------------------- MODULE Claw -------------------------------
(***************************************************************************)
(* The claw and vending machines (docs/PRICING.md, docs/STATE_MACHINES.md).*)
(*                                                                         *)
(* POST /pulls/:pool: a free go. The server reads the player's go count   *)
(* (pull_state.count), draws (a fixed starter gift for the first goes on  *)
(* the claw, otherwise a normal prize, a unique one-of-a-kind item from   *)
(* the vending set, or a miss: the claw drops the ball), claims a unique  *)
(* item for the player first (unique_items, ON CONFLICT ... WHERE owner   *)
(* IS NULL; taken already: a rare instead), then claims the go and grants *)
(* the prize. A claim that loses releases its unique item again (only its *)
(* own claim: owner = me AND found_at = now). After a go the machine      *)
(* rests (Tick ends the rest).                                             *)
(*                                                                         *)
(* POST /pulls/:pool/paid: one more try for beech bucks. Same draw, never *)
(* a starter, never touches the free go; the price is debited and the     *)
(* prize granted together, or a broke player gets 402 and nothing.        *)
(*                                                                         *)
(* One player pulls from two devices at once (Requests), and a second    *)
(* player from one, so a unique item has someone to race.                 *)
(*                                                                         *)
(* Fixed = FALSE: the obvious build. The free claim reads "is the go      *)
(* free?" then writes in another statement, and doesn't re-check the go   *)
(* count it drew the starter for; the paid try reads the balance, then    *)
(* debits. Fixed = TRUE (the code): one statement each,                   *)
(*   UPDATE pull_state ... WHERE next_at <= now AND count = $seen         *)
(* with the pull log and the grant in the same statement, and             *)
(* claimPaidPull's UPDATE users ... WHERE credit_cents >= price.          *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS Me, Other, Devices, Starters, MaxGoes, Price, StartBucks, Fixed

\* Me pulls from two devices at once; Other, from one (enough to race a unique)
Players == {Me, Other}
Requests == ({Me} \X Devices) \cup {<<Other, 1>>}
None == "none"
StarterNames == <<"s1", "s2">>                \* Starters <= 2
StarterPrizes == {StarterNames[k] : k \in 1..Starters}
Drawn == {"common", "unique", "miss"}          \* a normal draw
Prizes == StarterPrizes \cup {"common", "unique"}

VARIABLES
    count,      \* [Players -> Nat]: pull_state.count (free goes taken)
    resting,    \* [Players -> BOOLEAN]: next_at > now
    bucks,      \* [Players -> Nat]: credit
    owner,      \* unique_items.owner_id of the one unique item, or None
    bag,        \* [Players -> [Prizes -> Nat]]: inventory from pulls
    pc,         \* [Requests -> "idle" | "drawn" | "claimed" | "checked" | "release"]
    kind,       \* [Requests -> "free" | "paid"]
    saw,        \* [Requests -> Nat]: the go count read before the draw
    prize,      \* [Requests -> Prizes \cup {"miss"}]: what the draw gave
    held,       \* [Requests -> BOOLEAN]: this request holds the unique claim
    goes,       \* ghost: [Players -> Nat] free goes claimed in this rest
    paid        \* ghost: [Players -> Nat] paid tries charged

vars == <<count, resting, bucks, owner, bag, pc, kind, saw, prize, held, goes, paid>>
player(r) == r[1]

Init ==
    /\ count = [p \in Players |-> 0]
    /\ resting = [p \in Players |-> FALSE]
    /\ bucks = [p \in Players |-> StartBucks]
    /\ owner = None
    /\ bag = [p \in Players |-> [x \in Prizes |-> 0]]
    /\ pc = [r \in Requests |-> "idle"]
    /\ kind = [r \in Requests |-> "free"]
    /\ saw = [r \in Requests |-> 0]
    /\ prize = [r \in Requests |-> "miss"]
    /\ held = [r \in Requests |-> FALSE]
    /\ goes = [p \in Players |-> 0]
    /\ paid = [p \in Players |-> 0]

Grant(p, x) == bag' = IF x = "miss" THEN bag ELSE [bag EXCEPT ![p][x] = @ + 1]

(* Read the go count and draw (free), or just draw (paid). A drawn unique *)
(* is claimed for the player in its own statement before the go is.       *)
ClaimUnique(r, x) ==
    IF x = "unique"
      THEN IF owner = None
             THEN owner' = player(r) /\ held' = [held EXCEPT ![r] = TRUE] /\ prize' = [prize EXCEPT ![r] = "unique"]
             ELSE UNCHANGED <<owner, held>> /\ prize' = [prize EXCEPT ![r] = "common"]   \* someone has it: a rare
      ELSE UNCHANGED <<owner, held>> /\ prize' = [prize EXCEPT ![r] = x]

FreeDraw(r) ==
    LET p == player(r) IN
    /\ pc[r] = "idle" /\ count[p] < MaxGoes
    /\ saw' = [saw EXCEPT ![r] = count[p]]
    /\ kind' = [kind EXCEPT ![r] = "free"]
    /\ pc' = [pc EXCEPT ![r] = "drawn"]
    /\ IF count[p] + 1 <= Starters
         THEN prize' = [prize EXCEPT ![r] = StarterNames[count[p] + 1]] /\ UNCHANGED <<owner, held>>
         ELSE \E x \in Drawn : ClaimUnique(r, x)
    /\ UNCHANGED <<count, resting, bucks, bag, goes, paid>>

PaidDraw(r) ==
    /\ pc[r] = "idle" /\ paid[player(r)] < MaxGoes
    /\ kind' = [kind EXCEPT ![r] = "paid"]
    /\ pc' = [pc EXCEPT ![r] = "drawn"]
    /\ \E x \in Drawn : ClaimUnique(r, x)
    /\ UNCHANGED <<count, resting, bucks, bag, saw, goes, paid>>

Lost(r) == pc' = [pc EXCEPT ![r] = IF held[r] THEN "release" ELSE "idle"]

TakeGo(r) ==
    LET p == player(r) IN
    /\ count' = [count EXCEPT ![p] = @ + 1]
    /\ resting' = [resting EXCEPT ![p] = TRUE]
    /\ goes' = [goes EXCEPT ![p] = @ + 1]
    /\ Grant(p, prize[r])
    /\ held' = [held EXCEPT ![r] = FALSE]
    /\ pc' = [pc EXCEPT ![r] = "idle"]

(* Fixed: the claim, the log and the grant in one statement *)
FreeClaim(r) ==
    LET p == player(r) IN
    /\ Fixed /\ pc[r] = "drawn" /\ kind[r] = "free"
    /\ IF ~resting[p] /\ count[p] = saw[r]
         THEN TakeGo(r)
         ELSE Lost(r) /\ UNCHANGED <<count, resting, goes, bag, held>>      \* 409: resting
    /\ UNCHANGED <<bucks, owner, kind, saw, prize, paid>>

(* not Fixed: "is it free?", then the write *)
FreeCheck(r) ==
    LET p == player(r) IN
    /\ ~Fixed /\ pc[r] = "drawn" /\ kind[r] = "free"
    /\ IF ~resting[p]
         THEN pc' = [pc EXCEPT ![r] = "checked"]
         ELSE Lost(r)
    /\ UNCHANGED <<count, resting, bucks, owner, bag, kind, saw, prize, held, goes, paid>>
FreeWrite(r) ==
    /\ pc[r] = "checked" /\ kind[r] = "free"
    /\ TakeGo(r)
    /\ UNCHANGED <<bucks, owner, kind, saw, prize, paid>>

Charge(r) ==
    LET p == player(r) IN
    /\ bucks' = [bucks EXCEPT ![p] = @ - Price]
    /\ paid' = [paid EXCEPT ![p] = @ + 1]
    /\ Grant(p, prize[r])
    /\ held' = [held EXCEPT ![r] = FALSE]
    /\ pc' = [pc EXCEPT ![r] = "idle"]

(* Fixed: claimPaidPull, one statement *)
PaidClaim(r) ==
    LET p == player(r) IN
    /\ Fixed /\ pc[r] = "drawn" /\ kind[r] = "paid"
    /\ IF bucks[p] >= Price
         THEN Charge(r)
         ELSE Lost(r) /\ UNCHANGED <<bucks, paid, bag, held>>               \* 402
    /\ UNCHANGED <<count, resting, owner, kind, saw, prize, goes>>

PaidCheck(r) ==
    LET p == player(r) IN
    /\ ~Fixed /\ pc[r] = "drawn" /\ kind[r] = "paid"
    /\ IF bucks[p] >= Price THEN pc' = [pc EXCEPT ![r] = "checked"] ELSE Lost(r)
    /\ UNCHANGED <<count, resting, bucks, owner, bag, kind, saw, prize, held, goes, paid>>
PaidWrite(r) ==
    /\ pc[r] = "checked" /\ kind[r] = "paid"
    /\ Charge(r)
    /\ UNCHANGED <<count, resting, owner, kind, saw, prize, goes>>

(* unique.release(): only this request's own claim *)
Release(r) ==
    /\ pc[r] = "release"
    /\ owner' = IF owner = player(r) THEN None ELSE owner
    /\ held' = [held EXCEPT ![r] = FALSE]
    /\ pc' = [pc EXCEPT ![r] = "idle"]
    /\ UNCHANGED <<count, resting, bucks, bag, kind, saw, prize, goes, paid>>

(* the rest runs out (the clock passes next_at) *)
Tick(p) ==
    /\ resting[p]
    /\ resting' = [resting EXCEPT ![p] = FALSE]
    /\ goes' = [goes EXCEPT ![p] = 0]
    /\ UNCHANGED <<count, bucks, owner, bag, pc, kind, saw, prize, held, paid>>

Next ==
    \/ \E r \in Requests :
         FreeDraw(r) \/ PaidDraw(r) \/ FreeClaim(r) \/ FreeCheck(r) \/ FreeWrite(r)
         \/ PaidClaim(r) \/ PaidCheck(r) \/ PaidWrite(r) \/ Release(r)
    \/ \E p \in Players : Tick(p)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK ==
    /\ count \in [Players -> 0..MaxGoes + 2]
    /\ owner \in Players \cup {None}
    /\ bucks \in [Players -> Int]

\* One free go per rest, however many devices pull at once.
OneGoPerRest == \A p \in Players : goes[p] <= 1

\* Each starter gift is given once.
StarterOnce == \A p \in Players : \A x \in StarterPrizes : bag[p][x] <= 1

\* The unique item is in at most one bag, and only its owner's.
UniqueOnce ==
    /\ (\A p \in Players : bag[p]["unique"] > 0 => owner = p)
    /\ Cardinality({p \in Players : bag[p]["unique"] > 0}) <= 1
    /\ \A p \in Players : bag[p]["unique"] <= 1

\* A paid try is charged exactly its price, and a balance never goes below 0.
PaidInFull == \A p \in Players : bucks[p] = StartBucks - Price * paid[p] /\ bucks[p] >= 0

\* A unique claim is never left behind: its owner has it, or a request
\* holding the claim is still on its way to granting or releasing it.
NoStrandedUnique ==
    owner # None => (bag[owner]["unique"] > 0 \/ \E r \in Requests : player(r) = owner /\ held[r])
=============================================================================
