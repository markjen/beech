----------------------------- MODULE PromoBucks -----------------------------
(* Promo codes give bonus beech bucks, never a discount (Mark, 2026-11-27; *)
(* docs/GIFT_CARDS_PROMOS.md, docs/STATE_MACHINES.md). One code, with a    *)
(* cap on uses; each player can use it once, either way:                   *)
(*   Redeem(p)        POST /api/promo/redeem { code }: N bb on its own      *)
(*   Checkout(p)      POST /api/store/web-checkout { productId, promoCode }: *)
(*                    the code is checked and kept on the order, not used    *)
(*   Pay(p)           Xsolla order_paid: the pack is granted, then the code  *)
(*                    is claimed if it's still good (the bonus on top)       *)
(*   Refund(p)        Xsolla refund: the pack's bucks and its bonus go back  *)
(*   Disable          the admin turns the code off                           *)
(*                                                                         *)
(* Fixed = FALSE: a claim reads the code (active, uses under the cap, not   *)
(* used by this player) and then, in another statement, writes the use and *)
(* credits the bonus. Fixed = TRUE: one transaction holding the code's row  *)
(* lock (SELECT ... FOR UPDATE) for the read, the use and the credit.       *)
EXTENDS Integers, FiniteSets

CONSTANTS Players, MaxUses, Fixed

Ways == {"redeem", "pack"}

VARIABLES
    active,     \* promo_codes.active
    uses,       \* promo_codes.uses
    useRows,    \* promo_uses: a set of [player, way]
    bal,        \* [Players -> Int]: bonus bucks credited (net of clawbacks; below 0 is debt)
    order,      \* [Players -> "none" | "created" | "paid" | "refunded"]: one web order each, carrying the code
    bonused,    \* [Players -> BOOLEAN]: that order's bonus was credited
    pc          \* [Players \X Ways -> "idle" | "checked"]: a claim between its read and its write

vars == <<active, uses, useRows, bal, order, bonused, pc>>

Init ==
    /\ active = TRUE
    /\ uses = 0
    /\ useRows = {}
    /\ bal = [p \in Players |-> 0]
    /\ order = [p \in Players |-> "none"]
    /\ bonused = [p \in Players |-> FALSE]
    /\ pc = [k \in Players \X Ways |-> "idle"]

UsedBy(p) == \E u \in useRows : u.player = p
Good(p) == active /\ uses < MaxUses /\ ~UsedBy(p)

(* the claim's write: the use, the count, the bonus *)
Claim(p, way) ==
    /\ useRows' = useRows \cup {[player |-> p, way |-> way]}
    /\ uses' = uses + 1
    /\ bal' = [bal EXCEPT ![p] = @ + 1]

(* POST /promo/redeem: refused (409) when the code isn't good *)
Redeem(p) ==
    /\ pc[<<p, "redeem">>] = "idle"
    /\ Good(p)
    /\ IF Fixed
         THEN Claim(p, "redeem") /\ UNCHANGED <<active, order, bonused, pc>>
         ELSE /\ pc' = [pc EXCEPT ![<<p, "redeem">>] = "checked"]
              /\ UNCHANGED <<active, uses, useRows, bal, order, bonused>>
RedeemWrite(p) ==
    /\ pc[<<p, "redeem">>] = "checked"
    /\ pc' = [pc EXCEPT ![<<p, "redeem">>] = "idle"]
    /\ Claim(p, "redeem")
    /\ UNCHANGED <<active, order, bonused>>

(* web checkout with the code: checked, kept on the order, not claimed *)
Checkout(p) ==
    /\ order[p] = "none"
    /\ Good(p)
    /\ order' = [order EXCEPT ![p] = "created"]
    /\ UNCHANGED <<active, uses, useRows, bal, bonused, pc>>

(* order_paid: the pack always; the bonus only if the code is still good *)
Pay(p) ==
    /\ order[p] = "created" /\ pc[<<p, "pack">>] = "idle"
    /\ IF Fixed
         THEN /\ order' = [order EXCEPT ![p] = "paid"]
              /\ IF Good(p)
                   THEN Claim(p, "pack") /\ bonused' = [bonused EXCEPT ![p] = TRUE]
                   ELSE UNCHANGED <<uses, useRows, bal, bonused>>
              /\ UNCHANGED <<active, pc>>
         ELSE /\ order' = [order EXCEPT ![p] = "paid"]
              /\ pc' = [pc EXCEPT ![<<p, "pack">>] = IF Good(p) THEN "checked" ELSE "idle"]
              /\ UNCHANGED <<active, uses, useRows, bal, bonused>>
PayWrite(p) ==
    /\ pc[<<p, "pack">>] = "checked"
    /\ pc' = [pc EXCEPT ![<<p, "pack">>] = "idle"]
    /\ Claim(p, "pack")
    /\ bonused' = [bonused EXCEPT ![p] = TRUE]
    /\ UNCHANGED <<active, order>>

(* a refund of the pack: its bonus comes back out too; the use stays spent *)
Refund(p) ==
    /\ order[p] = "paid" /\ pc[<<p, "pack">>] = "idle"
    /\ order' = [order EXCEPT ![p] = "refunded"]
    /\ bal' = [bal EXCEPT ![p] = IF bonused[p] THEN @ - 1 ELSE @]
    /\ UNCHANGED <<active, uses, useRows, bonused, pc>>

Disable ==
    /\ active
    /\ active' = FALSE
    /\ UNCHANGED <<uses, useRows, bal, order, bonused, pc>>

Next ==
    \/ \E p \in Players : Redeem(p) \/ RedeemWrite(p) \/ Checkout(p) \/ Pay(p) \/ PayWrite(p) \/ Refund(p)
    \/ Disable

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ active \in BOOLEAN
    /\ uses \in 0..Cardinality(Players) * 2
    /\ bal \in [Players -> -2..4]
    /\ order \in [Players -> {"none", "created", "paid", "refunded"}]
    /\ bonused \in [Players -> BOOLEAN]
    /\ pc \in [Players \X Ways -> {"idle", "checked"}]

(* The game's rules. *)
(* a code is never used more times than its cap *)
WithinCap == uses <= MaxUses
(* each player gets a code's bonus at most once, whichever way *)
OncePerPlayer == \A p \in Players : Cardinality({u \in useRows : u.player = p}) <= 1
(* the count is the uses *)
UsesCounted == uses = Cardinality(useRows)
(* a player's bonus bucks are exactly their redeemed code plus a bonus on a pack still paid for *)
BonusExplained ==
    \A p \in Players :
        bal[p] = (IF [player |-> p, way |-> "redeem"] \in useRows THEN 1 ELSE 0)
                 + (IF bonused[p] /\ order[p] = "paid" THEN 1 ELSE 0)
=============================================================================
