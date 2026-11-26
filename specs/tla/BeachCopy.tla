--------------------------- MODULE BeachCopy ---------------------------
(***************************************************************************)
(* Copying a beach on the shore onto one of your own (docs/COPY_BEACH.md,  *)
(* docs/STATE_MACHINES.md).                                                *)
(*                                                                         *)
(* A player previews a public beach (GET /beaches/:code/copy-fit) and      *)
(* pins the version they saw. The copy (POST /beaches/mine/copy) reads the *)
(* source, checks the player's bag and beach allowance, then writes the   *)
(* target: one of their beaches, or a new one. Meanwhile the source's      *)
(* owner can rebuild it or take it off the shore, the player can buy what  *)
(* was missing (a store grant), and the player's other devices keep        *)
(* saving.                                                                 *)
(*                                                                         *)
(* One bag item is modelled (a lighthouse, say); free items never count.  *)
(* The edit token and the epoch work exactly as for a restore              *)
(* (BeachEditing.tla): a copy goes through the same asEditor path, so      *)
(* they aren't repeated here.                                              *)
(*                                                                         *)
(* Fixed = FALSE: the copy reads the source (checking the pin and that     *)
(* it's public), then checks the bag and allowance, then writes: three     *)
(* statements. Fixed = TRUE: one transaction holding the player's lock     *)
(* (oneAtATime + asEditor) with the source row read FOR SHARE.             *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS Requests, Slots, Home, Allowance, MaxOwned, MaxN, MaxVer, Fixed

VARIABLES
    owned,      \* copier's unexpired inventory of the item (store grants only add)
    exists,     \* [Slots -> BOOLEAN]: the copier's beach rows
    stored,     \* [Slots -> 0..MaxN]: beach.items for the item
    sver,       \* source beach.version
    spub,       \* source is on the shore and saved (isPublic)
    sitems,     \* how many of the item the source's current save holds
    pc,         \* [Requests -> "idle" | "read" | "check" | "write"]
    tgt,        \* [Requests -> Slots]: the target beach (a slot not yet existing = "a new beach")
    mode,       \* [Requests -> {"strict", "drop"}]
    pin,        \* [Requests -> version]: what the preview showed
    got,        \* [Requests -> items]: what the copy read from the source
    gotVer,     \* [Requests -> version]: the version it read
    n,          \* [Requests -> items]: what the copy will write (after the check)
    \* ghosts
    wrongVersion,  \* a copy landed with a version other than the one previewed
    copiedHidden   \* a copy landed after its source left the shore

vars == <<owned, exists, stored, sver, spub, sitems, pc, tgt, mode, pin, got, gotVer, n,
          wrongVersion, copiedHidden>>

RECURSIVE SumOver(_, _)
SumOver(f, S) == IF S = {} THEN 0 ELSE LET x == CHOOSE y \in S : TRUE IN f[x] + SumOver(f, S \ {x})

Mine == {b \in Slots : exists[b]}
Elsewhere(b) == SumOver(stored, Mine \ {b})
Avail(b) == IF owned - Elsewhere(b) > 0 THEN owned - Elsewhere(b) ELSE 0
Min(a, b) == IF a < b THEN a ELSE b
RoomFor(b) == exists[b] \/ Cardinality(Mine) < Allowance

\* What a copy of `need` onto b writes, or -1 when it's refused.
\*   strict: all of it, or a 409 { short }
\*   drop:   as many as the bag has free (dropMissing)
Outcome(b, need, m) ==
    IF ~RoomFor(b) THEN -1
    ELSE IF need <= Avail(b) THEN need
    ELSE IF m = "strict" THEN -1
    ELSE Min(need, Avail(b))

Init ==
    /\ owned = 1
    /\ exists = [b \in Slots |-> b = Home]
    /\ stored = [b \in Slots |-> 0]
    /\ sver = 0 /\ spub = TRUE /\ sitems = 1
    /\ pc = [r \in Requests |-> "idle"]
    /\ tgt = [r \in Requests |-> Home]
    /\ mode = [r \in Requests |-> "strict"]
    /\ pin = [r \in Requests |-> 0]
    /\ got = [r \in Requests |-> 0]
    /\ gotVer = [r \in Requests |-> 0]
    /\ n = [r \in Requests |-> 0]
    /\ wrongVersion = FALSE
    /\ copiedHidden = FALSE

Src == <<sver, spub, sitems>>
Ghosts == <<wrongVersion, copiedHidden>>
Req == <<pc, tgt, mode, pin, got, gotVer, n>>

-----------------------------------------------------------------------------
(* Other people and other requests *)

(* The source's owner saves a new version of it (their own PUT .../sand). *)
SourceEdit ==
    /\ sver < MaxVer
    /\ sver' = sver + 1
    /\ sitems' \in 0..MaxN
    /\ UNCHANGED <<owned, exists, stored, spub, Req, Ghosts>>

(* The source's owner takes it off the shore, or puts it back (PATCH onShore). *)
SourceShore ==
    /\ spub' = ~spub
    /\ UNCHANGED <<owned, exists, stored, sver, sitems, Req, Ghosts>>

(* A store grant: the player bought what was missing (webhook or receipt). *)
Buy ==
    /\ owned < MaxOwned
    /\ owned' = owned + 1
    /\ UNCHANGED <<exists, stored, Src, Req, Ghosts>>

(* The player's other device saves one of their beaches (BeachEditing's SaveAtomic). *)
Save(b, k) ==
    /\ exists[b]
    /\ k <= stored[b] \/ k <= owned - Elsewhere(b)
    /\ stored' = [stored EXCEPT ![b] = k]
    /\ UNCHANGED <<owned, exists, Src, Req, Ghosts>>

-----------------------------------------------------------------------------
(* The copy *)

(* The preview, then "Copy": the app sends the version it showed. Only a
   public beach shows the button. *)
CopyStart(r, b, m) ==
    /\ pc[r] = "idle" /\ spub
    /\ pc' = [pc EXCEPT ![r] = "read"]
    /\ tgt' = [tgt EXCEPT ![r] = b]
    /\ mode' = [mode EXCEPT ![r] = m]
    /\ pin' = [pin EXCEPT ![r] = sver]
    /\ UNCHANGED <<owned, exists, stored, Src, got, gotVer, n, Ghosts>>

Land(r, b, k, v) ==
    /\ stored' = [stored EXCEPT ![b] = k]
    /\ exists' = [exists EXCEPT ![b] = TRUE]
    /\ wrongVersion' = (wrongVersion \/ v # pin[r])
    /\ copiedHidden' = (copiedHidden \/ ~spub)

(* Fixed = FALSE, step 1: SELECT sand FROM beach WHERE code = $1 AND version = $pin AND public. *)
CopyRead(r) ==
    /\ pc[r] = "read" /\ ~Fixed
    /\ IF spub /\ sver = pin[r]
         THEN /\ pc' = [pc EXCEPT ![r] = "check"]
              /\ got' = [got EXCEPT ![r] = sitems]
              /\ gotVer' = [gotVer EXCEPT ![r] = sver]
         ELSE /\ pc' = [pc EXCEPT ![r] = "idle"]          \* 404 gone, or 409 changed
              /\ UNCHANGED <<got, gotVer>>
    /\ UNCHANGED <<owned, exists, stored, Src, tgt, mode, pin, n, Ghosts>>

(* step 2: fitOf and the allowance *)
CopyCheck(r) ==
    /\ pc[r] = "check"
    /\ LET k == Outcome(tgt[r], got[r], mode[r]) IN
         IF k < 0
           THEN pc' = [pc EXCEPT ![r] = "idle"] /\ UNCHANGED n
           ELSE pc' = [pc EXCEPT ![r] = "write"] /\ n' = [n EXCEPT ![r] = k]
    /\ UNCHANGED <<owned, exists, stored, Src, tgt, mode, pin, got, gotVer, Ghosts>>

(* step 3: the INSERT (new beach) or UPDATE beach ... epoch + 1 *)
CopyWrite(r) ==
    /\ pc[r] = "write"
    /\ pc' = [pc EXCEPT ![r] = "idle"]
    /\ Land(r, tgt[r], n[r], gotVer[r])
    /\ UNCHANGED <<owned, Src, tgt, mode, pin, got, gotVer, n>>

(* Fixed = TRUE: all of it in one transaction holding the player lock, the
   source row read FOR SHARE (so it can't change or leave the shore until
   the copy commits). *)
CopyAtomic(r) ==
    /\ pc[r] = "read" /\ Fixed
    /\ pc' = [pc EXCEPT ![r] = "idle"]
    /\ LET k == Outcome(tgt[r], sitems, mode[r]) IN
         IF spub /\ sver = pin[r] /\ k >= 0
           THEN /\ gotVer' = [gotVer EXCEPT ![r] = sver]
                /\ got' = [got EXCEPT ![r] = sitems]
                /\ Land(r, tgt[r], k, sver)
           ELSE UNCHANGED <<exists, stored, got, gotVer, Ghosts>>
    /\ UNCHANGED <<owned, Src, tgt, mode, pin, n>>

Next ==
    \/ SourceEdit \/ SourceShore \/ Buy
    \/ \E b \in Slots, k \in 0..MaxN : Save(b, k)
    \/ \E r \in Requests :
          \/ CopyRead(r) \/ CopyCheck(r) \/ CopyWrite(r) \/ CopyAtomic(r)
          \/ \E b \in Slots, m \in {"strict", "drop"} : CopyStart(r, b, m)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK ==
    /\ owned \in 1..MaxOwned
    /\ stored \in [Slots -> 0..MaxN]
    /\ sver \in 0..MaxVer

\* Never more of a thing placed, across all your beaches, than you own.
WithinBag == SumOver(stored, Mine) <= owned

\* Never more beaches than your allowance.
WithinAllowance == Cardinality(Mine) <= Allowance

\* You get the version you previewed, or nothing (409 changed).
CopiedWhatSeen == ~wrongVersion

\* A beach taken off the shore is never copied after that.
NoCopyOffShore == ~copiedHidden

\* A beach that isn't yours holds nothing (no write lands on a slot you don't have).
NothingOffBeach == \A b \in Slots : ~exists[b] => stored[b] = 0
=============================================================================
