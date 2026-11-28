----------------------------- MODULE DigFinds -----------------------------
(***************************************************************************)
(* Buried finds (POST /dig-finds, server/src/digFinds.ts,                  *)
(* docs/STATE_MACHINES.md).                                                *)
(*                                                                         *)
(* A good dig rolls for a find: at most one roll every Cooldown, and at   *)
(* most Cap finds a day (UTC). A miss still records the roll, so the next *)
(* waits. One player digs on two devices at once (Requests); each request *)
(* reads the clock once when it starts (`now`, and `today` from it), then *)
(* reads dig_state (the cap and the cooldown, to answer early), rolls,    *)
(* and writes: a miss records its roll, a find records it, counts it and  *)
(* grants the item (with the pull log, in the same statement). A unique   *)
(* find is claimed first, as on the vending machine (Claw.tla).            *)
(*                                                                         *)
(* Fixed = FALSE: the write trusts the early read. Fixed = TRUE (the      *)
(* code): the write is one INSERT ... ON CONFLICT DO UPDATE ... WHERE     *)
(* that re-checks both limits with the request's own `now`:               *)
(*   (dig_state.day <> today OR finds < Cap) AND now - last_roll_at >= Cd *)
(* so a racing second roll, or one that started before midnight and      *)
(* lands after, claims nothing.                                            *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS Requests, Cap, Cooldown, DayLen, MaxTime, Fixed

DayOf(t) == t \div DayLen
NoRoll == -Cooldown                 \* no dig_state row yet: any roll is cool

VARIABLES
    clock,      \* the time now
    day,        \* dig_state.day
    finds,      \* dig_state.finds (on `day`)
    last,       \* dig_state.last_roll_at
    pc,         \* [Requests -> "idle" | "rolled"]
    at,         \* [Requests -> time]: the request's `now`
    found,      \* [Requests -> BOOLEAN]: the roll found something
    granted,    \* ghost: [days -> Nat] finds granted on each day
    rolls       \* ghost: the times rolls were recorded at, with repeats as a count

vars == <<clock, day, finds, last, pc, at, found, granted, rolls>>
Days == 0..DayOf(MaxTime)
Times == 0..MaxTime

Init ==
    /\ clock = 0 /\ day = 0 /\ finds = 0 /\ last = NoRoll
    /\ pc = [r \in Requests |-> "idle"]
    /\ at = [r \in Requests |-> 0]
    /\ found = [r \in Requests |-> FALSE]
    /\ granted = [d \in Days |-> 0]
    /\ rolls = [t \in Times |-> 0]

Tick == clock < MaxTime /\ clock' = clock + 1 /\ UNCHANGED <<day, finds, last, pc, at, found, granted, rolls>>

findsOn(t) == IF day = DayOf(t) THEN finds ELSE 0

(* the request starts: its clock, the early checks (409s), the roll *)
Roll(r) ==
    /\ pc[r] = "idle"
    /\ at' = [at EXCEPT ![r] = clock]
    /\ IF findsOn(clock) >= Cap \/ clock - last < Cooldown
         THEN UNCHANGED <<pc, found>>                            \* 409: all found today / slow down
         ELSE /\ pc' = [pc EXCEPT ![r] = "rolled"]
              /\ \E f \in BOOLEAN : found' = [found EXCEPT ![r] = f]
    /\ UNCHANGED <<clock, day, finds, last, granted, rolls>>

Record(r) ==
    LET t == at[r] IN
    /\ day' = DayOf(t)
    /\ finds' = (IF found[r] THEN findsOn(t) + 1 ELSE findsOn(t))
    /\ last' = t
    /\ rolls' = [rolls EXCEPT ![t] = @ + 1]
    /\ granted' = IF found[r] THEN [granted EXCEPT ![DayOf(t)] = @ + 1] ELSE granted

(* the write: a miss records the roll; a find records, counts and grants *)
Write(r) ==
    LET t == at[r] IN
    /\ pc[r] = "rolled"
    /\ pc' = [pc EXCEPT ![r] = "idle"]
    /\ IF ~Fixed \/ ((~found[r] \/ day # DayOf(t) \/ finds < Cap) /\ t - last >= Cooldown)
         THEN Record(r)
         ELSE UNCHANGED <<day, finds, last, granted, rolls>>    \* 409: claims nothing
    /\ UNCHANGED <<clock, at, found>>

Next == Tick \/ \E r \in Requests : Roll(r) \/ Write(r)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK == clock \in Times /\ finds \in 0..Cap + 2 /\ day \in Days

\* At most Cap finds a day, however many devices dig.
CapHolds == \A d \in Days : granted[d] <= Cap

\* At most one roll every Cooldown: no two recorded rolls closer than that.
OneRollPerCooldown ==
    /\ \A t \in Times : rolls[t] <= 1
    /\ \A t1, t2 \in Times : (t1 < t2 /\ rolls[t1] > 0 /\ rolls[t2] > 0) => t2 - t1 >= Cooldown

\* The row counts what was granted on its day.
Counted == finds = granted[day]
=============================================================================
