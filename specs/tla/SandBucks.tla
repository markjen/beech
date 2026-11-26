--------------------------- MODULE SandBucks ---------------------------
(***************************************************************************)
(* Sand bucks and trade-ins (docs/SAND_BUCKS.md, docs/STATE_MACHINES.md). *)
(*                                                                         *)
(* Real money only buys sand-buck packs (an App Store / Play / Steam      *)
(* receipt, a paid web order, a gift card). Bucks buy things in the shop. *)
(* Every thing in the bag carries its trade-in value: what was paid for   *)
(* it (a bundle's or promo's price shared out), or its list price when it *)
(* came free. Trading a thing in gives that value back, so buying and     *)
(* trading in again costs nothing. Only things that aren't on a beach can *)
(* be traded in. A refund of a pack takes its bucks back; what can't be   *)
(* taken (already spent) becomes debt, paid off by the next bucks in.     *)
(*                                                                         *)
(* One player and one kind of bag item; units are kept as a count per     *)
(* trade-in value. Gifts out of the bag are modelled; gifts in are a free *)
(* grant whose value is the giver's.                                       *)
(*                                                                         *)
(* Fixed = FALSE: a trade-in checks what's free, then (another statement)  *)
(* takes a unit and credits its value. Fixed = TRUE: one transaction       *)
(* holding the player's lock, which saves, spends and gifts also take.    *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS Requests, Values, Pack, MaxPacks, MaxUnits, Fixed

VARIABLES
    bal,       \* users.credit_cents (in bucks here)
    debt,      \* users.creator_credit_debt_cents: what a clawback couldn't take
    held,      \* [Values -> Nat]: units in the bag, by trade-in value
    placed,    \* units on the beaches (beach.items, summed)
    packs,     \* packs bought and not refunded
    pc,        \* [Requests -> "idle" | "picked"]: a trade-in between its statements
    pick,      \* [Requests -> Values]: the unit it picked
    \* ghosts
    freeIn,    \* value that came free: units (claw, gifts in, rewards) and invite bonuses
    giftOut,   \* value of the units given away
    tradedPlaced \* a trade-in took a unit that was on a beach

vars == <<bal, debt, held, placed, packs, pc, pick, freeIn, giftOut, tradedPlaced>>

RECURSIVE Sum(_)
Sum(S) == IF S = {} THEN 0 ELSE LET v == CHOOSE x \in S : TRUE IN v * held[v] + Sum(S \ {v})
RECURSIVE Count(_)
Count(S) == IF S = {} THEN 0 ELSE LET v == CHOOSE x \in S : TRUE IN held[v] + Count(S \ {v})

Units == Count(Values)
HeldValue == Sum(Values)
Min(a, b) == IF a < b THEN a ELSE b

(* bucks in: pay off debt first (creditBalance) *)
CreditIn(n) ==
    /\ bal' = bal + n - Min(debt, n)
    /\ debt' = debt - Min(debt, n)
(* a clawback: take what's there, the rest becomes debt (clawBack) *)
ClawBack(n) ==
    /\ bal' = bal - Min(bal, n)
    /\ debt' = debt + n - Min(bal, n)

Init ==
    /\ bal = 0 /\ debt = 0
    /\ held = [v \in Values |-> 0]
    /\ placed = 0 /\ packs = 0
    /\ pc = [r \in Requests |-> "idle"]
    /\ pick = [r \in Requests |-> CHOOSE v \in Values : TRUE]
    /\ freeIn = 0 /\ giftOut = 0 /\ tradedPlaced = FALSE

Room == Units < MaxUnits

(* POST /store/purchase, the Xsolla / Steam grant, a gift card: bucks in *)
BuyPack ==
    /\ packs < MaxPacks
    /\ packs' = packs + 1
    /\ CreditIn(Pack)
    /\ UNCHANGED <<held, placed, pc, pick, freeIn, giftOut, tradedPlaced>>

(* a store refund of a pack (revokeStorePurchase) *)
RefundPack ==
    /\ packs > 0
    /\ packs' = packs - 1
    /\ ClawBack(Pack)
    /\ UNCHANGED <<held, placed, pc, pick, freeIn, giftOut, tradedPlaced>>

(* POST /store/buy: one statement debits and grants *)
Spend(v) ==
    /\ Room /\ bal >= v
    /\ bal' = bal - v
    /\ held' = [held EXCEPT ![v] = @ + 1]
    /\ UNCHANGED <<debt, placed, packs, pc, pick, freeIn, giftOut, tradedPlaced>>

(* a claw / vending / dig find / reward / gift in: a unit at its list (or the giver's) value *)
FreeGrant(v) ==
    /\ Room
    /\ held' = [held EXCEPT ![v] = @ + 1]
    /\ freeIn' = freeIn + v
    /\ UNCHANGED <<bal, debt, placed, packs, pc, pick, giftOut, tradedPlaced>>

(* an invite bonus (POST /referrals/claim, Invites.tla): free bucks in, not a unit *)
BonusIn ==
    /\ CreditIn(1)
    /\ freeIn' = freeIn + 1
    /\ UNCHANGED <<held, placed, packs, pc, pick, giftOut, tradedPlaced>>

(* POST /gifts: one unit leaves (with its value) *)
GiftOut(v) ==
    /\ held[v] > 0 /\ Units > placed
    /\ held' = [held EXCEPT ![v] = @ - 1]
    /\ giftOut' = giftOut + v
    /\ UNCHANGED <<bal, debt, placed, packs, pc, pick, freeIn, tradedPlaced>>

(* a device saves a beach: what's placed, within the bag (asEditor) *)
Save(k) ==
    /\ k <= Units
    /\ placed' = k
    /\ UNCHANGED <<bal, debt, held, packs, pc, pick, freeIn, giftOut, tradedPlaced>>

(* POST /bag/trade-in, Fixed = FALSE: step 1, is one free? pick the newest unit *)
TradeCheck(r, v) ==
    /\ ~Fixed /\ pc[r] = "idle"
    /\ held[v] > 0 /\ Units - placed >= 1
    /\ pc' = [pc EXCEPT ![r] = "picked"]
    /\ pick' = [pick EXCEPT ![r] = v]
    /\ UNCHANGED <<bal, debt, held, placed, packs, freeIn, giftOut, tradedPlaced>>

(* step 2: UPDATE inventory SET quantity = quantity - 1 ..., credit its value *)
TradeWrite(r) ==
    /\ pc[r] = "picked"
    /\ pc' = [pc EXCEPT ![r] = "idle"]
    /\ held' = [held EXCEPT ![pick[r]] = @ - 1]
    /\ tradedPlaced' = (tradedPlaced \/ Units - placed < 1)
    /\ CreditIn(pick[r])
    /\ UNCHANGED <<placed, packs, pick, freeIn, giftOut>>

(* Fixed = TRUE: check, take and credit in one transaction under the player lock *)
TradeAtomic(v) ==
    /\ Fixed
    /\ held[v] > 0 /\ Units - placed >= 1
    /\ held' = [held EXCEPT ![v] = @ - 1]
    /\ CreditIn(v)
    /\ UNCHANGED <<placed, packs, pc, pick, freeIn, giftOut, tradedPlaced>>

Next ==
    \/ BuyPack \/ RefundPack \/ BonusIn
    \/ \E v \in Values : Spend(v) \/ FreeGrant(v) \/ GiftOut(v) \/ TradeAtomic(v)
    \/ \E k \in 0..MaxUnits : Save(k)
    \/ \E r \in Requests : TradeWrite(r) \/ \E v \in Values : TradeCheck(r, v)

Spec == Init /\ [][Next]_vars

\* keep the state space finite (bucks only grow through free grants and packs)
Bound == bal <= 6 /\ debt <= 4 /\ freeIn <= 4 /\ giftOut <= 4

-----------------------------------------------------------------------------
TypeOK ==
    /\ bal \in Nat /\ debt \in Nat
    /\ placed \in 0..MaxUnits

\* No unit is taken that isn't there (a trade-in never mints bucks from nothing).
NoPhantomUnits == \A v \in Values : held[v] >= 0

\* Bucks and bag value only move: spending and trading in are even swaps, and
\* everything that's there came from packs (net of refunds) or free grants.
ValueConserved == bal - debt + HeldValue = packs * Pack + freeIn - giftOut

\* A trade-in never takes a thing that's on a beach.
NeverTradePlaced == ~tradedPlaced

\* A balance is never negative; what a refund couldn't take is debt.
NoNegative == bal >= 0 /\ debt >= 0
=============================================================================
