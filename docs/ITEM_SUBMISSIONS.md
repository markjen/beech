# Community item submissions

Creators can open [Submit an item](https://beechshore.com/submit), connect their Beech account in the game’s sign-in window, and upload an item for review. The form asks for a name, stable slug, description, size, beach behavior, proposed USD price, and proposed frequency or availability. Use zero for a free proposal. The creator must accept the versioned submission terms before uploading. Their original files, proposals, and consent timestamp stay together in the private queue.

Creators can see their own review status, completed sales, earned credit, and spendable Beech balance on the submission page. They can spend the balance in the web shop. It cannot be cashed out.

## Asset specification for creators and agents

Use the [public asset spec](https://beechshore.com/submit/spec), [JSON Schema](https://beechshore.com/submit/schema.json), and [sample asset](https://beechshore.com/submit/example.json) from any modeling tool or AI harness. They also work locally under `/shore/submit`.

Create one static low-poly prop with a clean silhouette, soft colors, and simple materials. Aim for fewer than 2,000 triangles and four materials. Place the pivot at the center of the ground contact. Use meters, positive Y up, and positive Z forward in Beech JSON and Beech TypeScript. Keep the native glTF axes when exporting GLB or glTF. Omit lights, cameras, animations, and external dependencies.

| File | Requirements |
| --- | --- |
| Beech JSON `.json` | Version 1 with 1–32 primitive parts. Shape is `box`, `sphere`, `cylinder`, `cone`, or `torus`. Each part has a position, full XYZ dimensions, and a six-digit hex color. Optional rotation uses XYZ Euler radians. |
| `.glb` or `.gltf` | glTF 2.0 with at least one mesh. Embed resources as binary chunks or Base64 data URIs. The review upload accepts only single-file models. |
| `.ts` | A readable, UTF-8 Babylon.js mesh-builder source file for manual review. Keep geometry and materials in the builder, with no side effects or extra dependencies. |
| `.png` or `.jpg` | Optional preview. An oblique view on a neutral background works well. |

The model limit is 2 MiB and the optional preview limit is 512 KiB. Item size in the form is 0.01–8 m. Give fixed-size items matching minimum and maximum values. A fixed prop stays where placed, a tumble prop rolls in the swash, a float prop rides moving water, and a rock prop raises the sand floor.

Example prompt for an agent:

> Design a small terracotta tide-pool pot for Beech. Return a single Beech JSON asset that validates against the linked schema. Give it a flat base at Y=0, a soft terracotta and sand palette, and a silhouette visible from above. Also suggest its name, slug, description, fixed size in meters, beach behavior, USD price, and availability.

## Review and publishing

1. Open **Item submissions** on the admin console. Open a pending record, inspect the proposal, and download the asset and optional preview. Uploaded models and source are served to authenticated admins as attachments. The server and game do not execute user-uploaded code.
2. Choose **Reject** or **Save approval**. The approval can set a new name, slug, description, behavior, size, frequency, price, or replacement model. The editor preserves the submitted version alongside the approved version. Later changes use the same editor.
3. Ship the approved item through the normal [item catalog workflow](ITEMS.md#adding-an-item). Use the chosen availability to set up the shop, a free item, wash-ashore results, or a prize pool. For a paid item, link its single-item product SKU and catalog item ID in the approval before the catalog release. The SKU can be reserved before it exists. The game shop uses the link when that SKU ships and grants the matching catalog item. Keep the SKU and catalog item ID stable for attribution and existing inventory.
4. A positive approved price is used by the Beech credit and Steam checkouts. Set the corresponding price in Xsolla, App Store Connect, and Google Play before offering the product there. Xsolla validates USD payments against the price recorded at checkout. Apple and Google charge their own catalog prices. An approved price of zero makes the item free: the shop shows **Free** on every platform and grants it from the server with no payment and no store involved (card and Steam checkouts refuse it). A linked item that is for sale needs a price. To keep a linked item out of Beech’s shop, tick **Not for sale** (or reject the entry); its price is kept for when it goes back on sale. Approvals saved before this choice existed with a blank or zero price were marked not for sale. Update store availability as needed. Already-open provider orders and verified receipts can still deliver their items.

## Credit and accounting

A completed purchase for an approved, linked item adds 30% to the creator’s Beech account, rounded to the nearest cent. Web and Steam use the USD price recorded at checkout. Apple and Google use the approved USD price in effect at the verified purchase time. Credit purchases use the amount paid after a promo. Fully discounted purchases, gifts, prizes, and sandbox transactions do not earn creator credit.

Purchase grants and creator credit commit together. Repeat store receipts and retried web credit requests use their existing transaction or order ID. Store refunds reverse sales and their credit once. If the creator already spent some of that credit, future creator earnings recover the shortfall.

The public shore uses a separate, short-lived submission token issued by the Beech game server. It permits only a creator’s own submission list and uploads. Game sign-out revokes it. Uploaded content stays private during review. Review decisions appear in the admin audit log.
