# Variables for the beech production infrastructure.
# Defaults follow docs/GCP.md: project beech-prod, region us-central1.

variable "project_id" {
  description = "GCP project id. The project must already exist (created with gcloud projects create) and have a billing account linked before apply."
  type        = string
  default     = "beech-prod"
}

variable "region" {
  description = "GCP region. us-central1 supports Cloud Run domain mappings."
  type        = string
  default     = "us-central1"
}

variable "github_repo" {
  description = "GitHub repository allowed to deploy via Workload Identity Federation, as owner/repo. The WIF attribute condition is scoped to exactly this repo."
  type        = string
  default     = "markjen/beech"
}

variable "db_tier" {
  description = "Cloud SQL machine tier. db-f1-micro is the smallest shared-core instance (~$10/month); resize later without code changes."
  type        = string
  default     = "db-f1-micro"
}

variable "db_disk_size_gb" {
  description = "Cloud SQL storage size in GB (auto-increase is on)."
  type        = number
  default     = 10
}

variable "db_deletion_protection" {
  description = "Set to false before `terraform destroy` can delete the Cloud SQL instance. Keep true in normal use."
  type        = bool
  default     = true
}

variable "custom_domain" {
  description = "Optional custom domain for the Cloud Run service, e.g. beech.markjen.com. Empty (the default) skips the domain mapping — set it only after the first successful deploy, then add the DNS records the mapping prints. Alternatively put Firebase Hosting in front instead (see docs/GCP.md)."
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "Email address monitoring alert notifications go to."
  type        = string
  default     = "markjen@gmail.com"
}

variable "monitoring_host" {
  description = "Public hostname the uptime checks hit (the live domain, not the run.app URL)."
  type        = string
  default     = "beech.markjen.com"
}
