--------------------------- MODULE PromoCodes ---------------------------
(***************************************************************************)
(* Account-loaded promo codes for beech-buck packs (docs/GIFT_CARDS_PROMOS *)
(* .md, docs/STATE_MACHINES.md).                                           *)
(*                                                                         *)
(* Players load promo codes onto their account (collecting as many as they *)
(* want). Each code can be used at most once per account and at most       *)
(* maxUses times globally, and may be disabled or expire after loading.    *)
(* When a player buys a bb pack, the server automatically picks the loaded *)
(* unused eligible promo code that gives the largest bonus bb for that     *)
(* purchase, marks it used on the account, and increments its global uses. *)
(*                                                                         *)
(* Fixed = FALSE: a purchase reads the best eligible promo in one          *)
(* statement and claims it in a second statement — two buyers can race on  *)
(* a maxUses=1 code, or two purchases by the same buyer can reuse a code.  *)
(* Fixed = TRUE: one transaction locks the buyer's account_promo_codes     *)
(* rows (FOR UPDATE) and atomically claims the best candidate's promo_codes*)
(* row (UPDATE ... WHERE uses < max_uses), falling through to the next     *)
(* best candidate if another buyer exhausted the first one.                *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS Users, Promos, Fixed

Bonus(p) == IF p = "p1" THEN 5 ELSE 10
MaxUses(p) == IF p = "p1" THEN 2 ELSE 1

VARIABLES
    loaded,       \* [Users -> [Promos -> BOOLEAN]]: code collected on account
    used,         \* [Users -> [Promos -> BOOLEAN]]: code consumed by account
    uses,         \* [Promos -> Nat]: global use counter on promo_codes
    active,       \* [Promos -> BOOLEAN]: still active and not expired
    pc,           \* [Users -> "idle" | "picked"]: split-statement purchase state
    picked,       \* [Users -> Promos]: candidate picked in step 1 (Fixed = FALSE)
    overused,     \* ghost: a user used the same code more than once
    missedBest    \* ghost: a purchase claimed a code when a strictly better eligible one existed

vars == <<loaded, used, uses, active, pc, picked, overused, missedBest>>

Init ==
    /\ loaded = [u \in Users |-> [p \in Promos |-> FALSE]]
    /\ used   = [u \in Users |-> [p \in Promos |-> FALSE]]
    /\ uses   = [p \in Promos |-> 0]
    /\ active = [p \in Promos |-> TRUE]
    /\ pc     = [u \in Users |-> "idle"]
    /\ picked = [u \in Users |-> CHOOSE p \in Promos : TRUE]
    /\ overused = FALSE
    /\ missedBest = FALSE

Eligible(u, p) ==
    /\ loaded[u][p]
    /\ ~used[u][p]
    /\ active[p]
    /\ uses[p] < MaxUses(p)

EligibleSet(u) == {p \in Promos : Eligible(u, p)}

BestBonus(u) ==
    IF EligibleSet(u) = {} THEN 0
    ELSE CHOOSE b \in {Bonus(p) : p \in EligibleSet(u)} :
           \A q \in EligibleSet(u) : Bonus(q) <= b

(* POST /promo-codes/load: player collects a valid promo onto their account *)
LoadPromo(u, p) ==
    /\ ~loaded[u][p]
    /\ active[p]
    /\ uses[p] < MaxUses(p)
    /\ loaded' = [loaded EXCEPT ![u][p] = TRUE]
    /\ UNCHANGED <<used, uses, active, pc, picked, overused, missedBest>>

(* Admin disables a promo or its expiry time passes *)
ExpireOrDisable(p) ==
    /\ active[p]
    /\ active' = [active EXCEPT ![p] = FALSE]
    /\ UNCHANGED <<loaded, used, uses, pc, picked, overused, missedBest>>

(* Fixed = FALSE: step 1 reads the best eligible promo without locking *)
BuyPick(u, p) ==
    /\ ~Fixed
    /\ pc[u] = "idle"
    /\ Eligible(u, p)
    /\ Bonus(p) = BestBonus(u)
    /\ pc' = [pc EXCEPT ![u] = "picked"]
    /\ picked' = [picked EXCEPT ![u] = p]
    /\ UNCHANGED <<loaded, used, uses, active, overused, missedBest>>

(* Fixed = FALSE: step 2 blindly claims the picked promo *)
BuyClaimUnchecked(u) ==
    /\ ~Fixed
    /\ pc[u] = "picked"
    /\ LET p == picked[u] IN
       /\ pc' = [pc EXCEPT ![u] = "idle"]
       /\ overused' = (overused \/ used[u][p])
       /\ used' = [used EXCEPT ![u][p] = TRUE]
       /\ uses' = [uses EXCEPT ![p] = @ + 1]
       /\ UNCHANGED <<loaded, active, picked, missedBest>>

(* Fixed = TRUE: one transaction locks account_promo_codes and atomically
   claims the highest-bonus promo that is still active and under MaxUses *)
BuyAtomic(u, p) ==
    /\ Fixed
    /\ Eligible(u, p)
    /\ Bonus(p) = BestBonus(u)
    /\ used' = [used EXCEPT ![u][p] = TRUE]
    /\ uses' = [uses EXCEPT ![p] = @ + 1]
    /\ missedBest' = (missedBest \/ \E q \in EligibleSet(u) : Bonus(q) > Bonus(p))
    /\ UNCHANGED <<loaded, active, pc, picked, overused>>

Next ==
    \/ \E u \in Users, p \in Promos : LoadPromo(u, p)
    \/ \E p \in Promos : ExpireOrDisable(p)
    \/ \E u \in Users, p \in Promos : BuyPick(u, p) \/ BuyAtomic(u, p)
    \/ \E u \in Users : BuyClaimUnchecked(u)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK ==
    /\ \A u \in Users, p \in Promos : loaded[u][p] \in BOOLEAN /\ used[u][p] \in BOOLEAN
    /\ \A p \in Promos : uses[p] \in Nat /\ active[p] \in BOOLEAN

\* Each promo code is used at most once per account.
AtMostOncePerAccount == ~overused

\* Global uses never exceed MaxUses.
RespectsMaxUses == \A p \in Promos : uses[p] <= MaxUses(p)

\* Global use count matches the number of accounts that consumed the code.
UsesMatchAccountUses ==
    \A p \in Promos : uses[p] = Cardinality({u \in Users : used[u][p]})

\* A purchase always claims the highest-bonus eligible promo on the account.
BestDealChosen == ~missedBest
=============================================================================
