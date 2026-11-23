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

`server/src/observability.ts` — `httpLogger` middleware, on the API app
and on the root app, so it covers `/api/*`, `/healthz`, static files and
the SPA fallback. One line per request:

```json
{"severity":"INFO","time":"...","service":"beech","revision":"beech-00002-abc","event":"http_request","method":"GET","route":"/beaches/:code","status":200,"duration_ms":42.3}
```

- `route` is the matched route template. Raw paths are never logged as
  labels: anything unmatched is bucketed as `static`, `spa` or
  `unmatched`, so a neighbor code in a URL can never become a metric
  label. No user ids, beach ids or IPs appear anywhere.
- 5xx lines are severity `ERROR`, 4xx `WARNING`.
- `revision` is the Cloud Run revision (`K_REVISION`) — the deploy
  marker. `server_start` lines carry it too; find a deploy in Logs
  Explorer with `jsonPayload.event="server_start"`.

### Database

`server/src/db.ts` times every query (the SQL text and params are never
logged — they can hold user data):

- `db_error` (severity `ERROR`): a failed query, with only the Postgres
  error code and the duration.
- `db_slow_query` (severity `WARNING`): any query over 500 ms.
- `db_summary` once a minute: query/error/slow counts, p50/p95 latency
  over the last 1,000 queries, and the `pg` pool's total/idle/waiting
  counts.

### Client

`src/net/telemetry.ts`, hooked in first thing in `src/main.ts`:

- Unhandled errors and unhandled rejections (max 10 per page load) go to
  `POST /api/client-events` as `{kind:"error", message, source?, path?}`.
  Only the pathname is sent, never the query string (it can hold a
  `?visit=` code).
- One page-load timing sample per visit: `{kind:"perf", load_ms, dcl_ms}`
  from the navigation timing entry.
- The endpoint is unauthenticated by design — it only writes a log line,
  never the database — and is validated (2 KB cap, known fields only)
  and rate-limited per IP (30/min, in-memory). Anything else is dropped
  with a 4xx and never reaches the logs.

## The dashboard

`beech` in Cloud Monitoring (open it from `terraform output
monitoring_dashboard`, or Monitoring → Dashboards in the console):

| Panel | Source |
|---|---|
| Traffic (requests/s) and server errors | log-based counters `beech_http_requests_total`, `beech_http_server_errors_total` |
| Latency (p50 / p95, ms) | log-based distribution `beech_http_latency` |
| Cloud Run CPU + memory + instances | built-in `run.googleapis.com/container/*` |
| Cloud SQL CPU + connections | built-in `cloudsql.googleapis.com/database/*` |
| Client + database errors | log-based counters `beech_client_errors_total`, `beech_db_errors_total` |

The log-based metrics are defined in `infra/monitoring.tf`
(`google_logging_metric`). There is also `beech_db_slow_queries_total`
for ad-hoc queries; it has no panel yet.

## Alerts

All five go to `markjen@gmail.com` (var `alert_email`):

| Alert | Fires when |
|---|---|
| beech: site or API down | either uptime check fails for 2 minutes |
| beech: server errors (5xx) | any 5xx in 10 minutes |
| beech: slow responses (p95 latency) | p95 latency over 1 s for 5 minutes |
| beech: Cloud SQL CPU high | SQL CPU over 80% for 5 minutes |
| beech: Cloud SQL connections high | over 20 backends for 5 minutes (the db-f1-micro allows 25; each Cloud Run instance pools at most 5) |

Uptime checks hit `https://beech.markjen.com/` and
`https://beech.markjen.com/api/health` every minute from the USA region
only (var `monitoring_host`). The API check also requires the body to
contain `"ok":true`.

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
  Two checks at 1/min is ~86k executions a month: free.
- Alerting: $0.10/month per condition. Six conditions (the uptime policy
  has two) = **$0.60/month**.
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
