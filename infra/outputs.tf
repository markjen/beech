# Outputs. The WIF provider, service-account emails and SQL connection
# name feed the GitHub Actions variables in infra/README.md — copy them
# from `terraform output` after apply. None of these values is a secret.

output "project_number" {
  description = "Numeric GCP project number."
  value       = data.google_project.current.number
}

output "wif_provider" {
  description = "Workload Identity Federation provider resource name. Set as GitHub Actions variable GCP_WIF_PROVIDER."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deploy_service_account" {
  description = "Deployer service account email. Set as GitHub Actions variable GCP_DEPLOY_SA."
  value       = google_service_account.beech_deploy.email
}

output "runtime_service_account" {
  description = "Runtime service account email. Set as GitHub Actions variable GCP_RUNTIME_SA."
  value       = google_service_account.beech_run.email
}

output "sql_connection_name" {
  description = "Cloud SQL instance connection name (<project>:<region>:beech-db). Set as GitHub Actions variable GCP_SQL_INSTANCE."
  value       = google_sql_database_instance.beech_db.connection_name
}

output "artifact_registry_repository" {
  description = "Artifact Registry docker repository URL (images are pushed here as beech:<sha>)."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/beech"
}

output "db_password_secret" {
  description = "Secret Manager secret holding the generated database password. The Cloud Run service reads it as the DB_PASSWORD env var; the value itself is never output."
  value       = google_secret_manager_secret.db_password.secret_id
}
