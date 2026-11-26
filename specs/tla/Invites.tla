----------------------------- MODULE Invites -----------------------------
(***************************************************************************)
(* Invite bonuses (docs/INVITES_GUIDE.md, docs/SAND_BUCKS.md,              *)
(* docs/STATE_MACHINES.md).                                                *)
(*                                                                         *)
(* One inviter. A new player who came through the inviter's link claims   *)
(* it once (POST /referrals/claim) after signing in: they get Bonus sand  *)
(* bucks, and so does the inviter, for the inviter's first Cap friends.   *)
(* A friend past the cap still gets their own bonus. Each friend may have *)
(* two devices claiming at once (Requests).                                *)
(*                                                                         *)
(* Fixed = FALSE: a claim reads "not claimed yet" and the inviter's count *)
(* in one statement, then writes the referral and both bonuses in         *)
(* another. Fixed = TRUE: one transaction: the referral row (unique per   *)
(* invitee, ON CONFLICT DO NOTHING), its rank (unique per inviter, so a   *)
(* racing friend can't take the same one; the loser retries), and both    *)
(* credits commit together.                                                *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS Friends, Devices, Cap, Bonus, Fixed

Requests == Friends \X Devices

VARIABLES
    claimed,    \* friends with a referral row
    ranks,      \* rewarded ranks taken (the inviter's bonuses)
    friendBal,  \* [Friends -> Nat]: each friend's bucks from the bonus
    inviterBal, \* the inviter's bucks from bonuses
    pc,         \* [Requests -> "idle" | "read" | "done"]
    sawNew,     \* [Requests -> BOOLEAN]: step 1 saw no referral row
    sawRank     \* [Requests -> Nat]: step 1's rank (count of ranks + 1)

vars == <<claimed, ranks, friendBal, inviterBal, pc, sawNew, sawRank>>

Init ==
    /\ claimed = {} /\ ranks = 0
    /\ friendBal = [f \in Friends |-> 0] /\ inviterBal = 0
    /\ pc = [r \in Requests |-> "idle"]
    /\ sawNew = [r \in Requests |-> FALSE]
    /\ sawRank = [r \in Requests |-> 0]

(* Fixed: the whole claim in one transaction *)
ClaimAtomic(r) ==
    LET f == r[1] IN
    /\ Fixed /\ pc[r] = "idle"
    /\ pc' = [pc EXCEPT ![r] = "done"]
    /\ IF f \in claimed
         THEN UNCHANGED <<claimed, ranks, friendBal, inviterBal>>   \* 409: already joined
         ELSE /\ claimed' = claimed \cup {f}
              /\ friendBal' = [friendBal EXCEPT ![f] = @ + Bonus]
              /\ IF ranks < Cap
                   THEN ranks' = ranks + 1 /\ inviterBal' = inviterBal + Bonus
                   ELSE UNCHANGED <<ranks, inviterBal>>
    /\ UNCHANGED <<sawNew, sawRank>>

(* not Fixed, step 1: is there a referral row? what's the next rank? *)
ClaimRead(r) ==
    /\ ~Fixed /\ pc[r] = "idle"
    /\ pc' = [pc EXCEPT ![r] = "read"]
    /\ sawNew' = [sawNew EXCEPT ![r] = r[1] \notin claimed]
    /\ sawRank' = [sawRank EXCEPT ![r] = ranks + 1]
    /\ UNCHANGED <<claimed, ranks, friendBal, inviterBal>>

(* step 2: write what step 1 decided *)
ClaimWrite(r) ==
    LET f == r[1] IN
    /\ pc[r] = "read"
    /\ pc' = [pc EXCEPT ![r] = "done"]
    /\ IF sawNew[r]
         THEN /\ claimed' = claimed \cup {f}
              /\ friendBal' = [friendBal EXCEPT ![f] = @ + Bonus]
              /\ IF sawRank[r] <= Cap
                   THEN ranks' = ranks + 1 /\ inviterBal' = inviterBal + Bonus
                   ELSE UNCHANGED <<ranks, inviterBal>>
         ELSE UNCHANGED <<claimed, ranks, friendBal, inviterBal>>
    /\ UNCHANGED <<sawNew, sawRank>>

Next == \E r \in Requests : ClaimAtomic(r) \/ ClaimRead(r) \/ ClaimWrite(r)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK == claimed \subseteq Friends /\ ranks \in Nat /\ inviterBal \in Nat

\* A friend gets their bonus once, however many devices claim.
OneBonusEach == \A f \in Friends : friendBal[f] = IF f \in claimed THEN Bonus ELSE 0

\* The inviter's bonuses stop at the cap.
CapHolds == inviterBal <= Cap * Bonus

\* Every friend who joined is counted: the inviter got a bonus for each of
\* the first Cap of them, no more and no fewer.
InviterPaid == inviterBal = Bonus * (IF Cardinality(claimed) < Cap THEN Cardinality(claimed) ELSE Cap)
=============================================================================
