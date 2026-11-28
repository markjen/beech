# Cloud Scheduler ticks (docs/INBOX_NOTIFICATIONS.md, "Push", and
# docs/MERCH_STORE.md, "Sweep").
#
# Managed here since 2026-11-26: the push-tick job was created with
# gcloud on 2026-11-26, before this configuration existed, and then
# imported into Terraform state — see infra/README.md §8 for the import
# commands. The merch-tick job was created with gcloud on 2026-11-28
# the same way (PR #211) and imported likewise.
#
# What this manages, and nothing else:
#   - the beech-scheduler service account (OIDC identity for the ticks)
#   - its roles/run.invoker grant on the beech Cloud Run service
#   - the beech-push-tick job: POST /api/push/tick every minute
#   - the beech-merch-tick job: POST /api/merch/tick every minute
#
# The ticks exist because Cloud Run can idle an instance's CPU between
# requests; the in-process timers are gated off in production (PR #154
# for push, PR #211 for merch). The server also ticks itself when it is
# awake, so a missed Scheduler tick only delays a push or a merch sweep
# by a minute at most.
#
# The beech service itself is deployed by GitHub Actions, not Terraform,
# so its URL comes from var.beech_service_url (variables.tf) rather than
# a data source: a data source would make `terraform plan` fail during
# the initial bootstrap, before the first deploy has created the service.
# Cloud Run service URLs do not change across revisions or redeploys.

resource "google_service_account" "beech_scheduler" {
  project      = var.project_id
  account_id   = "beech-scheduler"
  display_name = "beech push tick"
}

# Lets the tick call the beech service (the job authenticates with OIDC
# as beech-scheduler). The v2 IAM resource, because the service was
# created with the v2 API (`gcloud run deploy`). Non-authoritative for
# the role: the binding also holds allUsers (public access), which this
# leaves alone.
resource "google_cloud_run_v2_service_iam_member" "beech_scheduler_invoker" {
  project  = var.project_id
  location = var.region
  name     = "beech"
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.beech_scheduler.email}"
}

resource "google_cloud_scheduler_job" "beech_push_tick" {
  name             = "beech-push-tick"
  project          = var.project_id
  region           = var.region
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "180s"

  retry_config {
    min_backoff_duration = "5s"
    max_backoff_duration = "3600s"
    max_doublings        = 5
    max_retry_duration   = "0s"
  }

  http_target {
    http_method = "POST"
    uri         = "${var.beech_service_url}/api/push/tick"

    oidc_token {
      service_account_email = google_service_account.beech_scheduler.email
      audience              = "${var.beech_service_url}/api/push/tick"
    }
  }

  depends_on = [google_project_service.apis]
}

# The merch sweep (docs/MERCH_STORE.md, "Sweep"): same shape as the
# push tick — one minute, same service account, audience == the tick
# URI. The sweep's first query (merch.recover) measured ~1s wall-clock
# on an idle throttled instance, tripping the slow-database-queries
# alert, so it moved to Scheduler in PR #211, like the push tick.
resource "google_cloud_scheduler_job" "beech_merch_tick" {
  name             = "beech-merch-tick"
  project          = var.project_id
  region           = var.region
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "180s"

  retry_config {
    min_backoff_duration = "5s"
    max_backoff_duration = "3600s"
    max_doublings        = 5
    max_retry_duration   = "0s"
  }

  http_target {
    http_method = "POST"
    uri         = "${var.beech_service_url}/api/merch/tick"

    oidc_token {
      service_account_email = google_service_account.beech_scheduler.email
      audience              = "${var.beech_service_url}/api/merch/tick"
    }
  }

  depends_on = [google_project_service.apis]
}
