# Observability for beech: dashboards and alerts on Google Cloud Monitoring.
#
# Where the numbers come from (both free at this scale):
#   - structured JSON logs from the server (server/src/observability.ts) ->
#     the log-based metrics below (logging.googleapis.com/user/...)
#   - built-in Cloud Run / Cloud SQL metrics (free, no setup)
#
# Cost: uptime checks are $0.30/1,000 executions with 1M free per project
# per month (up to 5 checks x 1/min = ~216k/month, free). Each alert
# condition is $0.10/month (11 conditions = $1.10/month, up to 14 =
# $1.40/month once the three conditional uptime checks exist — the uptime
# policy gains one condition per check that exists). Dashboards,
# notification channels and log-based metrics are free within the free
# tiers (log ingestion: 50 GiB/project/month free). The $100/month budget
# is untouched in practice. See docs/OBSERVABILITY.md.
#
# Apply with the rest of infra/ (`terraform apply` from infra/). Nothing
# here changes how traffic is served.

# ---------------------------------------------------------------- APIs

resource "google_project_service" "monitoring" {
  project            = var.project_id
  service            = "monitoring.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "logging" {
  project            = var.project_id
  service            = "logging.googleapis.com"
  disable_on_destroy = false
}

# ------------------------------------------------------- log-based metrics

locals {
  # Cloud Run logs for the beech service only.
  beech_log_filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
}

# One point per request. Labels are route templates only — never a user id,
# beach id, neighbor code or raw path (see observability.ts).
resource "google_logging_metric" "http_requests" {
  project = var.project_id
  name    = "beech_http_requests_total"
  filter  = "${local.beech_log_filter} AND jsonPayload.event=\"http_request\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    labels {
      key         = "method"
      value_type  = "STRING"
      description = "HTTP method"
    }
    labels {
      key         = "route"
      value_type  = "STRING"
      description = "Matched route template"
    }
    labels {
      key         = "status"
      value_type  = "STRING"
      description = "HTTP status code"
    }
  }
  label_extractors = {
    method = "EXTRACT(jsonPayload.method)"
    route  = "EXTRACT(jsonPayload.route)"
    status = "EXTRACT(jsonPayload.status)"
  }

  depends_on = [google_project_service.logging]
}

resource "google_logging_metric" "http_server_errors" {
  project = var.project_id
  name    = "beech_http_server_errors_total"
  filter  = "${local.beech_log_filter} AND jsonPayload.event=\"http_request\" AND jsonPayload.status>=500"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    labels {
      key         = "route"
      value_type  = "STRING"
      description = "Matched route template"
    }
  }
  label_extractors = {
    route = "EXTRACT(jsonPayload.route)"
  }

  depends_on = [google_project_service.logging]
}

# Same, for the admin console service. The filter uses the Cloud Run
# resource label (service_name="beech-admin"), not the jsonPayload.service
# field — logEvent() hardcodes service "beech" in the payload, so that
# field can't tell the services apart (known follow-up, see
# docs/OBSERVABILITY.md); the resource label is set by Cloud Run itself.
resource "google_logging_metric" "admin_http_server_errors" {
  project = var.project_id
  name    = "beech_admin_http_server_errors_total"
  filter  = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech-admin\" AND jsonPayload.event=\"http_request\" AND jsonPayload.status>=500"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    labels {
      key         = "route"
      value_type  = "STRING"
      description = "Matched route template"
    }
  }
  label_extractors = {
    route = "EXTRACT(jsonPayload.route)"
  }

  depends_on = [google_project_service.logging]
}

resource "google_logging_metric" "http_latency" {
  project = var.project_id
  name    = "beech_http_latency"
  filter  = "${local.beech_log_filter} AND jsonPayload.event=\"http_request\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "ms"
  }
  value_extractor = "EXTRACT(jsonPayload.duration_ms)"
  bucket_options {
    explicit_buckets {
      bounds = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
    }
  }

  depends_on = [google_project_service.logging]
}

resource "google_logging_metric" "client_errors" {
  project = var.project_id
  name    = "beech_client_errors_total"
  filter  = "${local.beech_log_filter} AND jsonPayload.event=\"client_error\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }

  depends_on = [google_project_service.logging]
}

resource "google_logging_metric" "client_events" {
  project = var.project_id
  name    = "beech_client_events_total"
  filter  = "${local.beech_log_filter} AND jsonPayload.event=\"client_event\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    labels {
      key         = "name"
      value_type  = "STRING"
      description = "Client telemetry event name"
    }
    labels {
      key         = "platform"
      value_type  = "STRING"
      description = "Client platform (web, android, ios)"
    }
  }
  label_extractors = {
    name     = "EXTRACT(jsonPayload.name)"
    platform = "EXTRACT(jsonPayload.platform)"
  }

  depends_on = [google_project_service.logging]
}

resource "google_logging_metric" "db_errors" {
  project = var.project_id
  name    = "beech_db_errors_total"
  filter  = "${local.beech_log_filter} AND jsonPayload.event=\"db_error\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }

  depends_on = [google_project_service.logging]
}

resource "google_logging_metric" "db_slow_queries" {
  project = var.project_id
  name    = "beech_db_slow_queries_total"
  filter  = "${local.beech_log_filter} AND jsonPayload.event=\"db_slow_query\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }

  depends_on = [google_project_service.logging]
}

# Client page-load timing, one distribution point per visit
# (jsonPayload.event="client_perf", load_ms since navigation start).
# load_ms was systematically 0 until the client fix that reads
# performance.now() at the load handler (src/net/telemetry.ts), so points
# before that deploy are not real load times.
resource "google_logging_metric" "client_perf_load" {
  project = var.project_id
  name    = "beech_client_perf_load"
  filter  = "${local.beech_log_filter} AND jsonPayload.event=\"client_perf\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "ms"
    labels {
      key         = "platform"
      value_type  = "STRING"
      description = "Client platform (web, android, ios)"
    }
  }
  value_extractor = "EXTRACT(jsonPayload.load_ms)"
  label_extractors = {
    platform = "EXTRACT(jsonPayload.platform)"
  }
  bucket_options {
    explicit_buckets {
      bounds = [100, 250, 500, 1000, 2000, 5000, 10000, 30000]
    }
  }

  depends_on = [google_project_service.logging]
}

# ------------------------------------------------- notification + uptime

resource "google_monitoring_notification_channel" "email" {
  project      = var.project_id
  display_name = "beech alerts (Mark)"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_uptime_check_config" "web" {
  project          = var.project_id
  display_name     = "beech web"
  timeout          = "10s"
  period           = "60s"
  selected_regions = ["USA"]

  http_check {
    path         = "/"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = var.monitoring_host
      project_id = var.project_id
    }
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_uptime_check_config" "api" {
  project          = var.project_id
  display_name     = "beech api health"
  timeout          = "10s"
  period           = "60s"
  selected_regions = ["USA"]

  http_check {
    path         = "/api/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  # /api/health answers {"ok":true}; anything else is a failure.
  content_matchers {
    content = "\"ok\":true"
    matcher = "CONTAINS_STRING"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = var.monitoring_host
      project_id = var.project_id
    }
  }

  depends_on = [google_project_service.monitoring]
}

# Admin console sign-in page. Only created when var.admin_custom_domain is
# set, and only after the domain mapping exists (the check fails until the
# DNS records are in place and the certificate is provisioned). The host is
# the admin domain itself, so it can never drift from the mapping.
# Wired into the uptime alert policy by a dynamic condition below (one per
# check that exists — none until the domain var is set at apply time).
resource "google_monitoring_uptime_check_config" "admin" {
  count            = var.admin_custom_domain != "" ? 1 : 0
  project          = var.project_id
  display_name     = "beech admin sign-in"
  timeout          = "10s"
  period           = "60s"
  selected_regions = ["USA"]

  http_check {
    path         = "/"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  # Signed out, the admin console serves only its sign-in page, whose
  # <title> is exactly "beech admin sign-in" (server/src/adminPage.ts;
  # the deploy workflow greps for the same string). Anything else — a
  # 404, a redirect, the game — is a failure.
  content_matchers {
    content = "beech admin sign-in"
    matcher = "CONTAINS_STRING"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = var.admin_custom_domain
      project_id = var.project_id
    }
  }

  depends_on = [google_project_service.monitoring]
}

# Shore site home page (beechshore.com). Only created when
# var.shore_custom_domain is set, and only after the domain mapping exists
# (the check fails until the DNS records are in place and the certificate
# is provisioned). The host is the shore domain itself, so it can never
# drift from the mapping.
# Wired into the uptime alert policy by a dynamic condition below (one per
# check that exists — none until the domain var is set at apply time).
resource "google_monitoring_uptime_check_config" "shore" {
  count            = var.shore_custom_domain != "" ? 1 : 0
  project          = var.project_id
  display_name     = "beechshore home"
  timeout          = "10s"
  period           = "60s"
  selected_regions = ["USA"]

  http_check {
    path         = "/"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  # The shore home page's <title> is exactly "beechshore: every beach on
  # the shore" (server/src/shoreSite.ts; the deploy workflow greps for
  # the same heading under /shore). Anything else — a 404, a redirect,
  # the game — is a failure.
  content_matchers {
    content = "beechshore: every beach on the shore"
    matcher = "CONTAINS_STRING"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = var.shore_custom_domain
      project_id = var.project_id
    }
  }

  depends_on = [google_project_service.monitoring]
}

# Landing page. Only created when var.landing_custom_domain is set, and
# only after the domain mapping exists (the check fails until the DNS
# records are in place and the certificate is provisioned). The host is the
# www domain itself, so it can never drift from the mapping.
# Wired into the uptime alert policy by a dynamic condition below (one per
# check that exists — none until the domain var is set at apply time).
resource "google_monitoring_uptime_check_config" "landing" {
  count            = var.landing_custom_domain != "" ? 1 : 0
  project          = var.project_id
  display_name     = "beech landing page"
  timeout          = "10s"
  period           = "60s"
  selected_regions = ["USA"]

  http_check {
    path         = "/"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  # The landing page's tagline (server/src/landingSite.ts; the deploy
  # workflow greps for the same string under /landing). Anything else — a
  # 404, the Squarespace parking page, the game — is a failure.
  content_matchers {
    content = "a quiet place by the sea"
    matcher = "CONTAINS_STRING"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = var.landing_custom_domain
      project_id = var.project_id
    }
  }

  depends_on = [google_project_service.monitoring]
}

# ---------------------------------------------------------------- alerts

resource "google_monitoring_alert_policy" "uptime" {
  project               = var.project_id
  display_name          = "beech: site or API down"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    content   = "The beech website or its /api/health check is failing. Check the Cloud Run service `beech` in us-central1, then Logs Explorer for the request and api_error lines."
    mime_type = "text/markdown"
  }
  conditions {
    display_name = "web uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.web.uptime_check_id}\""
      duration        = "120s"
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      aggregations {
        alignment_period   = "120s"
        per_series_aligner = "ALIGN_FRACTION_TRUE"
      }
    }
  }
  conditions {
    display_name = "api uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.api.uptime_check_id}\""
      duration        = "120s"
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      aggregations {
        alignment_period   = "120s"
        per_series_aligner = "ALIGN_FRACTION_TRUE"
      }
    }
  }
  # The admin / shore / landing checks are conditional (count = 0 until
  # their domain var is set at apply time), so these conditions are dynamic:
  # one per check that exists, none when it doesn't. Live state (checked
  # 2026-11-25) has only the web + api checks — the domain vars were empty
  # at the last apply — so these add nothing until the vars are passed.
  dynamic "conditions" {
    for_each = google_monitoring_uptime_check_config.admin
    content {
      display_name = "admin uptime check failing"
      condition_threshold {
        filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${conditions.value.uptime_check_id}\""
        duration        = "120s"
        comparison      = "COMPARISON_LT"
        threshold_value = 1
        aggregations {
          alignment_period   = "120s"
          per_series_aligner = "ALIGN_FRACTION_TRUE"
        }
      }
    }
  }
  dynamic "conditions" {
    for_each = google_monitoring_uptime_check_config.shore
    content {
      display_name = "shore uptime check failing"
      condition_threshold {
        filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${conditions.value.uptime_check_id}\""
        duration        = "120s"
        comparison      = "COMPARISON_LT"
        threshold_value = 1
        aggregations {
          alignment_period   = "120s"
          per_series_aligner = "ALIGN_FRACTION_TRUE"
        }
      }
    }
  }
  dynamic "conditions" {
    for_each = google_monitoring_uptime_check_config.landing
    content {
      display_name = "landing uptime check failing"
      condition_threshold {
        filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${conditions.value.uptime_check_id}\""
        duration        = "120s"
        comparison      = "COMPARISON_LT"
        threshold_value = 1
        aggregations {
          alignment_period   = "120s"
          per_series_aligner = "ALIGN_FRACTION_TRUE"
        }
      }
    }
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_alert_policy" "server_errors" {
  project               = var.project_id
  display_name          = "beech: server errors (5xx)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    content   = "A 5xx happened in the last 10 minutes. In Logs Explorer look for jsonPayload.event=\"http_request\" with status>=500, then jsonPayload.event=\"api_error\" for the message and stack."
    mime_type = "text/markdown"
  }
  conditions {
    display_name = "any 5xx in 10 minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/beech_http_server_errors_total\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_alert_policy" "admin_server_errors" {
  project               = var.project_id
  display_name          = "beech-admin: server errors (5xx)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    content   = "A 5xx happened on the admin console in the last 10 minutes. In Logs Explorer look for resource.type=\"cloud_run_revision\" resource.labels.service_name=\"beech-admin\" jsonPayload.event=\"http_request\" with status>=500."
    mime_type = "text/markdown"
  }
  conditions {
    display_name = "any admin 5xx in 10 minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/beech_admin_http_server_errors_total\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech-admin\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  depends_on = [google_project_service.monitoring, google_logging_metric.admin_http_server_errors]
}

resource "google_monitoring_alert_policy" "client_errors" {
  project               = var.project_id
  display_name          = "beech: client errors"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    content   = "More than 3 client errors were reported in 10 minutes (web, Android, or iOS). Check Logs Explorer with: resource.type=\"cloud_run_revision\" resource.labels.service_name=\"beech\" jsonPayload.event=\"client_error\" — each line includes platform, version, build, category, source, message, and stack."
    mime_type = "text/markdown"
  }
  conditions {
    display_name = "more than 3 client errors in 10 minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/beech_client_errors_total\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 3
      aggregations {
        alignment_period   = "600s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  depends_on = [google_project_service.monitoring, google_logging_metric.client_errors]
}

resource "google_monitoring_alert_policy" "latency" {
  project               = var.project_id
  display_name          = "beech: slow responses (p95 latency)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    content   = "p95 request latency is over 1s for 5 minutes. Check the dashboard's latency chart by route, then Cloud SQL CPU — slow queries show up as jsonPayload.event=\"db_slow_query\" in the logs."
    mime_type = "text/markdown"
  }
  conditions {
    display_name = "p95 latency over 1s for 5 minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/beech_http_latency\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 1000
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_PERCENTILE_95"
      }
    }
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_alert_policy" "db_errors" {
  project               = var.project_id
  display_name          = "beech: database errors"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    content   = "A database query failed in the last 10 minutes. In Logs Explorer look for jsonPayload.event=\"db_error\" — each line carries the operation label (e.g. shore.walk, beach.save), the duration and the pool state; jsonPayload.event=\"db_slow_query\" shows slow ones."
    mime_type = "text/markdown"
  }
  conditions {
    display_name = "any db error in 10 minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/beech_db_errors_total\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  depends_on = [google_project_service.monitoring, google_logging_metric.db_errors]
}

resource "google_monitoring_alert_policy" "db_slow_queries" {
  project               = var.project_id
  display_name          = "beech: slow database queries"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    content   = "More than 5 queries over 500 ms in 10 minutes. In Logs Explorer look for jsonPayload.event=\"db_slow_query\" — each line carries the operation label (e.g. shore.linked, shore.nextStretch), the duration and the pool state at the time."
    mime_type = "text/markdown"
  }
  conditions {
    display_name = "more than 5 slow queries in 10 minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/beech_db_slow_queries_total\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      aggregations {
        alignment_period   = "600s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  depends_on = [google_project_service.monitoring, google_logging_metric.db_slow_queries]
}

resource "google_monitoring_alert_policy" "sql_cpu" {
  project               = var.project_id
  display_name          = "beech: Cloud SQL CPU high"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    content   = "Cloud SQL CPU is over 80% for 5 minutes. The instance is a db-f1-micro; if this keeps happening, raise the tier (var.db_tier) — no code changes needed."
    mime_type = "text/markdown"
  }
  conditions {
    display_name = "SQL CPU over 80% for 5 minutes"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\" AND resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:beech-db\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_alert_policy" "sql_connections" {
  project               = var.project_id
  display_name          = "beech: Cloud SQL connections high"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    content   = "More than 20 database connections for 5 minutes. The db-f1-micro allows 25; each Cloud Run instance pools at most 5, so 10 instances could exhaust it. Raise max-instances with care, or raise the tier."
    mime_type = "text/markdown"
  }
  conditions {
    display_name = "SQL connections over 20 for 5 minutes"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/postgresql/num_backends\" AND resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:beech-db\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 20
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_alert_policy" "memory" {
  project               = var.project_id
  display_name          = "beech: Cloud Run memory high"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    content   = "Cloud Run beech memory utilization is over 80% for 5 minutes. The service runs with 512Mi; if this keeps happening, raise the limit in infra/main.tf — no code changes needed. There was no memory alert before this one, so a slow leak would only have shown up as restarts."
    mime_type = "text/markdown"
  }
  conditions {
    display_name = "Cloud Run memory over 80% for 5 minutes"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/container/memory/utilization\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  depends_on = [google_project_service.monitoring]
}

# -------------------------------------------------------------- dashboard

resource "google_monitoring_dashboard" "beech" {
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "beech"
    gridLayout = {
      columns = "2"
      widgets = [
        {
          title = "About this dashboard"
          text = {
            content = "Traffic, latency and errors come from the server's structured JSON logs (one line per request, route templates only) via log-based metrics; Cloud Run and Cloud SQL panels are the built-in GCP metrics. Deploy markers: search Logs Explorer for jsonPayload.event=\"server_start\" — the revision on each line is the Cloud Run revision. Alerts go to ${var.alert_email}. See docs/OBSERVABILITY.md."
            format  = "MARKDOWN"
          }
        },
        {
          title = "Traffic (requests/s) and server errors"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"logging.googleapis.com/user/beech_http_requests_total\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_RATE" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"logging.googleapis.com/user/beech_http_server_errors_total\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_RATE" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
            ]
            yAxis        = { label = "requests/s", scale = "LINEAR" }
            chartOptions = { mode = "COLOR" }
          }
        },
        {
          title = "Latency (p50 / p95, ms)"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"logging.googleapis.com/user/beech_http_latency\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_PERCENTILE_50" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"logging.googleapis.com/user/beech_http_latency\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_PERCENTILE_95" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
            ]
            yAxis        = { label = "ms", scale = "LINEAR" }
            chartOptions = { mode = "COLOR" }
          }
        },
        {
          title = "Client page load (p50 / p95, ms)"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"logging.googleapis.com/user/beech_client_perf_load\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_PERCENTILE_50" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"logging.googleapis.com/user/beech_client_perf_load\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_PERCENTILE_95" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
            ]
            yAxis        = { label = "ms", scale = "LINEAR" }
            chartOptions = { mode = "COLOR" }
          }
        },
        {
          title = "Cloud Run CPU + memory"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"run.googleapis.com/container/cpu/utilization\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"run.googleapis.com/container/memory/utilization\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"run.googleapis.com/container/instance_count\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y2"
              },
            ]
            yAxis        = { label = "utilization (0-1)", scale = "LINEAR" }
            y2Axis       = { label = "instances", scale = "LINEAR" }
            chartOptions = { mode = "COLOR" }
          }
        },
        {
          title = "Cloud SQL CPU + connections"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\" AND resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:beech-db\""
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"cloudsql.googleapis.com/database/postgresql/num_backends\" AND resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:beech-db\""
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y2"
              },
            ]
            yAxis        = { label = "CPU utilization (0-1)", scale = "LINEAR" }
            y2Axis       = { label = "connections", scale = "LINEAR" }
            chartOptions = { mode = "COLOR" }
          }
        },
        {
          title = "Client + database errors"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"logging.googleapis.com/user/beech_client_errors_total\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_RATE" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"logging.googleapis.com/user/beech_db_errors_total\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_RATE" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
            ]
            yAxis        = { label = "errors/s", scale = "LINEAR" }
            chartOptions = { mode = "COLOR" }
          }
        },
        {
          title = "Slow database queries (>500 ms)"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"logging.googleapis.com/user/beech_db_slow_queries_total\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_RATE" }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
            ]
            yAxis        = { label = "slow queries/s", scale = "LINEAR" }
            chartOptions = { mode = "COLOR" }
          }
        },
        {
          title = "Client telemetry events (by name & platform)"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"logging.googleapis.com/user/beech_client_events_total\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"beech\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_SUM", crossSeriesReducer = "REDUCE_SUM", groupByFields = ["metric.label.name", "metric.label.platform"] }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              },
            ]
            yAxis        = { label = "events / 5m", scale = "LINEAR" }
            chartOptions = { mode = "COLOR" }
          }
        },
      ]
    }
  })

  depends_on = [google_project_service.monitoring]
}
