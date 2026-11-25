------------------------- MODULE BeachEditing -------------------------
(***************************************************************************)
(* One player's beaches, edited from several devices (docs/STATE_MACHINES.md). *)
(*                                                                         *)
(* A device claims the edit session (POST /edit-session); only the holder  *)
(* of the current token may save (PUT /beaches/mine/:id/sand) or restore a *)
(* checkpoint (POST /beaches/mine/:id/restore). A restore bumps the       *)
(* beach's epoch, so a save from before it is refused. Across all beaches, *)
(* no more of a thing may be placed than the player owns ("within the bag"). *)
(*                                                                         *)
(* The save route checks the token, then the bag, then writes: separate    *)
(* steps here, as they are separate statements in server/src/app.ts, so    *)
(* TLC can put a takeover or another save between them. Fixed = TRUE       *)
(* models the save and restore doing the token check, the bag check and    *)
(* the write in one transaction holding the player's lock.                 *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS Devices, Beaches, Owned, MaxN, MaxEpoch, Fixed

None == "none"

VARIABLES
    tok,        \* the device whose token is current (edit_sessions.token)
    claimed,    \* devices that hold a token (current or not)
    epoch,      \* [Beaches -> Nat]: beach.epoch
    stored,     \* [Beaches -> Nat]: how many of the one bag item each beach holds
    seen,       \* [Devices -> [Beaches -> Nat]]: the epoch each device loaded
    pc,         \* [Devices -> [Beaches -> step]] for saves in flight
    want,       \* [Devices -> [Beaches -> Nat]]: what that save puts on the beach
    rpc,        \* [Devices -> step] for a restore in flight
    rbeach, rn, \* the restore's beach and how many it puts there
    \* ghosts
    badWrite,   \* a write landed from a device whose token was no longer current
    overRestore \* a save from before a restore landed after it

vars == <<tok, claimed, epoch, stored, seen, pc, want, rpc, rbeach, rn, badWrite, overRestore>>

RECURSIVE SumOver(_, _)
SumOver(f, S) == IF S = {} THEN 0 ELSE LET x == CHOOSE y \in S : TRUE IN f[x] + SumOver(f, S \ {x})

Elsewhere(b) == SumOver(stored, Beaches \ {b})
\* overBag / saveShort: an item may stay at what the beach held; past that,
\* owned minus what's on the other beaches must cover it.
SaveFits(b, n) == n <= stored[b] \/ n <= Owned - Elsewhere(b)
\* fitOf / shortfall for a restore: the beach's own things don't count.
RestoreFits(b, n) == n <= Owned - Elsewhere(b)

Init ==
    /\ tok = None
    /\ claimed = {}
    /\ epoch = [b \in Beaches |-> 0]
    /\ stored = [b \in Beaches |-> 0]
    /\ seen = [d \in Devices |-> [b \in Beaches |-> 0]]
    /\ pc = [d \in Devices |-> [b \in Beaches |-> "idle"]]
    /\ want = [d \in Devices |-> [b \in Beaches |-> 0]]
    /\ rpc = [d \in Devices |-> "idle"]
    /\ rbeach = [d \in Devices |-> CHOOSE b \in Beaches : TRUE]
    /\ rn = [d \in Devices |-> 0]
    /\ badWrite = FALSE
    /\ overRestore = FALSE

(* POST /edit-session: claim takes the same player lock as SaveAtomic and
   RestoreAtomic before it replaces the token. *)
Claim(d) ==
    /\ tok' = d
    /\ claimed' = claimed \cup {d}
    /\ UNCHANGED <<epoch, stored, seen, pc, want, rpc, rbeach, rn, badWrite, overRestore>>

(* GET /beaches/mine/:id/sand: the device learns the beach's epoch. *)
Load(d, b) ==
    /\ pc[d][b] = "idle"
    /\ seen' = [seen EXCEPT ![d][b] = epoch[b]]
    /\ UNCHANGED <<tok, claimed, epoch, stored, pc, want, rpc, rbeach, rn, badWrite, overRestore>>

Write(d, b, n) ==
    /\ stored' = [stored EXCEPT ![b] = n]
    /\ badWrite' = (badWrite \/ tok # d)

(* PUT /beaches/mine/:id/sand *)
SaveStart(d, b, n) ==
    /\ d \in claimed /\ pc[d][b] = "idle"
    /\ pc' = [pc EXCEPT ![d][b] = "tok"]
    /\ want' = [want EXCEPT ![d][b] = n]
    /\ UNCHANGED <<tok, claimed, epoch, stored, seen, rpc, rbeach, rn, badWrite, overRestore>>

SaveTok(d, b) ==                       \* requireEditToken
    /\ pc[d][b] = "tok" /\ ~Fixed
    /\ pc' = [pc EXCEPT ![d][b] = IF tok = d THEN "bag" ELSE "idle"]
    /\ UNCHANGED <<tok, claimed, epoch, stored, seen, want, rpc, rbeach, rn, badWrite, overRestore>>

SaveBag(d, b) ==                       \* overBag
    /\ pc[d][b] = "bag"
    /\ pc' = [pc EXCEPT ![d][b] = IF SaveFits(b, want[d][b]) THEN "upd" ELSE "idle"]
    /\ UNCHANGED <<tok, claimed, epoch, stored, seen, want, rpc, rbeach, rn, badWrite, overRestore>>

SaveUpd(d, b) ==                       \* UPDATE beach ... WHERE epoch <= $seen
    /\ pc[d][b] = "upd"
    /\ pc' = [pc EXCEPT ![d][b] = "idle"]
    /\ IF epoch[b] <= seen[d][b]
         THEN /\ Write(d, b, want[d][b])
              /\ overRestore' = (overRestore \/ seen[d][b] < epoch[b])
         ELSE UNCHANGED <<stored, badWrite, overRestore>>
    /\ UNCHANGED <<tok, claimed, epoch, seen, want, rpc, rbeach, rn>>

SaveAtomic(d, b) ==                    \* the fix: token, bag and write in one transaction
    /\ pc[d][b] = "tok" /\ Fixed
    /\ pc' = [pc EXCEPT ![d][b] = "idle"]
    /\ IF tok = d /\ SaveFits(b, want[d][b]) /\ epoch[b] <= seen[d][b]
         THEN /\ Write(d, b, want[d][b])
              /\ overRestore' = (overRestore \/ seen[d][b] < epoch[b])
         ELSE UNCHANGED <<stored, badWrite, overRestore>>
    /\ UNCHANGED <<tok, claimed, epoch, seen, want, rpc, rbeach, rn>>

(* POST /beaches/mine/:id/restore: token, then (one at a time per player) fit and write. *)
RestoreStart(d, b, n) ==
    /\ d \in claimed /\ rpc[d] = "idle"
    /\ rpc' = [rpc EXCEPT ![d] = "tok"]
    /\ rbeach' = [rbeach EXCEPT ![d] = b]
    /\ rn' = [rn EXCEPT ![d] = n]
    /\ UNCHANGED <<tok, claimed, epoch, stored, seen, pc, want, badWrite, overRestore>>

OtherRestoreBusy(d) == \E e \in Devices \ {d} : rpc[e] = "fit"

RestoreTok(d) ==
    /\ rpc[d] = "tok" /\ ~Fixed
    /\ rpc' = [rpc EXCEPT ![d] = IF tok = d THEN "lock" ELSE "idle"]
    /\ UNCHANGED <<tok, claimed, epoch, stored, seen, pc, want, rbeach, rn, badWrite, overRestore>>

RestoreLock(d) ==                      \* oneAtATime(me, ...)
    /\ rpc[d] = "lock" /\ ~OtherRestoreBusy(d)
    /\ rpc' = [rpc EXCEPT ![d] = "fit"]
    /\ UNCHANGED <<tok, claimed, epoch, stored, seen, pc, want, rbeach, rn, badWrite, overRestore>>

RestoreFitWrite(d) ==                  \* fitOf, then the UPDATE (epoch + 1)
    /\ rpc[d] = "fit" /\ epoch[rbeach[d]] < MaxEpoch
    /\ rpc' = [rpc EXCEPT ![d] = "idle"]
    /\ IF RestoreFits(rbeach[d], rn[d])
         THEN /\ Write(d, rbeach[d], rn[d])
              /\ epoch' = [epoch EXCEPT ![rbeach[d]] = @ + 1]
         ELSE UNCHANGED <<stored, epoch, badWrite>>
    /\ UNCHANGED <<tok, claimed, seen, pc, want, rbeach, rn, overRestore>>

RestoreAtomic(d) ==                    \* the fix
    /\ rpc[d] = "tok" /\ Fixed /\ epoch[rbeach[d]] < MaxEpoch
    /\ rpc' = [rpc EXCEPT ![d] = "idle"]
    /\ IF tok = d /\ RestoreFits(rbeach[d], rn[d])
         THEN /\ Write(d, rbeach[d], rn[d])
              /\ epoch' = [epoch EXCEPT ![rbeach[d]] = @ + 1]
         ELSE UNCHANGED <<stored, epoch, badWrite>>
    /\ UNCHANGED <<tok, claimed, seen, pc, want, rbeach, rn, overRestore>>

Next ==
    \E d \in Devices :
        \/ Claim(d)
        \/ RestoreTok(d) \/ RestoreLock(d) \/ RestoreFitWrite(d) \/ RestoreAtomic(d)
        \/ \E b \in Beaches :
              \/ Load(d, b)
              \/ SaveTok(d, b) \/ SaveBag(d, b) \/ SaveUpd(d, b) \/ SaveAtomic(d, b)
              \/ \E n \in 0..MaxN : SaveStart(d, b, n) \/ RestoreStart(d, b, n)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK ==
    /\ tok \in Devices \cup {None}
    /\ stored \in [Beaches -> 0..MaxN]
    /\ epoch \in [Beaches -> 0..MaxEpoch]

\* Never more placed, across all beaches, than the player owns.
WithinBag == SumOver(stored, Beaches) <= Owned

\* Only the device holding the current token changes a beach.
OnlyEditorWrites == ~badWrite

\* A save made before a restore never overwrites it.
RestoreKept == ~overRestore
=============================================================================
