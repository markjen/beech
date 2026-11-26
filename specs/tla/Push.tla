------------------------------ MODULE Push ------------------------------
(***************************************************************************)
(* Push notifications for the inbox (docs/INBOX_NOTIFICATIONS.md, "Push",  *)
(* and docs/STATE_MACHINES.md).                                            *)
(*                                                                         *)
(* One player (the recipient) and their devices. Things land in their      *)
(* inbox from other players (actors); some kinds are pushed (a gift, a     *)
(* note, a neighbor request), some never are (a star). A device signs in,  *)
(* subscribes (POST /push/subscribe), unsubscribes (DELETE), signs out     *)
(* (POST /auth/logout, which takes its subscription with it), or is        *)
(* forgotten by the push service (a 404/410 on the next send). The player  *)
(* can block an actor, mute a kind (PUT /notify-prefs) and read the inbox. *)
(*                                                                         *)
(* The sender (the push tick: POST /push/tick or the server's timer, and   *)
(* there can be two at once: two Cloud Run instances, or a tick that runs  *)
(* long) claims the player's due rows, then sends one push to each device, *)
(* one HTTP request at a time, then finishes.                              *)
(*                                                                         *)
(* Fixed = TRUE: commit the claim before contacting any provider. Retake   *)
(* the push lock, recheck subscriptions and rows, and hold the locks      *)
(* through delivery. A crash may lose a push but cannot replay a claim.    *)
(* Fixed = FALSE: read what's due, send, then write it down, with no lock.  *)
(***************************************************************************)
EXTENDS Integers, FiniteSets, Sequences, TLC

CONSTANTS Actors, Devices, Workers, MaxRows, MaxTime, Fixed

Symmetry ==
    { [x \in Actors \cup Devices \cup Workers |->
        CASE x \in Actors -> a[x] [] x \in Devices -> d[x] [] OTHER -> w[x]] :
        a \in Permutations(Actors), d \in Permutations(Devices), w \in Permutations(Workers) }

PushKinds == {"gift", "neighbor"}       \* pushed (notes and visits count as "gift" here)
Kinds == PushKinds \cup {"star"}         \* a star is never pushed
Quiet(t) == t = 1                        \* the player's quiet hours (22:00 to 08:00)
None == "none"

VARIABLES
    rows,       \* the inbox: a sequence of [actor, kind, read, pushed]
    blocked,    \* actors the player has blocked
    muted,      \* push kinds the player turned off (notify_prefs)
    signedIn,   \* devices with a session
    subs,       \* devices with a push subscription (push_subscriptions)
    expired,    \* subscriptions the push service has forgotten (the next send gets 410)
    now,        \* the hour
    lastPush,   \* push_state.last_push_at: the hour of the last push (-1: never)
    lock,       \* who holds the player's push lock (a worker, or None)
    wk,         \* [Workers -> [pc, batch, shown, todo, claimedAt]]
    got,        \* ghost: [Devices -> [1..MaxRows -> times that row reached the device]]
    pushesAt,   \* ghost: [0..MaxTime -> pushes the player got in that hour]
    bad         \* ghost: the rules a delivery broke ("gone", "blocked", "muted", "star", "quiet")

vars == <<rows, blocked, muted, signedIn, subs, expired, now, lastPush, lock, wk, got, pushesAt, bad>>

Ids == 1..MaxRows
Idle == [pc |-> "idle", batch |-> {}, shown |-> {}, todo |-> {}, claimedAt |-> -1]

Init ==
    /\ rows = << >>
    /\ blocked = {} /\ muted = {}
    /\ signedIn = {} /\ subs = {} /\ expired = {}
    /\ now = 0 /\ lastPush = -1
    /\ lock = None
    /\ wk = [w \in Workers |-> Idle]
    /\ got = [d \in Devices |-> [i \in Ids |-> 0]]
    /\ pushesAt = [t \in 0..MaxTime |-> 0]
    /\ bad = {}

Free == lock = None                \* the lock is free (a waiting request goes ahead)
Narrowing == ~Fixed \/ Free        \* unsubscribe, sign out, block, mute: wait for the lock when Fixed

-------------------------------------------------------------------------------
(* Things that happen to the player, and what they do. *)

(* A gift, note, neighbor request or star: the inbox row is written with the action. *)
Arrive(a, k) ==
    /\ Len(rows) < MaxRows
    /\ rows' = Append(rows, [actor |-> a, kind |-> k, read |-> FALSE, pushed |-> FALSE])
    /\ UNCHANGED <<blocked, muted, signedIn, subs, expired, now, lastPush, lock, wk, got, pushesAt, bad>>

(* POST /inbox/read { upTo } *)
Read(i) ==
    /\ i \in DOMAIN rows /\ ~rows[i].read
    /\ IF Fixed /\ ~Free THEN i \notin wk[lock].shown ELSE TRUE
    /\ rows' = [rows EXCEPT ![i].read = TRUE]
    /\ UNCHANGED <<blocked, muted, signedIn, subs, expired, now, lastPush, lock, wk, got, pushesAt, bad>>

(* PUT /blocks/:code: waits for the push lock (Fixed) *)
Block(a) ==
    /\ a \notin blocked /\ Narrowing
    /\ blocked' = blocked \cup {a}
    /\ UNCHANGED <<rows, muted, signedIn, subs, expired, now, lastPush, lock, wk, got, pushesAt, bad>>

(* DELETE /blocks/:code: widens, so it needn't wait *)
Unblock(a) ==
    /\ a \in blocked
    /\ blocked' = blocked \ {a}
    /\ UNCHANGED <<rows, muted, signedIn, subs, expired, now, lastPush, lock, wk, got, pushesAt, bad>>

(* PUT /notify-prefs: read and update the specified kinds under the lock. *)
Mute(k) ==
    /\ k \notin muted /\ Narrowing
    /\ muted' = muted \cup {k}
    /\ UNCHANGED <<rows, blocked, signedIn, subs, expired, now, lastPush, lock, wk, got, pushesAt, bad>>
Unmute(k) ==
    /\ k \in muted /\ Narrowing
    /\ muted' = muted \ {k}
    /\ UNCHANGED <<rows, blocked, signedIn, subs, expired, now, lastPush, lock, wk, got, pushesAt, bad>>

SignIn(d) ==
    /\ d \notin signedIn
    /\ signedIn' = signedIn \cup {d}
    /\ UNCHANGED <<rows, blocked, muted, subs, expired, now, lastPush, lock, wk, got, pushesAt, bad>>

(* POST /push/subscribe: an insert (or a fresh endpoint for the device); needn't wait *)
Subscribe(d) ==
    /\ d \in signedIn
    /\ subs' = subs \cup {d}
    /\ expired' = expired \ {d}
    /\ UNCHANGED <<rows, blocked, muted, signedIn, now, lastPush, lock, wk, got, pushesAt, bad>>

(* DELETE /push/subscribe: the delete waits for the sender's subscription lock. *)
Unsubscribe(d) ==
    /\ d \in subs /\ Narrowing
    /\ subs' = subs \ {d}
    /\ UNCHANGED <<rows, blocked, muted, signedIn, expired, now, lastPush, lock, wk, got, pushesAt, bad>>

(* POST /auth/logout or session expiry: the device stops being eligible. *)
SignOut(d) ==
    /\ d \in signedIn
    /\ d \in subs => Narrowing
    /\ signedIn' = signedIn \ {d}
    /\ subs' = subs \ {d}
    /\ UNCHANGED <<rows, blocked, muted, expired, now, lastPush, lock, wk, got, pushesAt, bad>>

(* The push service drops a subscription (the app was uninstalled, the browser cleared it). *)
Expire(d) ==
    /\ d \in subs /\ d \notin expired
    /\ expired' = expired \cup {d}
    /\ UNCHANGED <<rows, blocked, muted, signedIn, subs, now, lastPush, lock, wk, got, pushesAt, bad>>

Tick ==
    /\ now < MaxTime
    /\ now' = now + 1
    /\ UNCHANGED <<rows, blocked, muted, signedIn, subs, expired, lastPush, lock, wk, got, pushesAt, bad>>

-------------------------------------------------------------------------------
(* The sender. *)

(* Every row of a pushed kind not yet through a claim is due; the claim marks
   them all, and shows only the unread ones from people not blocked, of kinds
   not muted. *)
Due == {i \in DOMAIN rows : ~rows[i].pushed /\ rows[i].kind \in PushKinds}
Shown(batch) == {i \in batch : ~rows[i].read /\ rows[i].actor \notin blocked /\ rows[i].kind \notin muted}

(* Claim reserves the rows and hour durably before external delivery. *)
Claim(w) ==
    /\ wk[w].pc = "idle"
    /\ (Fixed => Free)
    /\ subs # {}                         \* the tick only looks at players with a subscription
    /\ ~Quiet(now)
    /\ lastPush < now                    \* at most one push an hour
    /\ Due # {}
    /\ LET batch == Due
           shown == Shown(batch)
           go    == shown # {}
       IN /\ wk' = [wk EXCEPT ![w] =
                IF Fixed
                    THEN IF go THEN [Idle EXCEPT !.pc = "claimed", !.shown = shown, !.claimedAt = now] ELSE Idle
                    ELSE [Idle EXCEPT !.pc = IF go THEN "sending" ELSE "done", !.batch = batch,
                                      !.shown = shown, !.todo = IF go THEN subs ELSE {}]]
          /\ pushesAt' = IF go THEN [pushesAt EXCEPT ![now] = @ + 1] ELSE pushesAt
          /\ bad' = IF go /\ Quiet(now) THEN bad \cup {"quiet"} ELSE bad
          /\ IF Fixed
               THEN /\ rows' = [i \in DOMAIN rows |-> IF i \in batch THEN [rows[i] EXCEPT !.pushed = TRUE] ELSE rows[i]]
                    /\ lastPush' = IF go THEN now ELSE lastPush
                    /\ UNCHANGED lock
               ELSE UNCHANGED <<rows, lastPush, lock>>
    /\ UNCHANGED <<blocked, muted, signedIn, subs, expired, now, got>>

(* Recheck after the claim commits. Hold the lock until the sends finish. *)
BeginSend(w) ==
    /\ Fixed /\ Free /\ wk[w].pc = "claimed"
    /\ LET shown == Shown(wk[w].shown)
           go == wk[w].claimedAt = now /\ lastPush = now /\ ~Quiet(now) /\ shown # {} /\ subs # {}
       IN /\ wk' = [wk EXCEPT ![w] = IF go THEN [Idle EXCEPT !.pc = "sending", !.shown = shown, !.todo = subs] ELSE Idle]
          /\ lock' = IF go THEN w ELSE None
    /\ UNCHANGED <<rows, blocked, muted, signedIn, subs, expired, now, lastPush, got, pushesAt, bad>>

(* Losing the worker drops only its in-memory work. The claim and any
   external deliveries survive, including when the send transaction rolls back. *)
Crash(w) ==
    /\ wk[w].pc \in {"claimed", "sending"}
    /\ wk' = [wk EXCEPT ![w] = Idle]
    /\ lock' = IF lock = w THEN None ELSE lock
    /\ UNCHANGED <<rows, blocked, muted, signedIn, subs, expired, now, lastPush, got, pushesAt, bad>>

(* One HTTP request to the push service for device d. An expired subscription
   answers 410 and the sender deletes it; anything else is delivered. *)
Deliver(w, d) ==
    /\ wk[w].pc = "sending" /\ d \in wk[w].todo
    /\ wk' = [wk EXCEPT ![w].todo = @ \ {d}]
    /\ IF d \in expired
         THEN /\ subs' = subs \ {d}
              /\ UNCHANGED <<got, bad>>
         ELSE LET shown == wk[w].shown IN
              /\ got' = [got EXCEPT ![d] = [i \in Ids |-> IF i \in shown THEN @[i] + 1 ELSE @[i]]]
              /\ bad' = bad
                        \cup (IF d \notin subs THEN {"gone"} ELSE {})
                        \cup (IF \E i \in shown : rows[i].actor \in blocked THEN {"blocked"} ELSE {})
                        \cup (IF \E i \in shown : rows[i].kind \in muted THEN {"muted"} ELSE {})
                        \cup (IF \E i \in shown : rows[i].kind \notin PushKinds THEN {"star"} ELSE {})
              /\ UNCHANGED subs
    /\ UNCHANGED <<rows, blocked, muted, signedIn, expired, now, lastPush, lock, pushesAt>>

(* Every device done (or nothing to show): write it down and let go. *)
Finish(w) ==
    /\ \/ wk[w].pc = "sending" /\ wk[w].todo = {}
       \/ wk[w].pc = "done"
    /\ wk' = [wk EXCEPT ![w] = Idle]
    /\ IF Fixed
         THEN /\ lock' = IF lock = w THEN None ELSE lock
              /\ UNCHANGED <<rows, lastPush>>
         ELSE /\ rows' = [i \in DOMAIN rows |-> IF i \in wk[w].batch THEN [rows[i] EXCEPT !.pushed = TRUE] ELSE rows[i]]
              /\ lastPush' = IF wk[w].shown # {} THEN now ELSE lastPush
              /\ UNCHANGED lock
    /\ UNCHANGED <<blocked, muted, signedIn, subs, expired, now, got, pushesAt, bad>>

Next ==
    \/ \E a \in Actors, k \in Kinds : Arrive(a, k)
    \/ \E i \in Ids : Read(i)
    \/ \E a \in Actors : Block(a) \/ Unblock(a)
    \/ \E k \in PushKinds : Mute(k) \/ Unmute(k)
    \/ \E d \in Devices : SignIn(d) \/ Subscribe(d) \/ Unsubscribe(d) \/ SignOut(d) \/ Expire(d)
    \/ Tick
    \/ \E w \in Workers : Claim(w) \/ BeginSend(w) \/ Crash(w) \/ Finish(w) \/ \E d \in Devices : Deliver(w, d)

Spec == Init /\ [][Next]_vars

-------------------------------------------------------------------------------
(* The rules. *)

TypeOK ==
    /\ Len(rows) <= MaxRows
    /\ blocked \subseteq Actors /\ muted \subseteq PushKinds
    /\ subs \subseteq Devices /\ expired \subseteq Devices
    /\ lock \in Workers \cup {None}
    /\ now \in 0..MaxTime

(* A row reaches each device at most once. *)
AtMostOnce == \A d \in Devices, i \in Ids : got[d][i] <= 1
(* At most one push an hour. *)
OnePerHour == \A t \in 0..MaxTime : pushesAt[t] <= 1
(* Nothing reaches a device after its unsubscribe or sign-out has returned. *)
NotAfterGone == "gone" \notin bad
(* Nothing from a blocked player reaches a device after the block has returned. *)
NeverBlocked == "blocked" \notin bad
(* Nothing of a muted kind reaches a device after the mute has returned. *)
NeverMuted == "muted" \notin bad
(* Stars are never pushed; nothing is pushed in quiet hours. *)
OnlyPushKinds == "star" \notin bad
NotInQuietHours == "quiet" \notin bad
(* A subscription always belongs to a signed-in device. *)
SubsHaveSessions == subs \subseteq signedIn
=============================================================================
