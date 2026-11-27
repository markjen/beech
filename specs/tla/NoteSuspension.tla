--------------------------- MODULE NoteSuspension ---------------------------
(* Suspending a sender's notes (docs/INBOX_NOTIFICATIONS.md, "Reports"):   *)
(* the admin stops a player leaving notes for a while, after repeated     *)
(* reports, and can hide the notes of theirs that are still shown.        *)
(*                                                                         *)
(* Routes (docs/STATE_MACHINES.md, "Suspending a sender's notes"):         *)
(*   Visit(r)   POST /api/beaches/:code/visit { note }   (a player)         *)
(*   Suspend    POST /api/senders/:id/suspend-notes      (admin console)    *)
(*   Lift       POST /api/senders/:id/lift-notes         (admin, or expiry) *)
(*   Hide       POST /api/reports/:id/resolve { hide }   (one note)         *)
(*                                                                         *)
(* A visit reads the suspension and inserts its note. Fixed = FALSE: the   *)
(* read is its own statement before the transaction, so the admin's        *)
(* suspension can land in between. Fixed = TRUE: the check is inside the   *)
(* visit's transaction, under the sender's row lock (FOR NO KEY UPDATE),   *)
(* and Suspend updates that same row, so they serialize.                   *)
EXTENDS Integers, FiniteSets

CONSTANTS Requests, MaxNotes, Fixed

VARIABLES
    suspended,  \* users.notes_suspended_until > now
    notes,      \* the sender's notes: a set of records [id, hidden, sentSuspended]
    nextId,     \* note ids
    pc,         \* [Requests -> "idle" | "checked"]: a visit between its read and its insert
    swept       \* ghost: a suspension with "hide their notes" happened and wasn't lifted since

vars == <<suspended, notes, nextId, pc, swept>>

Init ==
    /\ suspended = FALSE
    /\ notes = {}
    /\ nextId = 1
    /\ pc = [r \in Requests |-> "idle"]
    /\ swept = FALSE

Insert ==
    /\ nextId <= MaxNotes
    /\ notes' = notes \cup {[id |-> nextId, hidden |-> FALSE, sentSuspended |-> suspended]}
    /\ nextId' = nextId + 1

(* A visit with a note. Refused (403) while suspended. *)
VisitCheck(r) ==
    /\ pc[r] = "idle"
    /\ ~suspended
    /\ IF Fixed
         THEN Insert /\ UNCHANGED <<suspended, pc, swept>>     \* one transaction, sender row locked
         ELSE pc' = [pc EXCEPT ![r] = "checked"] /\ UNCHANGED <<suspended, notes, nextId, swept>>
VisitInsert(r) ==
    /\ pc[r] = "checked"
    /\ pc' = [pc EXCEPT ![r] = "idle"]
    /\ Insert
    /\ UNCHANGED <<suspended, swept>>
(* the read found nothing to stop it, but the insert ran out of ids: give up quietly (bounds only) *)
VisitDrop(r) ==
    /\ pc[r] = "checked" /\ nextId > MaxNotes
    /\ pc' = [pc EXCEPT ![r] = "idle"]
    /\ UNCHANGED <<suspended, notes, nextId, swept>>

(* The admin suspends, hiding every note of theirs still shown: one statement
   (UPDATE users ... ; UPDATE notes ... in one transaction, the user row first). *)
Suspend(hide) ==
    /\ suspended' = TRUE
    /\ notes' = IF hide THEN {[n EXCEPT !.hidden = TRUE] : n \in notes} ELSE notes
    /\ swept' = (swept \/ hide)
    /\ UNCHANGED <<nextId, pc>>

(* Lifted by the admin, or the time ran out. *)
Lift ==
    /\ suspended
    /\ suspended' = FALSE
    /\ swept' = FALSE
    /\ UNCHANGED <<notes, nextId, pc>>

(* The admin hides one reported note. *)
HideOne ==
    /\ \E n \in notes : ~n.hidden /\ notes' = (notes \ {n}) \cup {[n EXCEPT !.hidden = TRUE]}
    /\ UNCHANGED <<suspended, nextId, pc, swept>>

Next ==
    \/ \E r \in Requests : VisitCheck(r) \/ VisitInsert(r) \/ VisitDrop(r)
    \/ \E h \in BOOLEAN : Suspend(h)
    \/ Lift
    \/ HideOne

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ suspended \in BOOLEAN
    /\ swept \in BOOLEAN
    /\ nextId \in 1..MaxNotes + 1
    /\ \A n \in notes : n.id \in 1..MaxNotes /\ n.hidden \in BOOLEAN /\ n.sentSuspended \in BOOLEAN
    /\ pc \in [Requests -> {"idle", "checked"}]

(* The game's rules. *)
(* A suspended sender's notes never get through: none is accepted while they're suspended. *)
NoNoteWhileSuspended == \A n \in notes : ~n.sentSuspended
(* After "suspend and hide their notes", none of theirs shows until it's lifted. *)
SweptStaysClean == swept => \A n \in notes : n.hidden
=============================================================================
