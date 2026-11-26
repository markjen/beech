-------------------------- MODULE InlandSections --------------------------
\* Inland beach sections (docs/INLAND_SECTIONS.md): bag items, bought with
\* beech bucks, placed in rows behind a beach (up to MaxRows of them).
\*
\* A beach's layout is the ordered list of section types in its rows (the
\* beach_sections rows, by row) and a revision (beach.sections_rev). One
\* route, PUT /beaches/mine/:id/sections, replaces the whole layout: append,
\* replace, reorder and return to the bag are all "here is the new list,
\* made from the layout at revision r". Placed sections are counted against
\* what's owned, per type, across all the player's beaches, like piers.
\* Joins with neighbors are derived (same type, same row, a direct link) and
\* never stored, so they need no state here.
\*
\* Two devices of the one player edit at once. The edit token keeps one
\* editor per player in practice (BeachEditing.tla); this spec doesn't lean
\* on it, so a stale tab or a second request from the same device is covered.
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Beaches, Home, Types, Devices, MaxRows, MaxOwned, MaxRev, Fixed

VARIABLES
    beaches,   \* the player's beaches that still exist
    layout,    \* [Beaches -> Seq(Types)]: the rows, front (row 1) first
    rev,       \* [Beaches -> Nat]: bumps on every layout change
    owned,     \* [Types -> Nat]: inventory, per section type
    seen,      \* [Devices -> read]: the layout a device last read (its preview)
    pending,   \* [Devices -> write]: the other form's write, between check and commit
    lost       \* ghost: a write landed on a layout its device never saw

vars == <<beaches, layout, rev, owned, seen, pending, lost>>

None == [b |-> "none"]

\* every list of at most n types (n small)
RECURSIVE SeqsUpTo(_)
SeqsUpTo(n) == IF n = 0 THEN {<<>>} ELSE SeqsUpTo(n - 1) \cup {Append(s, t) : s \in SeqsUpTo(n - 1), t \in Types}

\* the client may send one row too many (the server must refuse a fifth row)
Proposals == SeqsUpTo(MaxRows + 1)

Count(s, t) == Cardinality({i \in 1..Len(s) : s[i] = t})
RECURSIVE SumOver(_, _)
SumOver(S, t) == IF S = {} THEN 0 ELSE LET b == CHOOSE x \in S : TRUE IN Count(layout[b], t) + SumOver(S \ {b}, t)
Placed(t) == SumOver(Beaches, t)

\* the layout L on b fits: few enough rows, and enough of each type owned
\* counting what's on the other beaches
Fits(b, L) ==
    /\ Len(L) <= MaxRows
    /\ \A t \in Types : Placed(t) - Count(layout[b], t) + Count(L, t) <= owned[t]

TypeOK ==
    /\ beaches \subseteq Beaches
    /\ layout \in [Beaches -> SeqsUpTo(MaxRows + 1)]
    /\ rev \in [Beaches -> 0..MaxRev]
    /\ owned \in [Types -> 0..MaxOwned]
    /\ lost \in BOOLEAN

\* Every placed section is one the player owns (none from nowhere).
PaidPlacement == \A t \in Types : Placed(t) <= owned[t]
\* A beach has at most MaxRows rows behind it.
RowsBound == \A b \in Beaches : Len(layout[b]) <= MaxRows
\* A deleted beach leaves nothing placed: its sections are back in the bag.
NoOrphan == \A b \in Beaches \ beaches : layout[b] = <<>>
\* Every layout change was made from the layout it replaced (no lost update:
\* a second device's reorder can't silently undo the first's).
NoLostUpdate == ~lost

Init ==
    /\ beaches = Beaches
    /\ layout = [b \in Beaches |-> <<>>]
    /\ rev = [b \in Beaches |-> 0]
    /\ owned = [t \in Types |-> 0]
    /\ seen = [d \in Devices |-> None]
    /\ pending = [d \in Devices |-> None]
    /\ lost = FALSE

\* POST /store/buy (item_section_*): one statement spends the bucks, adds the item.
Buy(t) ==
    /\ owned[t] < MaxOwned
    /\ owned' = [owned EXCEPT ![t] = @ + 1]
    /\ UNCHANGED <<beaches, layout, rev, seen, pending, lost>>

\* POST /bag/trade-in, POST /gifts: under the player's lock, only a free one
\* can go (the design). The other form only asks "do they own one?".
GiveAway(t) ==
    /\ owned[t] > 0
    /\ Fixed => owned[t] > Placed(t)
    /\ owned' = [owned EXCEPT ![t] = @ - 1]
    /\ UNCHANGED <<beaches, layout, rev, seen, pending, lost>>

\* DELETE /beaches/mine/:id: its rows cascade, the sections are back in the bag.
DeleteBeach(b) ==
    /\ b # Home /\ b \in beaches
    /\ beaches' = beaches \ {b}
    /\ layout' = [layout EXCEPT ![b] = <<>>]
    /\ UNCHANGED <<rev, owned, seen, pending, lost>>

\* GET /beaches/mine: the device reads a beach's layout and revision (the
\* Inland sections sheet and its preview are built from this).
Read(d, b) ==
    /\ b \in beaches /\ pending[d] = None
    /\ seen' = [seen EXCEPT ![d] = [b |-> b, rev |-> rev[b], layout |-> layout[b]]]
    /\ UNCHANGED <<beaches, layout, rev, owned, pending, lost>>

Apply(d, b, L) ==
    /\ lost' = (lost \/ layout[b] # seen[d].layout)
    /\ layout' = [layout EXCEPT ![b] = L]
    /\ rev' = [rev EXCEPT ![b] = @ + 1]

\* PUT /beaches/mine/:id/sections {rows: L, rev}. The design: one
\* transaction holding the player's lock (asEditor) and the beach row; the
\* revision must match what the device read, the rows must fit, then the
\* old rows go and the new ones go in and the revision bumps.
Write(d, L) ==
    LET b == seen[d].b IN
    /\ Fixed
    /\ seen[d] # None
    /\ b \in beaches
    /\ rev[b] < MaxRev
    /\ rev[b] = seen[d].rev
    /\ Fits(b, L)
    /\ Apply(d, b, L)
    /\ seen' = [seen EXCEPT ![d] = None]
    /\ UNCHANGED <<beaches, owned, pending>>

\* The other form: check the rows and the bag, then write in a second step,
\* with no revision.
Check(d, L) ==
    LET b == seen[d].b IN
    /\ ~Fixed
    /\ seen[d] # None /\ pending[d] = None
    /\ b \in beaches
    /\ Fits(b, L)
    /\ pending' = [pending EXCEPT ![d] = [b |-> b, rows |-> L]]
    /\ UNCHANGED <<beaches, layout, rev, owned, seen, lost>>

Commit(d) ==
    LET b == pending[d].b IN
    /\ pending[d] # None
    /\ b \in beaches
    /\ rev[b] < MaxRev
    /\ Apply(d, b, pending[d].rows)
    /\ pending' = [pending EXCEPT ![d] = None]
    /\ seen' = [seen EXCEPT ![d] = None]
    /\ UNCHANGED <<beaches, owned>>

Next ==
    \/ \E t \in Types : Buy(t) \/ GiveAway(t)
    \/ \E b \in Beaches : DeleteBeach(b)
    \/ \E d \in Devices :
         \/ \E b \in Beaches : Read(d, b)
         \/ \E L \in Proposals : Write(d, L) \/ Check(d, L)
         \/ Commit(d)

Spec == Init /\ [][Next]_vars
============================================================================
