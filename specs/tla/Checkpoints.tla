---------------------------- MODULE Checkpoints ----------------------------
(***************************************************************************)
(* Checkpoints (docs/CHECKPOINTS.md, docs/STATE_MACHINES.md): saved        *)
(* copies of beaches. Named checkpoints count against a limit (Limit:     *)
(* CHECKPOINTS_PER_BEACH times your beach allowance); all of them share   *)
(* one store (Cap: 16 MB a player). Each beach also has one automatic     *)
(* slot ("Auto-save", "Before big edit", "Before import", "Before         *)
(* restoring") that a new automatic copy replaces.                        *)
(*                                                                         *)
(* Every checkpoint here is one unit of bytes. Two devices of one player  *)
(* (Requests) make checkpoints at once: a named one (POST                 *)
(* /beaches/mine/:id/checkpoints, POST /checkpoints, POST                 *)
(* /checkpoints/copy: checkRoom, then the INSERT), or an automatic one    *)
(* before a save (writeAutoCheckpoint: measure the store less this        *)
(* beach's slot, then the upsert). A restore or a copy onto a beach       *)
(* (writeOnto) also fills the beach's slot, unchecked on purpose: a       *)
(* restore never fails for space, and its slot replaces the last one.     *)
(*                                                                         *)
(* Fixed = FALSE: the code before this model: the check and the write are *)
(* separate statements. Fixed = TRUE: both in one transaction holding the *)
(* player row lock (withPlayerWriteLock), which saves and restores hold   *)
(* too.                                                                    *)
(***************************************************************************)
EXTENDS Integers

CONSTANTS Requests, Beaches, Limit, Cap, MaxMade, Fixed

VARIABLES
    named,      \* named checkpoints kept
    slot,       \* [Beaches -> 0..1]: the beach's automatic slot is filled
    pc,         \* [Requests -> "idle" | "named" | "auto"]
    on,         \* [Requests -> Beaches]: the beach an auto copy is for
    made,       \* named checkpoints made so far (bounds the model)
    overfilled  \* ghost: a checked write left the store over Cap

vars == <<named, slot, pc, on, made, overfilled>>

RECURSIVE SlotsIn(_)
SlotsIn(bs) == IF bs = {} THEN 0 ELSE LET b == CHOOSE x \in bs : TRUE IN slot[b] + SlotsIn(bs \ {b})
Used == named + SlotsIn(Beaches)        \* the store's bytes, in units

Init ==
    /\ named = 0 /\ slot = [b \in Beaches |-> 0]
    /\ pc = [r \in Requests |-> "idle"]
    /\ on = [r \in Requests |-> CHOOSE b \in Beaches : TRUE]
    /\ made = 0 /\ overfilled = FALSE

NamedRoom == named < Limit /\ Used + 1 <= Cap
AutoRoom(b) == Used - slot[b] + 1 <= Cap

AddNamed ==
    /\ named' = named + 1 /\ made' = made + 1
    /\ overfilled' = (overfilled \/ Used + 1 > Cap)
FillSlot(b) ==
    /\ slot' = [slot EXCEPT ![b] = 1]
    /\ overfilled' = (overfilled \/ Used - slot[b] + 1 > Cap)

(* a named checkpoint: checkRoom, then the INSERT *)
MakeCheck(r) ==
    /\ pc[r] = "idle" /\ made < MaxMade
    /\ IF Fixed
         THEN /\ IF NamedRoom THEN AddNamed ELSE UNCHANGED <<named, made, overfilled>>   \* 409 / 413
              /\ UNCHANGED <<pc, slot>>
         ELSE /\ pc' = [pc EXCEPT ![r] = IF NamedRoom THEN "named" ELSE "idle"]
              /\ UNCHANGED <<named, slot, made, overfilled>>
    /\ UNCHANGED on
MakeWrite(r) ==
    /\ pc[r] = "named"
    /\ pc' = [pc EXCEPT ![r] = "idle"]
    /\ AddNamed
    /\ UNCHANGED <<slot, on>>

(* an automatic copy before a save: measure, then the upsert into the slot *)
AutoCheck(r, b) ==
    /\ pc[r] = "idle"
    /\ IF Fixed
         THEN /\ IF AutoRoom(b) THEN FillSlot(b) ELSE UNCHANGED <<slot, overfilled>>    \* skipped: never blocks the save
              /\ UNCHANGED <<pc, on>>
         ELSE /\ pc' = [pc EXCEPT ![r] = IF AutoRoom(b) THEN "auto" ELSE "idle"]
              /\ on' = [on EXCEPT ![r] = b]
              /\ UNCHANGED <<slot, overfilled>>
    /\ UNCHANGED <<named, made>>
AutoWrite(r) ==
    /\ pc[r] = "auto"
    /\ pc' = [pc EXCEPT ![r] = "idle"]
    /\ FillSlot(on[r])
    /\ UNCHANGED <<named, made, on>>

(* a restore or copy onto beach b: its slot takes what was there, unchecked *)
Restore(b) ==
    /\ slot' = [slot EXCEPT ![b] = 1]
    /\ UNCHANGED <<named, pc, on, made, overfilled>>

(* DELETE /checkpoints/:id *)
DeleteNamed == named > 0 /\ named' = named - 1 /\ UNCHANGED <<slot, pc, on, made, overfilled>>
DeleteSlot(b) == slot[b] = 1 /\ slot' = [slot EXCEPT ![b] = 0] /\ UNCHANGED <<named, pc, on, made, overfilled>>

Next ==
    \/ \E r \in Requests : MakeCheck(r) \/ MakeWrite(r) \/ AutoWrite(r) \/ \E b \in Beaches : AutoCheck(r, b)
    \/ \E b \in Beaches : Restore(b) \/ DeleteSlot(b)
    \/ DeleteNamed

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK == named \in 0..Limit + 2 /\ slot \in [Beaches -> 0..1]

\* Never more named checkpoints than the limit.
NamedWithinLimit == named <= Limit

\* A checkpoint the store was checked for never leaves it over the cap
\* (only a restore's own slot may, and the next checked write is refused).
FitsWhenAdded == ~overfilled
=============================================================================
