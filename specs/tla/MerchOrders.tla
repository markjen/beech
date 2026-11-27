---------------------------- MODULE MerchOrders ----------------------------
(* The merch store's orders (docs/MERCH_STORE.md): a shopper pays through  *)
(* Stripe Checkout, and the order goes to Printful to be printed and       *)
(* shipped. A "your beach" shirt or hoodie prints the shopper's own beach  *)
(* as it was when they ordered.                                            *)
(*                                                                         *)
(* Stripe is the payment's source of truth. It tells us by webhook, and    *)
(* delivers each event at least once, in any order (completed, expired,    *)
(* refunded). The return page also asks Stripe about the session, so two   *)
(* handlers can mark the same order paid at once. Submitting to Printful   *)
(* is two calls (a draft keyed by our order id, which Printful dedupes,    *)
(* then confirm, which starts production) made by a worker that can be     *)
(* slow, fail or die; a sweep gives a stale claim back.                    *)
(*                                                                         *)
(*   Checkout(o)      POST /api/merch/checkout (snapshots the beach)        *)
(*   Edit             the owner keeps building the beach                    *)
(*   Pays/Lapses(o)   Stripe: the shopper pays, or the session expires      *)
(*   Refund(o)        a refund in the Stripe dashboard                      *)
(*   Deliver(h,o,e)   POST /api/merch/stripe-webhook, or the return page's  *)
(*                    GET /api/merch/orders/:id (h = hook | page)           *)
(*   Claim/Draft/Mark/Confirm(w,o)  the submit worker (merchSubmit)         *)
(*   Recover(o)       the sweep: a claim older than 10 minutes goes back    *)
(*   Ships(o)         POST /api/merch/printful-webhook (package_shipped)    *)
(*                                                                         *)
(* Fixed = FALSE, the obvious build:                                       *)
(*   - "completed" reads the order, then (another statement) marks it paid *)
(*     and sends the receipt;                                              *)
(*   - our own sweep expires orders left open, and "completed" only moves  *)
(*     an open order;                                                      *)
(*   - the print file is drawn from the beach when the order is sent;      *)
(*   - the worker confirms with Printful, then marks the order sent.       *)
(* Fixed = TRUE, what is built:                                            *)
(*   - "completed" is one UPDATE ... WHERE status IN ('open','expired')    *)
(*     RETURNING, and only the handler that got the row sends the receipt; *)
(*   - only Stripe expires a session (no sweep of our own), and a late     *)
(*     "completed" still wins over "expired";                              *)
(*   - the print file is the beach snapshot taken at checkout;             *)
(*   - the worker marks the order sent (UPDATE ... WHERE status='sending'  *)
(*     AND claim = its token) before it confirms, so a refund that lands   *)
(*     first stops it, and a refund after is a refund after production;    *)
(*   - a refund cancels the order in any state before sent, including     *)
(*     open and expired (its "completed" may not have arrived yet).        *)
EXTENDS Integers, FiniteSets

CONSTANTS Orders, Workers, Handlers, MaxV, Fixed

None == "none"
Events == {"completed", "expired", "refunded"}
Statuses == {"none", "open", "expired", "paid", "sending", "sent", "shipped", "canceled", "refunded"}

VARIABLES
    beachV,     \* the beach's version (the owner's edits)
    status,     \* merch_orders.status
    design,     \* merch_orders: the beach version snapshotted at checkout
    claim,      \* merch_orders.claim: the worker holding the send, or None
    stripe,     \* Stripe's session: "none" | "open" | "paid" | "expired"
    refunded,   \* Stripe: the charge was refunded
    events,     \* events Stripe has to deliver (each can come again)
    delivered,  \* events delivered at least once
    hpc,        \* [Handlers -> None | order the handler read as payable]
    wpc,        \* [Workers -> "idle" | "claimed" | "drafted" | "confirming"]
    word,       \* [Workers -> order it works on, or None]
    draft,      \* Printful: a draft order exists for o (keyed by external_id)
    draftV,     \* Printful: the beach version its print file shows
    printed,    \* Printful: confirmed (in production)
    receipts,   \* ghost: receipt emails sent per order
    early       \* ghost: refunded before it was sent

vars == <<beachV, status, design, claim, stripe, refunded, events, delivered,
          hpc, wpc, word, draft, draftV, printed, receipts, early>>

Init ==
    /\ beachV = 0
    /\ status = [o \in Orders |-> "none"]
    /\ design = [o \in Orders |-> -1]
    /\ claim = [o \in Orders |-> None]
    /\ stripe = [o \in Orders |-> "none"]
    /\ refunded = [o \in Orders |-> FALSE]
    /\ events = [o \in Orders |-> {}]
    /\ delivered = [o \in Orders |-> {}]
    /\ hpc = [h \in Handlers |-> None]
    /\ wpc = [w \in Workers |-> "idle"]
    /\ word = [w \in Workers |-> None]
    /\ draft = [o \in Orders |-> FALSE]
    /\ draftV = [o \in Orders |-> -1]
    /\ printed = [o \in Orders |-> FALSE]
    /\ receipts = [o \in Orders |-> 0]
    /\ early = [o \in Orders |-> FALSE]

Shop == <<beachV, design>>
Pay == <<stripe, refunded, events>>
Printer == <<draft, draftV, printed>>
Work == <<wpc, word, claim>>

(* ---------------------------------------------------------------- shopper *)

Checkout(o) ==
    /\ status[o] = "none"
    /\ status' = [status EXCEPT ![o] = "open"]
    /\ design' = [design EXCEPT ![o] = beachV]
    /\ stripe' = [stripe EXCEPT ![o] = "open"]
    /\ UNCHANGED <<beachV, claim, refunded, events, delivered, hpc, wpc, word, Printer, receipts, early>>

Edit ==
    /\ beachV < MaxV
    /\ beachV' = beachV + 1
    /\ UNCHANGED <<status, design, claim, Pay, delivered, hpc, wpc, word, Printer, receipts, early>>

(* ---------------------------------------------------------------- Stripe *)

Pays(o) ==
    /\ stripe[o] = "open"
    /\ stripe' = [stripe EXCEPT ![o] = "paid"]
    /\ events' = [events EXCEPT ![o] = @ \cup {"completed"}]
    /\ UNCHANGED <<Shop, status, claim, refunded, delivered, hpc, wpc, word, Printer, receipts, early>>

Lapses(o) ==
    /\ stripe[o] = "open"
    /\ stripe' = [stripe EXCEPT ![o] = "expired"]
    /\ events' = [events EXCEPT ![o] = @ \cup {"expired"}]
    /\ UNCHANGED <<Shop, status, claim, refunded, delivered, hpc, wpc, word, Printer, receipts, early>>

Refund(o) ==
    /\ stripe[o] = "paid"
    /\ ~refunded[o]
    /\ refunded' = [refunded EXCEPT ![o] = TRUE]
    /\ events' = [events EXCEPT ![o] = @ \cup {"refunded"}]
    /\ UNCHANGED <<Shop, status, claim, stripe, delivered, hpc, wpc, word, Printer, receipts, early>>

(* our own sweep of orders left open (the obvious build only) *)
ExpireLocal(o) ==
    /\ ~Fixed
    /\ status[o] = "open"
    /\ status' = [status EXCEPT ![o] = "expired"]
    /\ UNCHANGED <<Shop, claim, Pay, delivered, hpc, wpc, word, Printer, receipts, early>>

(* ------------------------------------------------------- our event handlers *)

Payable(o) == IF Fixed THEN status[o] \in {"open", "expired"} ELSE status[o] = "open"

MarkPaid(o) ==
    /\ status' = [status EXCEPT ![o] = "paid"]
    /\ receipts' = [receipts EXCEPT ![o] = @ + 1]

Seen(o, e) == delivered' = [delivered EXCEPT ![o] = @ \cup {e}]

(* "completed": the webhook, or the return page asking Stripe *)
Completed(h, o) ==
    /\ "completed" \in events[o]
    /\ hpc[h] = None
    /\ Seen(o, "completed")
    /\ IF Fixed
         THEN /\ IF Payable(o) THEN MarkPaid(o) ELSE UNCHANGED <<status, receipts>>
              /\ UNCHANGED hpc
         ELSE /\ hpc' = IF Payable(o) THEN [hpc EXCEPT ![h] = o] ELSE hpc
              /\ UNCHANGED <<status, receipts>>
    /\ UNCHANGED <<Shop, claim, Pay, wpc, word, Printer, early>>
CompletedWrite(h) ==
    /\ hpc[h] /= None
    /\ MarkPaid(hpc[h])
    /\ hpc' = [hpc EXCEPT ![h] = None]
    /\ UNCHANGED <<Shop, claim, Pay, delivered, wpc, word, Printer, early>>

Expired(o) ==
    /\ "expired" \in events[o]
    /\ Seen(o, "expired")
    /\ status' = IF status[o] = "open" THEN [status EXCEPT ![o] = "expired"] ELSE status
    /\ UNCHANGED <<Shop, claim, Pay, hpc, wpc, word, Printer, receipts, early>>

Refunded(o) ==
    /\ "refunded" \in events[o]
    /\ Seen(o, "refunded")
    /\ LET before == IF Fixed THEN {"open", "expired", "paid", "sending"} ELSE {"paid", "sending"} IN
       IF status[o] \in before
         THEN /\ status' = [status EXCEPT ![o] = "canceled"]
              /\ early' = [early EXCEPT ![o] = TRUE]
         ELSE /\ status' = IF status[o] \in {"sent", "shipped"} THEN [status EXCEPT ![o] = "refunded"] ELSE status
              /\ UNCHANGED early
    /\ UNCHANGED <<Shop, claim, Pay, hpc, wpc, word, Printer, receipts>>

(* ---------------------------------------------------------------- worker *)

(* UPDATE merch_orders SET status='sending', claim=$token WHERE status='paid' RETURNING *)
Claim(w, o) ==
    /\ wpc[w] = "idle"
    /\ status[o] = "paid"
    /\ status' = [status EXCEPT ![o] = "sending"]
    /\ claim' = [claim EXCEPT ![o] = w]
    /\ wpc' = [wpc EXCEPT ![w] = "claimed"]
    /\ word' = [word EXCEPT ![w] = o]
    /\ UNCHANGED <<Shop, Pay, delivered, hpc, Printer, receipts, early>>

(* POST /orders?confirm=false with external_id: Printful keeps the first *)
Draft(w) ==
    LET o == word[w] IN
    /\ wpc[w] = "claimed"
    /\ IF draft[o] THEN UNCHANGED <<draft, draftV>>
       ELSE /\ draft' = [draft EXCEPT ![o] = TRUE]
            /\ draftV' = [draftV EXCEPT ![o] = IF Fixed THEN design[o] ELSE beachV]
    /\ wpc' = [wpc EXCEPT ![w] = "drafted"]
    /\ UNCHANGED <<Shop, status, claim, Pay, delivered, hpc, word, printed, receipts, early>>

Release(w) ==
    /\ wpc' = [wpc EXCEPT ![w] = "idle"]
    /\ word' = [word EXCEPT ![w] = None]

(* Fixed: UPDATE ... SET status='sent' WHERE status='sending' AND claim=$token *)
Mark(w) ==
    LET o == word[w] IN
    /\ wpc[w] = "drafted"
    /\ IF ~Fixed
         THEN /\ wpc' = [wpc EXCEPT ![w] = "confirming"]
              /\ UNCHANGED <<status, word>>
         ELSE IF status[o] = "sending" /\ claim[o] = w
           THEN /\ status' = [status EXCEPT ![o] = "sent"]
                /\ wpc' = [wpc EXCEPT ![w] = "confirming"]
                /\ UNCHANGED word
           ELSE /\ Release(w)   \* refunded or given back meanwhile: stop
                /\ UNCHANGED status
    /\ UNCHANGED <<Shop, claim, Pay, delivered, hpc, Printer, receipts, early>>

(* POST /orders/@external_id/confirm (Printful: confirming twice is a no-op) *)
Confirm(w) ==
    LET o == word[w] IN
    /\ wpc[w] = "confirming"
    /\ printed' = [printed EXCEPT ![o] = TRUE]
    /\ status' = IF ~Fixed /\ status[o] = "sending" THEN [status EXCEPT ![o] = "sent"] ELSE status
    /\ Release(w)
    /\ UNCHANGED <<Shop, claim, Pay, delivered, hpc, draft, draftV, receipts, early>>

(* the worker dies or Printful errors: it just stops (the sweep recovers) *)
Crash(w) ==
    /\ wpc[w] /= "idle"
    /\ Release(w)
    /\ UNCHANGED <<Shop, status, claim, Pay, delivered, hpc, Printer, receipts, early>>

(* the sweep: UPDATE ... SET status='paid', claim=NULL WHERE status='sending' AND claimed_at < now - 10min *)
Recover(o) ==
    /\ status[o] = "sending"
    /\ status' = [status EXCEPT ![o] = "paid"]
    /\ claim' = [claim EXCEPT ![o] = None]
    /\ UNCHANGED <<Shop, Pay, delivered, hpc, wpc, word, Printer, receipts, early>>

(* Printful: package_shipped *)
Ships(o) ==
    /\ printed[o]
    /\ status[o] = "sent"
    /\ status' = [status EXCEPT ![o] = "shipped"]
    /\ UNCHANGED <<Shop, claim, Pay, delivered, hpc, wpc, word, Printer, receipts, early>>

Next ==
    \/ Edit
    \/ \E o \in Orders :
         \/ Checkout(o) \/ Pays(o) \/ Lapses(o) \/ Refund(o) \/ ExpireLocal(o)
         \/ Expired(o) \/ Refunded(o) \/ Recover(o) \/ Ships(o)
         \/ \E h \in Handlers : Completed(h, o)
         \/ \E w \in Workers : Claim(w, o)
    \/ \E h \in Handlers : CompletedWrite(h)
    \/ \E w \in Workers : Draft(w) \/ Mark(w) \/ Confirm(w) \/ Crash(w)

Spec == Init /\ [][Next]_vars

\* receipts only grow in the obvious build; bound the search there
Bound == \A o \in Orders : receipts[o] <= 2

TypeOK ==
    /\ status \in [Orders -> Statuses]
    /\ wpc \in [Workers -> {"idle", "claimed", "drafted", "confirming"}]
    /\ stripe \in [Orders -> {"none", "open", "paid", "expired"}]
    /\ \A o \in Orders : events[o] \subseteq Events /\ delivered[o] \subseteq events[o]

(* The rules, in the store's words. *)
(* one receipt per order, however many times Stripe tells us *)
OneReceipt == \A o \in Orders : receipts[o] <= 1
(* nothing is printed that wasn't paid for *)
PrintOnlyPaid == \A o \in Orders : printed[o] => stripe[o] = "paid"
(* a refund before it was sent stops it being printed *)
NoPrintAfterEarlyRefund == \A o \in Orders : early[o] => ~printed[o]
(* the shirt shows the beach as it was when they ordered *)
PrintIsWhatTheyBought == \A o \in Orders : draft[o] => draftV[o] = design[o]
(* once Stripe's events are all in and no worker is busy, a paid, unrefunded *)
(* order is on its way (paid, being sent, sent or shipped), never left expired *)
Settled ==
    (\A o \in Orders : delivered[o] = events[o]) /\ (\A w \in Workers : wpc[w] = "idle") /\ (\A h \in Handlers : hpc[h] = None)
PaidIsFulfilled ==
    Settled => \A o \in Orders :
        (stripe[o] = "paid" /\ ~refunded[o]) => status[o] \in {"paid", "sending", "sent", "shipped"}
(* a refunded order is never left looking live *)
RefundIsFinal ==
    Settled => \A o \in Orders : refunded[o] => status[o] \in {"canceled", "refunded"}
=============================================================================
