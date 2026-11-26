----------------------------- MODULE Piers -----------------------------
\* Piers (docs/PIERS.md): a pier is a bag item, bought with sand bucks, that
\* lands on the middle of three side-by-side beaches of one owner.
\*
\* A link <<a,b>> means b is immediately right of a, with a reciprocally left.
\* `owned` is how many piers the player has (inventory rows); `site[b]` is
\* how many attachments beach b holds (beach_piers rows). Attachments are
\* counted against what's owned: the bag shows owned minus attached. A
\* stored attachment whose beach no longer qualifies is dormant ("paused"):
\* it still holds its pier and its beach's slot, and shows again when the
\* beach qualifies again. Visibility is derived, never stored.
EXTENDS Naturals, FiniteSets

CONSTANTS Beaches, Own, Home, MaxOwned, Fixed

VARIABLES beaches, links, owned, site, checked, validLand

vars == <<beaches, links, owned, site, checked, validLand>>

Eligible(b) ==
    /\ b \in beaches \cap Own
    /\ \E l, r \in (beaches \cap Own) \ {b} :
         /\ l # r
         /\ <<l, b>> \in links
         /\ <<b, r>> \in links

RECURSIVE SumOver(_)
SumOver(S) == IF S = {} THEN 0 ELSE LET b == CHOOSE x \in S : TRUE IN site[b] + SumOver(S \ {b})
Attached == SumOver(Beaches)
Visible(b) == site[b] > 0 /\ Eligible(b)

TypeOK ==
    /\ beaches \subseteq Beaches
    /\ links \subseteq beaches \X beaches
    /\ owned \in 0..MaxOwned
    /\ site \in [Beaches -> 0..2]
    /\ checked \in SUBSET Own
    /\ validLand \in BOOLEAN

\* Every attachment is a pier the player still owns (no pier from nowhere).
PaidAttachment == Attached <= owned
\* A beach holds at most one pier.
OnePerBeach == \A b \in Beaches : site[b] <= 1
\* Only a deleted beach's attachment goes; nothing else lingers on it.
NoOrphan == \A b \in Beaches \ beaches : site[b] = 0
\* Every placement landed on a beach that qualified at that moment.
PlacementWasEligible == validLand

Init ==
    /\ beaches = Beaches
    /\ links = {}
    /\ owned = 0
    /\ site = [b \in Beaches |-> 0]
    /\ checked = {}
    /\ validLand = TRUE

\* Existing neighbor routes (link() locks both beach rows).
Link(l, r) ==
    /\ l # r
    /\ <<r, l>> \notin links
    /\ \A b \in beaches : <<l, b>> \notin links /\ <<b, r>> \notin links
    /\ links' = links \cup {<<l, r>>}
    /\ UNCHANGED <<beaches, owned, site, checked, validLand>>

Unlink(l, r) ==
    /\ <<l, r>> \in links
    /\ links' = links \ {<<l, r>>}
    /\ UNCHANGED <<beaches, owned, site, checked, validLand>>

\* DELETE beach: its links and its attachment cascade; the pier is back in the bag.
DeleteBeach(b) ==
    /\ b # Home
    /\ beaches' = beaches \ {b}
    /\ links' = {e \in links : e[1] # b /\ e[2] # b}
    /\ site' = [site EXCEPT ![b] = 0]
    /\ UNCHANGED <<owned, checked, validLand>>

\* POST /store/buy: one statement spends the bucks and adds the pier to the bag.
Buy ==
    /\ owned < MaxOwned
    /\ owned' = owned + 1
    /\ UNCHANGED <<beaches, links, site, checked, validLand>>

\* A pier leaving the bag: a trade-in or a gift. The design counts attached
\* piers as placed, under the player's lock. The other form only asks
\* "does the player own one?".
GiveAway ==
    /\ owned > 0
    /\ Fixed => owned > Attached
    /\ owned' = owned - 1
    /\ UNCHANGED <<beaches, links, site, checked, validLand>>

CanLand(b) == Eligible(b) /\ site[b] = 0 /\ Attached < owned

\* The other form reads eligibility before the write's transaction.
LandCheck(b) ==
    /\ ~Fixed
    /\ b \notin checked
    /\ CanLand(b)
    /\ checked' = checked \cup {b}
    /\ UNCHANGED <<beaches, links, owned, site, validLand>>

\* PUT /beaches/mine/:id/pier. The design: one transaction holding the
\* player's lock, the beach row and its two links (FOR SHARE), so no unlink
\* or deletion of a supporting beach lands between the check and the insert.
\* The unique key on the beach and the bag count still guard the other form.
Land(b) ==
    /\ IF Fixed THEN CanLand(b)
         ELSE /\ b \in checked
              /\ b \in beaches
              /\ site[b] = 0 /\ Attached < owned
    /\ site' = [site EXCEPT ![b] = 1]
    /\ checked' = checked \ {b}
    /\ validLand' = (validLand /\ Eligible(b))
    /\ UNCHANGED <<beaches, links, owned>>

\* DELETE /beaches/mine/:id/pier: active or paused, the pier goes back to the bag.
Lift(b) ==
    /\ site[b] > 0
    /\ site' = [site EXCEPT ![b] = 0]
    /\ UNCHANGED <<beaches, links, owned, checked, validLand>>

Next ==
    \/ \E l, r \in beaches : Link(l, r) \/ Unlink(l, r)
    \/ \E b \in beaches : DeleteBeach(b)
    \/ Buy \/ GiveAway
    \/ \E b \in Own : LandCheck(b) \/ Land(b) \/ Lift(b)

Spec == Init /\ [][Next]_vars
========================================================================
