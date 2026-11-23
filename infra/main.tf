# beech production infrastructure on Google Cloud.
# Mirrors the one-time setup in docs/GCP.md, as Terraform.
#
# What this creates:
#   - required APIs (Cloud Run, Cloud SQL Admin, Artifact Registry,
#     Secret Manager, IAM Credentials, STS)
#   - Artifact Registry docker repo "beech"
#   - Cloud SQL PostgreSQL 16 instance "beech-db" + database "beech" +
#     user "beech" with a generated password stored in Secret Manager
#   - runtime service account "beech-run" (Cloud SQL client + secret accessor)
#   - deployer service account "beech-deploy" (Cloud Run admin, Artifact
#     Registry writer, service-account user) federated to GitHub Actions
#     via Workload Identity Federation — no keys anywhere
#
# What this does NOT create:
#   - the Cloud Run services themselves. `.github/workflows/deploy-gcp.yml`
#     creates/updates the "beech" and "beech-admin" services on every deploy.
#     Terraform only provides everything the deploy needs to exist first.
#   - the Terraform state bucket (see versions.tf — bootstrap it first).
#   - the Google OAuth client for sign-in (Console, see infra/README.md).

data "google_project" "current" {
  project_id = var.project_id
}

# ---------------------------------------------------------------- APIs

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ------------------------------------------------------- container images

resource "google_artifact_registry_repository" "beech" {
  project       = var.project_id
  location      = var.region
  repository_id = "beech"
  description   = "beech production container images"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

# ---------------------------------------------------------------- database

resource "google_sql_database_instance" "beech_db" {
  project          = var.project_id
  name             = "beech-db"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    disk_size         = var.db_disk_size_gb
    disk_autoresize   = true
    availability_type = "ZONAL"

    backup_configuration {
      enabled    = true
      start_time = "03:00"
    }
  }

  # Flip var.db_deletion_protection to false before a destroy.
  deletion_protection = var.db_deletion_protection

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "beech" {
  project  = var.project_id
  name     = "beech"
  instance = google_sql_database_instance.beech_db.name
}

# Generated once and stored in Secret Manager. The value is marked
# sensitive; it lives in the Terraform state (private GCS bucket) and in
# Secret Manager — never in the repo, never in a GitHub variable.
resource "random_password" "db_password" {
  length           = 24
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "google_sql_user" "beech" {
  project  = var.project_id
  name     = "beech"
  instance = google_sql_database_instance.beech_db.name
  password = random_password.db_password.result
}

resource "google_secret_manager_secret" "db_password" {
  project   = var.project_id
  secret_id = "beech-db-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result
}

# ------------------------------------------------------- runtime identity

resource "google_service_account" "beech_run" {
  project      = var.project_id
  account_id   = "beech-run"
  display_name = "beech Cloud Run runtime"
  description  = "Identity the Cloud Run service runs as. Connects to Cloud SQL and reads the database password from Secret Manager."
}

# Lets the runtime service reach Cloud SQL (via the --add-cloudsql-instances
# unix socket) and read the database password secret.
resource "google_project_iam_member" "beech_run_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.beech_run.email}"
}

resource "google_secret_manager_secret_iam_member" "beech_run_secret_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.db_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.beech_run.email}"
}

# ------------------------------------------------------ deployer identity

resource "google_service_account" "beech_deploy" {
  project      = var.project_id
  account_id   = "beech-deploy"
  display_name = "beech GitHub Actions deployer"
  description  = "Identity GitHub Actions assumes via Workload Identity Federation to build, push and deploy. No key file exists for it."
}

# run.admin: create/update the Cloud Run service.
# artifactregistry.writer: push images.
# iam.serviceAccountUser: deploy the service as beech-run.
resource "google_project_iam_member" "beech_deploy_roles" {
  for_each = toset([
    "roles/run.admin",
    "roles/artifactregistry.writer",
    "roles/iam.serviceAccountUser",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.beech_deploy.email}"
}

# ------------------------------------------- Workload Identity Federation
# GitHub Actions authenticates as beech-deploy with a short-lived OIDC
# token — no service-account key is ever created or stored in GitHub.

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "Federates GitHub Actions OIDC tokens so the beech repo can deploy without keys."
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub"
  description                        = "OIDC provider for token.actions.githubusercontent.com"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  # Only this repo may assume the deployer service account.
  attribute_condition = "assertion.repository == \"${var.github_repo}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "beech_deploy_workload_identity_user" {
  service_account_id = google_service_account.beech_deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/projects/${data.google_project.current.number}/locations/global/workloadIdentityPools/github/attribute.repository/${var.github_repo}"
}

# ------------------------------------------------------------ custom domain
# Optional, off by default (var.custom_domain = ""). Only enable after the
# first successful deploy has created the Cloud Run service, and add the DNS
# records the mapping prints. Alternatively, put Firebase Hosting in front
# (it rewrites to the service and adds a CDN) — see docs/GCP.md.

resource "google_cloud_run_domain_mapping" "beech" {
  count    = var.custom_domain != "" ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = var.custom_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = "beech"
  }
}

# beechshore.com: the public shore site. Same beech service; the server
# answers that Host with the shore site (server/src/rootApp.ts).
resource "google_cloud_run_domain_mapping" "shore" {
  count    = var.shore_custom_domain != "" ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = var.shore_custom_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = "beech"
  }
}

# www.beechshore.com: the same site, same service. The server already
# answers www.beechshore.com as a shore host (server/src/rootApp.ts), so
# this is only the mapping; the DNS records it prints go in the
# beechshore.com zone next to the apex ones (see infra/README.md).
resource "google_cloud_run_domain_mapping" "shore_www" {
  count    = var.shore_custom_domain != "" ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = "www.${var.shore_custom_domain}"

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = "beech"
  }
}

# beech.games landing page: the www host. Same beech service; the server
# answers that Host with the landing page (server/src/rootApp.ts). The apex
# mapping was created manually (see infra/README.md §6) and is not managed
# here — do not import it as part of this change.
resource "google_cloud_run_domain_mapping" "landing_www" {
  count    = var.landing_custom_domain != "" ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = var.landing_custom_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = "beech"
  }
}

# Admin console domain. Only create this AFTER a deploy has created the
# beech-admin service (PR #29 split it out of the beech service) — the
# mapping fails if the service does not exist yet. Set
# var.admin_custom_domain, apply, then add the DNS records the mapping
# prints (see infra/README.md).
resource "google_cloud_run_domain_mapping" "admin" {
  count    = var.admin_custom_domain != "" ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = var.admin_custom_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = "beech-admin"
  }
}
