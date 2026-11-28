---------------------------- MODULE ShopOrders ----------------------------
(***************************************************************************)
(* Shop orders and refunds, for real money (docs/WEB_PAYMENTS.md,          *)
(* docs/STEAM.md, docs/STATE_MACHINES.md). One purchase on each of the    *)
(* three ways to pay, each with two devices or retries at once:           *)
(*                                                                         *)
(* App stores (Apple, Google): the store charges; the app posts the       *)
(* purchase (POST /store/purchase), which is checked with the store       *)
(* (refunded already: 402), then recorded once (purchases, unique per     *)
(* store transaction) and granted. A refund notification (App Store       *)
(* Server Notifications, Google RTDN) revokes it (revokeStorePurchase).   *)
(*                                                                         *)
(* Xsolla (the web shop): our order row (web_orders), then Xsolla's       *)
(* webhooks, each at least once: order_paid grants, order_canceled and    *)
(* refund take it back; a canceled order is never revived.                *)
(*                                                                         *)
(* Steam Wallet: our order row (steam_orders); the player approves in the *)
(* overlay; POST /store/steam/finalize reads the order, asks Steam to     *)
(* finalize (that takes the money), then grants in a transaction holding  *)
(* the order row; POST /store/steam/cancel cancels an open order; the     *)
(* refund sync (syncSteamRefunds) revokes what Steam refunded.            *)
(*                                                                         *)
(* Fixed = FALSE: the code before this model. A refund notification for a *)
(* purchase not recorded yet changed nothing, so a purchase checked just  *)
(* before the refund was recorded and granted just after it. A cancel     *)
(* that landed while finalize was at Steam left a paid order ungranted.   *)
(* Fixed = TRUE: a refund notification records the refund even when the   *)
(* purchase isn't there yet (store_refunds), and recording a purchase     *)
(* refuses a refunded one; both take the same per-transaction lock. A     *)
(* finalize Steam confirmed grants a canceled order too, and the refund   *)
(* sync refunds a canceled order like an open one.                        *)
(***************************************************************************)
EXTENDS Integers

CONSTANTS Devices, Fixed

VARIABLES
    \* app stores
    nStore,     \* "none" | "paid" | "refunded": at Apple/Google
    nRow,       \* "none" | "granted" | "revoked": our purchases row
    nTomb,      \* store_refunds has the transaction
    nNote,      \* the refund notification was handled
    nPc,        \* [Devices -> "idle" | "checked" | "done"]
    nGrants,    \* ghost: times granted
    \* Xsolla
    xStore,     \* "open" | "paid" | "refunded" | "canceled": at Xsolla
    xOrder,     \* web_orders.status: "created" | "paid" | "refunded" | "canceled"
    xGrants,    \* ghost
    xLive,      \* the grant is in the bag (not revoked)
    xPaidSeen,  \* an order_paid was handled
    xBackSeen,  \* an order_canceled or refund was handled
    \* Steam
    sStore,     \* "open" | "authorized" | "declined" | "finalized" | "refunded"
    sOrder,     \* steam_orders.status
    sPc,        \* [Devices -> "idle" | "read" | "atSteam" | "done"]
    sGrants,    \* ghost
    sLive,
    sAnswered,  \* ghost: a finalize that Steam confirmed has answered the app
    sSynced     \* the refund sync ran after Steam's refund

nVars == <<nStore, nRow, nTomb, nNote, nPc, nGrants>>
xVars == <<xStore, xOrder, xGrants, xLive, xPaidSeen, xBackSeen>>
sVars == <<sStore, sOrder, sPc, sGrants, sLive, sAnswered, sSynced>>
vars == <<nVars, xVars, sVars>>

Init ==
    /\ nStore = "none" /\ nRow = "none" /\ nTomb = FALSE /\ nNote = FALSE
    /\ nPc = [d \in Devices |-> "idle"] /\ nGrants = 0
    /\ xStore = "open" /\ xOrder = "created" /\ xGrants = 0 /\ xLive = FALSE
    /\ xPaidSeen = FALSE /\ xBackSeen = FALSE
    /\ sStore = "open" /\ sOrder = "created" /\ sPc = [d \in Devices |-> "idle"]
    /\ sGrants = 0 /\ sLive = FALSE /\ sAnswered = FALSE /\ sSynced = FALSE

-----------------------------------------------------------------------------
(* App stores *)
NPay == nStore = "none" /\ nStore' = "paid" /\ UNCHANGED <<nRow, nTomb, nNote, nPc, nGrants>>
NStoreRefund == nStore = "paid" /\ nStore' = "refunded" /\ UNCHANGED <<nRow, nTomb, nNote, nPc, nGrants>>

(* POST /store/purchase, step 1: the store checks the purchase *)
NCheck(d) ==
    /\ nPc[d] = "idle" /\ nStore # "none"
    /\ nPc' = [nPc EXCEPT ![d] = IF nStore = "paid" THEN "checked" ELSE "done"]   \* refunded: 402
    /\ UNCHANGED <<nStore, nRow, nTomb, nNote, nGrants>>

(* step 2: record once and grant, in one transaction *)
NRecord(d) ==
    /\ nPc[d] = "checked"
    /\ nPc' = [nPc EXCEPT ![d] = "done"]
    /\ IF nRow = "none" /\ ~(Fixed /\ nTomb)
         THEN nRow' = "granted" /\ nGrants' = nGrants + 1
         ELSE UNCHANGED <<nRow, nGrants>>                                      \* already / refunded
    /\ UNCHANGED <<nStore, nTomb, nNote>>

(* the refund notification, one transaction *)
NNote ==
    /\ nStore = "refunded"
    /\ nNote' = TRUE
    /\ nRow' = IF nRow = "granted" THEN "revoked" ELSE nRow
    /\ nTomb' = (Fixed \/ nTomb)
    /\ UNCHANGED <<nStore, nPc, nGrants>>

NNext == NPay \/ NStoreRefund \/ NNote \/ \E d \in Devices : NCheck(d) \/ NRecord(d)

-----------------------------------------------------------------------------
(* Xsolla *)
XPay == xStore = "open" /\ xStore' = "paid" /\ UNCHANGED <<xOrder, xGrants, xLive, xPaidSeen, xBackSeen>>
XCancel == xStore = "open" /\ xStore' = "canceled" /\ UNCHANGED <<xOrder, xGrants, xLive, xPaidSeen, xBackSeen>>
XRefund == xStore = "paid" /\ xStore' = "refunded" /\ UNCHANGED <<xOrder, xGrants, xLive, xPaidSeen, xBackSeen>>

(* order_paid (any number of times once paid): one transaction holding the order row *)
XPaidHook ==
    /\ xStore \in {"paid", "refunded"}
    /\ xPaidSeen' = TRUE
    /\ IF xOrder = "created"
         THEN xOrder' = "paid" /\ xGrants' = xGrants + 1 /\ xLive' = TRUE
         ELSE UNCHANGED <<xOrder, xGrants, xLive>>                                \* already, or canceled: not revived
    /\ UNCHANGED <<xStore, xBackSeen>>

(* order_canceled / refund: one transaction *)
XBackHook ==
    /\ xStore \in {"refunded", "canceled"}
    /\ xBackSeen' = TRUE
    /\ xOrder' = CASE xOrder = "paid" -> "refunded" [] xOrder = "created" -> "canceled" [] OTHER -> xOrder
    /\ xLive' = FALSE
    /\ UNCHANGED <<xStore, xGrants, xPaidSeen>>

XNext == XPay \/ XCancel \/ XRefund \/ XPaidHook \/ XBackHook

-----------------------------------------------------------------------------
(* Steam *)
SAuthorize == sStore = "open" /\ sStore' = "authorized" /\ UNCHANGED <<sOrder, sPc, sGrants, sLive, sAnswered, sSynced>>
SDecline == sStore = "open" /\ sStore' = "declined" /\ UNCHANGED <<sOrder, sPc, sGrants, sLive, sAnswered, sSynced>>
SRefund == sStore = "finalized" /\ sStore' = "refunded" /\ UNCHANGED <<sOrder, sPc, sGrants, sLive, sAnswered, sSynced>>

(* POST /store/steam/cancel: one statement, open orders only *)
SCancel ==
    /\ sOrder = "created" /\ sOrder' = "canceled"
    /\ UNCHANGED <<sStore, sPc, sGrants, sLive, sAnswered, sSynced>>

(* POST /store/steam/finalize, step 1: read the order *)
SFinRead(d) ==
    /\ sPc[d] = "idle"
    /\ sPc' = [sPc EXCEPT ![d] = IF sOrder = "created" THEN "read" ELSE "done"]   \* paid: already; else 409
    /\ UNCHANGED <<sStore, sOrder, sGrants, sLive, sAnswered, sSynced>>

(* step 2: FinalizeTxn at Steam (takes the money if the player approved) *)
SFinSteam(d) ==
    /\ sPc[d] = "read"
    /\ IF sStore \in {"authorized", "finalized"}
         THEN sStore' = "finalized" /\ sPc' = [sPc EXCEPT ![d] = "atSteam"]
         ELSE UNCHANGED sStore /\ sPc' = [sPc EXCEPT ![d] = "done"]              \* 402
    /\ UNCHANGED <<sOrder, sGrants, sLive, sAnswered, sSynced>>

(* step 3: the grant, one transaction holding the order row *)
SFinGrant(d) ==
    /\ sPc[d] = "atSteam"
    /\ sPc' = [sPc EXCEPT ![d] = "done"]
    /\ sAnswered' = TRUE
    /\ IF sOrder = "created" \/ (Fixed /\ sOrder = "canceled")
         THEN sOrder' = "paid" /\ sGrants' = sGrants + 1 /\ sLive' = TRUE
         ELSE UNCHANGED <<sOrder, sGrants, sLive>>                               \* paid: already; else 409
    /\ UNCHANGED <<sStore, sSynced>>

(* the refund sync: one transaction per refunded transaction *)
SSync ==
    /\ sStore = "refunded"
    /\ sSynced' = TRUE
    /\ sOrder' = IF sOrder \in ({"created", "paid"} \cup (IF Fixed THEN {"canceled"} ELSE {})) THEN "refunded" ELSE sOrder
    /\ sLive' = FALSE
    /\ UNCHANGED <<sStore, sPc, sGrants, sAnswered>>

SNext == SAuthorize \/ SDecline \/ SRefund \/ SCancel \/ SSync
         \/ \E d \in Devices : SFinRead(d) \/ SFinSteam(d) \/ SFinGrant(d)

-----------------------------------------------------------------------------
Next ==
    \/ NNext /\ UNCHANGED <<xVars, sVars>>
    \/ XNext /\ UNCHANGED <<nVars, sVars>>
    \/ SNext /\ UNCHANGED <<nVars, xVars>>

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK == nGrants \in 0..2 /\ xGrants \in 0..2 /\ sGrants \in 0..2

\* A payment grants once, however many devices, retries and webhooks.
GrantedOnce == nGrants <= 1 /\ xGrants <= 1 /\ sGrants <= 1

\* A refund that was handled takes the purchase back, and nothing later
\* grants it again.
RefundIsFinal ==
    /\ nNote => nRow # "granted"
    /\ xBackSeen => ~xLive
    /\ sSynced => ~sLive

\* What was paid for (and not refunded) is in the bag once the shop has
\* answered: the app got its answer, order_paid was handled, or a finalize
\* that Steam confirmed answered.
PaidIsGranted ==
    /\ (nStore = "paid" /\ \E d \in Devices : nPc[d] = "done") => nRow = "granted"
    /\ (xStore = "paid" /\ xPaidSeen) => xLive
    /\ (sStore = "finalized" /\ sAnswered) => sLive
=============================================================================
