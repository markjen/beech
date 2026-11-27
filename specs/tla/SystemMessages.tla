--------------------------- MODULE SystemMessages ---------------------------
(* The admin's "system" messages (docs/INBOX_NOTIFICATIONS.md, "system"):  *)
(* one message to every player's inbox (and their phones, if their "news"  *)
(* is on), at most one a day. The admin console can send the same request  *)
(* twice (a double click, a retry after a lost answer), and two admins, or *)
(* two tabs, can send at once.                                             *)
(*                                                                         *)
(*   Send(r)   POST /api/system-messages { text, requestId } (admin)        *)
(*   Join(p)   a player makes an account (gets only later messages)         *)
(*                                                                         *)
(* Fixed = FALSE: the route checks "nothing sent today, this request not    *)
(* seen", then (another statement) writes the message and the rows.        *)
(* Fixed = TRUE: one statement: INSERT INTO system_messages ... ON CONFLICT  *)
(* (day) DO NOTHING, and the inbox rows from what it returned, so the       *)
(* day's key decides and a retry finds the day taken.                       *)
EXTENDS Integers, FiniteSets

CONSTANTS Requests, Players, Days, Fixed

VARIABLES
    day,        \* the UTC day now
    msgs,       \* system_messages: a set of [day, req]
    rows,       \* inbox rows of kind 'system': a set of [player, msg]
    members,    \* players with an account
    pc,         \* [Requests -> "idle" | "checked" | "done"]
    sentAt      \* ghost: [Requests -> day it was checked on]

vars == <<day, msgs, rows, members, pc, sentAt>>

Init ==
    /\ day = 1
    /\ msgs = {}
    /\ rows = {}
    /\ members = {}
    /\ pc = [r \in Requests |-> "idle"]
    /\ sentAt = [r \in Requests |-> 0]

Today == {m \in msgs : m.day = day}
Seen(r) == \E m \in msgs : m.req = r

Write(r) ==
    LET m == [day |-> day, req |-> r] IN
    /\ msgs' = msgs \cup {m}
    /\ rows' = rows \cup {[player |-> p, msg |-> m] : p \in members}

(* the admin sends (or resends) request r; refused when today has one or r was seen *)
Send(r) ==
    /\ pc[r] = "idle"
    /\ IF Fixed
         THEN /\ IF Today = {} /\ ~Seen(r) THEN Write(r) ELSE UNCHANGED <<msgs, rows>>
              /\ pc' = [pc EXCEPT ![r] = "done"]
              /\ UNCHANGED <<day, members, sentAt>>
         ELSE /\ Today = {} /\ ~Seen(r)
              /\ pc' = [pc EXCEPT ![r] = "checked"]
              /\ sentAt' = [sentAt EXCEPT ![r] = day]
              /\ UNCHANGED <<day, msgs, rows, members>>
SendWrite(r) ==
    /\ pc[r] = "checked"
    /\ Write(r)
    /\ pc' = [pc EXCEPT ![r] = "done"]
    /\ UNCHANGED <<day, members, sentAt>>

(* the admin tries again later (a retry of the same request) *)
Retry(r) ==
    /\ pc[r] = "done"
    /\ pc' = [pc EXCEPT ![r] = "idle"]
    /\ UNCHANGED <<day, msgs, rows, members, sentAt>>

Join(p) ==
    /\ p \notin members
    /\ members' = members \cup {p}
    /\ UNCHANGED <<day, msgs, rows, pc, sentAt>>

NextDay ==
    /\ day < Days
    /\ day' = day + 1
    /\ UNCHANGED <<msgs, rows, members, pc, sentAt>>

Next ==
    \/ \E r \in Requests : Send(r) \/ SendWrite(r) \/ Retry(r)
    \/ \E p \in Players : Join(p)
    \/ NextDay

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ day \in 1..Days
    /\ pc \in [Requests -> {"idle", "checked", "done"}]

(* The rules. *)
(* at most one message a day *)
OneADay == \A d \in 1..Days : Cardinality({m \in msgs : m.day = d}) <= 1
(* a request is sent once, however often it's retried *)
OncePerRequest == \A r \in Requests : Cardinality({m \in msgs : m.req = r}) <= 1
(* every message reached everyone who had an account then, once each *)
OneRowEach == \A m \in msgs, p \in Players : Cardinality({x \in rows : x.player = p /\ x.msg = m}) <= 1
=============================================================================
