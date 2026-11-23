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

output "monitoring_dashboard" {
  description = "Monitoring dashboard id. Open it at https://console.cloud.google.com/monitoring/dashboards/custom/<id>?project=beech-prod."
  value       = google_monitoring_dashboard.beech.id
}

output "monitoring_alert_email" {
  description = "Email address monitoring alert notifications go to."
  value       = var.alert_email
}

output "monitoring_uptime_checks" {
  description = "Uptime check ids for the website and the API health endpoint."
  value = {
    web = google_monitoring_uptime_check_config.web.uptime_check_id
    api = google_monitoring_uptime_check_config.api.uptime_check_id
  }
}

output "admin_domain_mapping" {
  description = "Admin console domain mapping name (the domain) and URL. Empty when var.admin_custom_domain is unset — the mapping is only created once the domain is set."
  value = {
    name = var.admin_custom_domain != "" ? google_cloud_run_domain_mapping.admin[0].name : ""
    url  = var.admin_custom_domain != "" ? "https://${var.admin_custom_domain}" : ""
  }
}

output "admin_uptime_check" {
  description = "Admin console uptime check id. Empty when var.admin_custom_domain is unset."
  value       = var.admin_custom_domain != "" ? google_monitoring_uptime_check_config.admin[0].uptime_check_id : ""
}

output "shore_domain_mapping" {
  description = "Shore site domain mapping names (the apex domain and www) and URL. Empty when var.shore_custom_domain is unset — the mappings are only created once the domain is set."
  value = {
    name     = var.shore_custom_domain != "" ? google_cloud_run_domain_mapping.shore[0].name : ""
    www_name = var.shore_custom_domain != "" ? google_cloud_run_domain_mapping.shore_www[0].name : ""
    url      = var.shore_custom_domain != "" ? "https://${var.shore_custom_domain}" : ""
  }
}

output "shore_uptime_check" {
  description = "Shore site uptime check id. Empty when var.shore_custom_domain is unset."
  value       = var.shore_custom_domain != "" ? google_monitoring_uptime_check_config.shore[0].uptime_check_id : ""
}
