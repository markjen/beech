# Firebase for Android push notifications (FCM).
#
# Managed here since 2026-11-26: the project was linked to Firebase in the
# console and the Android app registered there before this configuration
# existed; both were imported into Terraform state — see infra/README.md
# §7 for the import commands. The GitHub side (the GOOGLE_SERVICES_JSON
# secret and the FCM_PROJECT_ID / NATIVE_PUSH Actions variables) is not
# Terraform; it lives in the repo's Actions variables, set by hand
# (docs/INBOX_NOTIFICATIONS.md, "Turning on push").
#
# What this manages, and nothing else:
#   - the Firebase project link for beech-prod (Analytics off)
#   - the Android app app.beech.beach (the Play build registers with FCM)
#   - the FCM API + the Firebase API, enabled with the rest of the
#     project APIs in main.tf (google_project_service.apis)
#   - the beech-run service account's FCM send role
#
# Not managed here: no iOS app (APNs is direct, no Firebase — see
# docs/INBOX_NOTIFICATIONS.md §B), no Analytics, no other Firebase
# products.

# The Firebase API requires a quota project on every call (the
# X-Goog-User-Project header); without it the API answers 403 even for a
# project owner. Only the beta provider needs it — it serves just the two
# Firebase resources in this file.
provider "google-beta" {
  project               = var.project_id
  user_project_override = true
}

resource "google_firebase_project" "beech" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.apis]
}

# The Android app the Play build registers with FCM. App ID
# 1:650382817342:android:762319383603d406b3b96f.
resource "google_firebase_android_app" "beech" {
  provider     = google-beta
  project      = var.project_id
  package_name = "app.beech.beach"
  display_name = "beech"

  # This app must never be deleted: re-registering would break installed
  # builds (a new App ID means a new google-services.json and a new
  # release). If this resource is ever dropped from the configuration,
  # remove it from state with `terraform state rm` — never destroy it.
  # (The provider defaults deletion_policy to DELETE; it is deliberately
  # left unset here so `terraform plan` stays a no-op for this import.)

  depends_on = [google_firebase_project.beech]
}

# Lets the Cloud Run runtime send pushes through FCM (server/src/push.ts
# uses the service's own identity, FCM HTTP v1).
resource "google_project_iam_member" "beech_run_fcm_admin" {
  project = var.project_id
  role    = "roles/firebasecloudmessaging.admin"
  member  = "serviceAccount:${google_service_account.beech_run.email}"
}
