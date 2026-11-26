----------------------------- MODULE Piers -----------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Beaches, Own, Home, Orders, Fixed

\* A link <<a,b>> means b is immediately right of a, with a reciprocally left.
\* Each successful order grants one identifiable pier. A paid pier with no
\* attachment is in the bag. A stored attachment can be dormant.
VARIABLES beaches, links, payment, site, checked, validLand

vars == <<beaches, links, payment, site, checked, validLand>>
Bag == "bag"
NoCheck == "none"
Phases == {"new", "pending", "paid", "closed"}

Eligible(b) ==
    /\ b \in beaches \cap Own
    /\ \E l, r \in (beaches \cap Own) \ {b} :
         /\ l # r
         /\ <<l, b>> \in links
         /\ <<b, r>> \in links

Free(b) == \A o \in Orders : site[o] # b
Visible(o) == payment[o] = "paid" /\ site[o] # Bag /\ Eligible(site[o])

TypeOK ==
    /\ beaches \subseteq Beaches
    /\ links \subseteq beaches \X beaches
    /\ payment \in [Orders -> Phases]
    /\ site \in [Orders -> (beaches \cap Own) \cup {Bag}]
    /\ checked \in [Orders -> Own \cup {NoCheck}]
    /\ validLand \in BOOLEAN

PaidAttachment == \A o \in Orders : site[o] # Bag => payment[o] = "paid"
OnePerBeach == \A b \in beaches : Cardinality({o \in Orders : site[o] = b}) <= 1
PlacementWasEligible == validLand

Init ==
    /\ beaches = Beaches
    /\ links = {}
    /\ payment = [o \in Orders |-> "new"]
    /\ site = [o \in Orders |-> Bag]
    /\ checked = [o \in Orders |-> NoCheck]
    /\ validLand = TRUE

Link(l, r) ==
    /\ l # r
    /\ <<r, l>> \notin links
    /\ \A b \in beaches : <<l, b>> \notin links /\ <<b, r>> \notin links
    /\ links' = links \cup {<<l, r>>}
    /\ UNCHANGED <<beaches, payment, site, checked, validLand>>

Unlink(l, r) ==
    /\ <<l, r>> \in links
    /\ links' = links \ {<<l, r>>}
    /\ UNCHANGED <<beaches, payment, site, checked, validLand>>

DeleteBeach(b) ==
    /\ b # Home
    /\ beaches' = beaches \ {b}
    /\ links' = {e \in links : e[1] # b /\ e[2] # b}
    /\ site' = [o \in Orders |-> IF site[o] = b THEN Bag ELSE site[o]]
    /\ UNCHANGED <<payment, checked, validLand>>

\* The chosen beach opens checkout. It does not reserve an attachment.
Begin(o, b) ==
    /\ payment[o] = "new"
    /\ Eligible(b) /\ Free(b)
    /\ payment' = [payment EXCEPT ![o] = "pending"]
    /\ UNCHANGED <<beaches, links, site, checked, validLand>>

\* Provider confirmation is keyed by order. A replay has no transition.
Settle(o) ==
    /\ payment[o] = "pending"
    /\ payment' = [payment EXCEPT ![o] = "paid"]
    /\ UNCHANGED <<beaches, links, site, checked, validLand>>

\* Authoritative cancellation or refund, including before the grant arrives.
Close(o) ==
    /\ payment[o] \in {"pending", "paid"}
    /\ payment' = [payment EXCEPT ![o] = "closed"]
    /\ site' = [site EXCEPT ![o] = Bag]
    /\ checked' = [checked EXCEPT ![o] = NoCheck]
    /\ UNCHANGED <<beaches, links, validLand>>

CanLand(o, b) == payment[o] = "paid" /\ site[o] = Bag /\ Eligible(b) /\ Free(b)

\* The alternate design reads eligibility before taking the write lock.
LandCheck(o, b) ==
    /\ ~Fixed
    /\ checked[o] = NoCheck
    /\ CanLand(o, b)
    /\ checked' = [checked EXCEPT ![o] = b]
    /\ UNCHANGED <<beaches, links, payment, site, validLand>>

Land(o, b) ==
    /\ IF Fixed THEN CanLand(o, b)
         ELSE /\ checked[o] = b
              /\ b \in beaches
              /\ payment[o] = "paid" /\ site[o] = Bag /\ Free(b)
    /\ site' = [site EXCEPT ![o] = b]
    /\ checked' = [checked EXCEPT ![o] = NoCheck]
    /\ validLand' = (validLand /\ Eligible(b))
    /\ UNCHANGED <<beaches, links, payment>>

Lift(o) ==
    /\ site[o] # Bag
    /\ site' = [site EXCEPT ![o] = Bag]
    /\ UNCHANGED <<beaches, links, payment, checked, validLand>>

Next ==
    \/ \E l, r \in beaches : Link(l, r) \/ Unlink(l, r)
    \/ \E b \in beaches : DeleteBeach(b)
    \/ \E o \in Orders : Settle(o) \/ Close(o) \/ Lift(o)
    \/ \E o \in Orders, b \in Own : Begin(o, b) \/ LandCheck(o, b) \/ Land(o, b)

Spec == Init /\ [][Next]_vars
========================================================================
