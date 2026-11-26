# beech — Google Cloud infrastructure (Terraform)
#
# This is a DRAFT for review. Nothing here has been applied.
# See infra/README.md for the bootstrap order (billing first, then the
# state bucket, then `terraform apply`).

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    # The Firebase project/app resources are beta-only (they are not in
    # the GA provider); only the two resources in infra/firebase.tf use
    # this provider. Same version line as google.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  # Remote state. The bucket must exist BEFORE `terraform init` — it is
  # deliberately not managed by this configuration (chicken-and-egg).
  # Create it once, then init:
  #   gsutil mb -p beech-prod -l us-central1 gs://beech-prod-tfstate
  #   gsutil versioning set on gs://beech-prod-tfstate
  # The bucket is private to the project; the state contains the database
  # password (marked sensitive), so it must never be committed to git.
  backend "gcs" {
    bucket = "beech-prod-tfstate"
    prefix = "terraform/state"
  }
}
