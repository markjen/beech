# Observability

How beech is watched in production: what is measured, where the dashboard
lives, what alerts fire, and how to add more. The setup is Terraform in
`infra/monitoring.tf`; the instrumentation is `server/src/observability.ts`
plus a small client reporter in `src/net/telemetry.ts`.

## The choice: structured JSON logs + log-based metrics

Cloud Run already sends the service's stdout to Cloud Logging, so the
server writes one JSON line per request and the metrics are computed from
those lines. No new dependency, no exporter, no extra service to operate.

The alternative, OpenTelemetry with the Google Cloud exporter, would add
several packages, trace context and a `monitoring.metricWriter` grant for
the runtime service account. That is the right move if distributed tracing
is ever needed; for counts, latency and errors on one service, logs are
enough. (Cloud Trace has its own free tier — 2.5M spans/month — if
tracing comes later.)

## What is measured

### Server (every request)

`server/src/observability.ts` — `httpLogger` middleware, mounted once
on the root app (not also on the API app, which would log every API
request twice), so it covers `/api/*`, `/healthz`, static files and
the SPA fallback. One line per request:

```json
{"severity":"INFO","time":"...","service":"beech","revision":"beech-00002-abc","event":"http_request","method":"GET","route":"/api/beaches/:code","status":200,"duration_ms":42.3}
```

- `route` is the matched route template. Raw paths are never logged as
  labels: anything unmatched is bucketed as `static`, `spa` or
  `unmatched`, so a neighbor code in a URL can never become a metric
  label. No user ids, beach ids or IPs appear anywhere.
- 5xx lines are severity `ERROR`, 4xx `WARNING`.
- The first request a process serves carries `cold_start: true` — with
  min-instances 0 the service cold-starts often, and a slow first request
  is the container starting, not the route being slow.
- `revision` is the Cloud Run revision (`K_REVISION`) — the deploy
  marker. `server_start` lines carry it too; find a deploy in Logs
  Explorer with `jsonPayload.event="server_start"`.

### Database

`server/src/db.ts` times every query (the SQL text and params are never
logged — they can hold user data):

- `db_error` (severity `ERROR`): a failed query, with only the Postgres
  error code, the duration, the operation label (below) and the pool state.
- `db_slow_query` (severity `WARNING`): any query over 500 ms, with the
  operation label, the duration and the pool's total/idle/waiting counts
  at the time — so a slow query can be attributed to the code path that
  issued it and checked against pool saturation.
- `db_summary` once a minute: query/error/slow counts, p50/p95 latency
  over the last 1,000 queries, and the `pg` pool's total/idle/waiting
  counts.

The operation label is an optional third argument to `Db.query`
(default `'db.query'`), threaded through the hot paths only: the shore
graph (`shore.linked`, `shore.nodeById`, `shore.nodeByCode`,
`shore.nextStretch` — `walk` and `endOf` issue their queries through
those), the beach save (`beach.save`) and the beach load (`beach.load`).
Labels are string literals in code, so they stay low-cardinality.

### Beach save / load size

- `beach_save`: the `PUT /beach` (and per-beach `PUT /sand`) DB update,
  with `{ bytes, duration_ms }` — payload size plus the update's own time,
  so a slow save can be correlated with the beach's bytes.
- `beach_load`: the beach fetch, with the same `{ bytes, duration_ms }`.
  Neither line carries a beach or user id.

### Client

`src/net/telemetry.ts`, hooked in first thing in `src/main.ts` (production
builds only, gated on `ACCOUNTS_ENABLED`):

- Posts to `${VITE_API_URL}/api/client-events` via `fetch(..., { keepalive: true })`
  so both the website and the native Android/iOS Capacitor shells (running
  under `https://localhost` / `capacitor://localhost`) reach the API cleanly
  through CORS.
- Every payload carries `platform` (`web` | `android` | `ios`), `version`
  (`package.json` semver) and `build` (`__APP_BUILD__`).
- **Errors (`kind: "error"` → `client_error`, severity `WARNING`):**
  - Unhandled `window` errors and unhandled promise rejections, plus caught
    failures via `reportError(category, err, opts)` — covering native & web
    sign-in (`auth`), in-app purchases & checkout (`shop`), beach save/restore
    (`sync`), simulation worker errors (`worker`), WebGL context loss
    (`webgl`), and fatal startup failures (`boot`).
  - Carries `{ category, message, source?, stack?, path?, meta? }`. Stack
    traces strip query strings and hashes so share codes never leak; only the
    pathname is sent. Capped at 20/load and deduplicated over 10 s on the
    client.
- **Load timing (`kind: "perf"` → `client_perf`, severity `INFO`):** one
  navigation-timing sample per visit (`load_ms`, `dcl_ms`). `load_ms` is
  `performance.now()` read in the load handler — the timing entry's
  `loadEventEnd` is still 0 at that point (the load event hasn't ended
  yet), so reading it there reported `load_ms: 0` for every visit until
  this fix. `dcl_ms` comes from the entry as before. The
  `beech_client_perf_load` distribution metric is built on `load_ms`, so
  points before the deploy carrying this fix are not real load times.
- **Diagnostic telemetry (`kind: "event"` → `client_event`, severity `INFO`):**
  low-cardinality lifecycle events via `reportEvent(name, meta)` — `app_boot`
  (quality tier, DPR, touch), `auth_success` / `auth_cancel`,
  `purchase_success` / `purchase_cancel`, and `res_drop` (first dynamic
  resolution step-down). Capped at 40/load on the client.
- The endpoint is unauthenticated by design — it only writes a structured log
  line, never the database — and is strictly validated (4 KB cap, known fields
  only, flat primitive `meta` up to 8 keys) and rate-limited per IP (60/min,
  in-memory). Anything else is dropped with a 4xx and never reaches the logs.

## The dashboard

`beech` in Cloud Monitoring (open it from `terraform output
monitoring_dashboard`, or Monitoring → Dashboards in the console):
https://console.cloud.google.com/monitoring/dashboards/custom/cff8ef97-235d-450c-95e5-1e669664f7a9?project=beech-prod

Live resources (created 2026-11-22, Terraform state in
gs://beech-prod-tfstate): notification channel
`projects/beech-prod/notificationChannels/6345623296210914124` (email
markjen@gmail.com); uptime checks `beech-web-3XEbuoHRxM8` (site) and
`beech-api-health-0qryacN_Yxg` (/api/health); alert policies
`8637602992531410946` (uptime), `13080807935210246527` (5xx),
`14340817494471347325` (latency), `8637602992531414226` (SQL CPU),
`13790160179533155208` (SQL connections).

| Panel | Source |
|---|---|
| Traffic (requests/s) and server errors | log-based counters `beech_http_requests_total`, `beech_http_server_errors_total` |
| Latency (p50 / p95, ms) | log-based distribution `beech_http_latency` |
| Client page load (p50 / p95, ms) | log-based distribution `beech_client_perf_load` |
| Cloud Run CPU + memory + instances | built-in `run.googleapis.com/container/*` |
| Cloud SQL CPU + connections | built-in `cloudsql.googleapis.com/database/*` |
| Client + database errors | log-based counters `beech_client_errors_total`, `beech_db_errors_total` |
| Slow database queries (>500 ms) | log-based counter `beech_db_slow_queries_total` |
| Client telemetry events | log-based counter `beech_client_events_total` (by `name` and `platform`) |

The log-based metrics are defined in `infra/monitoring.tf`
(`google_logging_metric`).

## Alerts

All ten go to `markjen@gmail.com` (var `alert_email`):

| Alert | Fires when |
|---|---|
| beech: site or API down | any uptime check fails for 2 minutes — web, API, and (once their checks exist) admin, shore and landing |
| beech: server errors (5xx) | any 5xx in 10 minutes |
| beech-admin: server errors (5xx) | any 5xx on the admin console in 10 minutes |
| beech: client errors | more than 3 `client_error` events in 10 minutes (web, Android, or iOS) |
| beech: slow responses (p95 latency) | p95 latency over 1 s for 5 minutes |
| beech: database errors | any `db_error` in 10 minutes |
| beech: slow database queries | more than 5 queries over 500 ms in 10 minutes |
| beech: Cloud Run memory high | Cloud Run `beech` memory usage over 80% of its 512Mi limit for 5 minutes (metric `container/memory/usage`, p95) |
| beech: Cloud SQL CPU high | SQL CPU over 80% for 5 minutes |
| beech: Cloud SQL connections high | over 20 backends for 5 minutes (the db-f1-micro allows 25; each Cloud Run instance pools at most 5) |

The thresholds of the original six policies are unchanged. The
client-errors alert is intentionally unchanged too: most of its firings
are known noise (audio-device failures, Google Sign-In `[16]` reauth
failures) and classifying client errors by kind is a separate follow-up.

Uptime checks hit `https://beech.markjen.com/` and
`https://beech.markjen.com/api/health` every minute from the USA region
only (var `monitoring_host` — still the legacy host; follow-up: repoint
it to `https://play.beech.games`). The API check also requires the body
to contain `"ok":true`. The admin, shore and landing checks are
conditional on their domain vars (`admin_custom_domain`,
`shore_custom_domain`, `landing_custom_domain`) and are wired into the
uptime policy by dynamic conditions — one per check that exists. Live
state (checked 2026-11-25) has only the web + API checks, because the
domain vars were empty at the last apply, so those conditions add nothing
until the vars are passed at apply time. Each check's content matcher was
verified against the page source before wiring: admin `<title>beech
admin sign-in</title>` (`server/src/adminPage.ts`), shore title
`beechshore: every beach on the shore` (`server/src/shoreSite.ts`),
landing `a quiet place by the sea` (`server/src/landingSite.ts`).

Known gap, not fixed here: the admin service's log lines carry
`service: "beech"` in the JSON payload (`logEvent()` hardcodes it), so
the payload field can't tell the services apart — the admin 5xx metric
and alert filter on the Cloud Run resource label instead, which Cloud Run
sets itself. Making `logEvent()` service-aware is a small follow-up.

## Cost

Effectively free at this scale, and inside the $100/month budget with
room to spare:

- Log ingestion: first 50 GiB/project/month free, then $0.50/GiB. One
  request line is ~200 bytes; even 100k requests a day is under 1 GiB a
  month. Queries in Logs Explorer are free.
- Log-based metrics: charged by bytes ingested as custom metrics, first
  150 MiB/billing account free. A counter point is 8 bytes, a
  distribution point 80 bytes — a few MB a month here.
- Uptime checks: $0.30/1,000 executions, first 1M/project/month free.
  Two checks at 1/min is ~86k executions a month: free (up to five
  checks, ~216k/month, still free).
- Alerting: $0.10/month per condition. Eleven conditions (the uptime
  policy has two, plus one per conditional check once it exists) =
  **$1.10/month**, up to $1.40/month with all three conditional uptime
  checks.
- Dashboards, notification channels and the built-in Cloud Run / Cloud
  SQL metrics: free.

## Adding a metric or an alert

1. **Server event:** add a `logEvent('my_event', {...})` call in
   `server/src/observability.ts` (or wherever the event happens), with
   low-cardinality fields only. Add a test in
   `server/test/observability.test.ts`.
2. **Metric:** add a `google_logging_metric` in `infra/monitoring.tf`
   with a filter on `jsonPayload.event="my_event"`, then
   `terraform apply`.
3. **Panel:** add a widget to the `google_monitoring_dashboard` in the
   same file, referencing `logging.googleapis.com/user/<metric>`.
4. **Alert:** add a `google_monitoring_alert_policy` (or a condition on
   an existing policy) with the threshold and a `documentation` block
   saying what to check first, then `terraform apply`.

## Troubleshooting

- **"The dashboard is empty":** the log-based metrics only have points
  once the new server version is deployed and serving traffic. Check
  Logs Explorer first: `resource.type="cloud_run_revision"
  resource.labels.service_name="beech" jsonPayload.event="http_request"`.
- **"I got an alert, now what?":** each alert's documentation says
  where to look. In general: Logs Explorer with
  `jsonPayload.event="api_error"` for stacks,
  `jsonPayload.event="db_slow_query"` for slow queries, and
  `jsonPayload.event="client_error"` for phone errors.
- **"Too many logs":** the request line is one per request including
  static assets. If volume ever matters, the knob is sampling in
  `httpLogger` (e.g. log every Nth 2xx) — not done now because the
  volume is far below the free tier.
