--------------------------- MODULE Neighbors ---------------------------
(***************************************************************************)
(* Neighbor links on the shore (docs/STATE_MACHINES.md).                   *)
(*                                                                         *)
(* A beach asks another to be on its left or right (PUT /neighbors/:side); *)
(* the other accepts (POST /neighbors/requests/:code/accept), declines, or *)
(* either side moves away (DELETE /neighbors/:side). A link is two rows,   *)
(* <<a, s, b>> and <<b, Opp(s), a>>, written in one statement (link() in   *)
(* server/src/app.ts), under the table's keys: one neighbor per side of a  *)
(* beach, and a beach is someone's s-neighbor at most once.                *)
(*                                                                         *)
(* An accept checks that the side is free, then links: two steps here.     *)
(* Fixed = TRUE models link() re-checking, under both beaches' locks, that *)
(* the two beaches aren't linked already.                                  *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Beaches, Fixed

Sides == {"left", "right"}
Opp(s) == IF s = "left" THEN "right" ELSE "left"

VARIABLES
    links,      \* set of rows <<beach, side, neighbor>>
    reqs,       \* set of requests <<from, side, to>>: "be on my side"
    pc          \* [Beaches -> [Beaches -> [Sides -> "idle" | "checked"]]]:
                \* an accept by the 2nd beach of the 1st's request, per side

vars == <<links, reqs, pc>>

Linked(a, s) == \E r \in links : r[1] = a /\ r[2] = s
NeighborOn(a, s) == CHOOSE b \in Beaches : <<a, s, b>> \in links
Paired(a, b) == \E s \in Sides : <<a, s, b>> \in links

Init ==
    /\ links = {}
    /\ reqs = {}
    /\ pc = [b \in Beaches |-> [a \in Beaches |-> [s \in Sides |-> "idle"]]]

(* link(a, s, b): both rows in one INSERT, refused (23505) if a key clashes. *)
CanInsert(a, s, b) ==
    /\ ~Linked(a, s) /\ ~Linked(b, Opp(s))
    /\ ~(\E r \in links : r[3] = b /\ r[2] = s)       \* neighbors_once
    /\ ~(\E r \in links : r[3] = a /\ r[2] = Opp(s))
    /\ (Fixed => ~Paired(a, b))                       \* the fix: no second link between the two
Link(a, s, b) ==
    /\ links' = links \cup {<<a, s, b>>, <<b, Opp(s), a>>}
    \* requests that can't happen any more
    /\ reqs' = {q \in reqs :
                  ~( (q[1] = a /\ (q[2] = s \/ q[3] = b)) \/ (q[1] = b /\ (q[2] = Opp(s) \/ q[3] = a))
                   \/ (q[3] = a /\ q[2] = Opp(s)) \/ (q[3] = b /\ q[2] = s) )}

(* PUT /neighbors/:side by a, naming b. Their request the other way links at once. *)
Ask(a, s, b) ==
    /\ a # b
    /\ ~Linked(a, s)
    /\ ~(Linked(a, Opp(s)) /\ NeighborOn(a, Opp(s)) = b)
    /\ ~Linked(b, Opp(s))
    /\ IF <<b, Opp(s), a>> \in reqs
         THEN IF CanInsert(a, s, b) THEN Link(a, s, b) ELSE UNCHANGED <<links, reqs>>
         ELSE /\ reqs' = {q \in reqs : ~(q[1] = a /\ q[2] = s)} \cup {<<a, s, b>>}
              /\ UNCHANGED links
    /\ UNCHANGED pc

(* POST /neighbors/requests/:code/accept by b, for a's request <<a, s, b>>. *)
AcceptCheck(b, a, s) ==
    /\ pc[b][a][s] = "idle"
    /\ <<a, s, b>> \in reqs
    /\ ~Linked(b, Opp(s))
    /\ pc' = [pc EXCEPT ![b][a][s] = "checked"]
    /\ UNCHANGED <<links, reqs>>

AcceptLink(b, a, s) ==
    /\ pc[b][a][s] = "checked"
    /\ pc' = [pc EXCEPT ![b][a][s] = "idle"]
    /\ IF CanInsert(a, s, b) THEN Link(a, s, b) ELSE UNCHANGED <<links, reqs>>

(* DELETE /neighbors/requests/:code: b declines a's request. *)
Decline(b, a) ==
    /\ reqs' = {q \in reqs : ~(q[1] = a /\ q[3] = b)}
    /\ UNCHANGED <<links, pc>>

(* DELETE /neighbors/:side: a moves away from its s neighbor (both rows go),
   and takes back its own request for that side. *)
MoveAway(a, s) ==
    /\ links' = {r \in links : ~((r[1] = a /\ r[2] = s) \/ (r[3] = a /\ r[2] = Opp(s)))}
    /\ reqs' = {q \in reqs : ~(q[1] = a /\ q[2] = s)}
    /\ UNCHANGED pc

Next ==
    \E a, b \in Beaches, s \in Sides :
        Ask(a, s, b) \/ AcceptCheck(b, a, s) \/ AcceptLink(b, a, s) \/ Decline(b, a) \/ MoveAway(a, s)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK ==
    /\ links \subseteq Beaches \X Sides \X Beaches
    /\ reqs \subseteq Beaches \X Sides \X Beaches

\* Every link is mutual: if b is on a's left, a is on b's right.
Mutual == \A r \in links : <<r[3], Opp(r[2]), r[1]>> \in links

\* One neighbor per side.
OnePerSide == \A a \in Beaches, s \in Sides : Cardinality({r \in links : r[1] = a /\ r[2] = s}) <= 1

\* Two beaches are linked once: never on both sides of each other.
LinkedOnce == \A a, b \in Beaches : ~(<<a, "left", b>> \in links /\ <<a, "right", b>> \in links)

\* No beach is its own neighbor.
NoSelf == \A r \in links : r[1] # r[3]
=============================================================================
