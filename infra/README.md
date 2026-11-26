# beech — Google Cloud infrastructure

Terraform for the production hosting in `docs/GCP.md`: Cloud Run +
Cloud SQL for PostgreSQL, deployed from GitHub Actions with Workload
Identity Federation. No keys, no secrets in the repo.

## What Terraform creates

- Required APIs: Cloud Run, Cloud SQL Admin, Artifact Registry,
  Secret Manager, IAM Credentials, STS
- Artifact Registry docker repo `beech` (images pushed as `beech:<sha>`)
- Cloud SQL PostgreSQL 16, `beech-db` (`db-f1-micro`, 10 GB, daily
  backups at 03:00) + database `beech` + user `beech`
- A generated database password, stored in Secret Manager as
  `beech-db-password` (the value never appears in the repo)
- Runtime service account `beech-run` — Cloud SQL client + secret accessor
- Firebase for Android push (FCM): the project link, the Android app
  `app.beech.beach`, the FCM + Firebase APIs, and `beech-run`'s
  `roles/firebasecloudmessaging.admin` grant (see §7 below)
- Deployer service account `beech-deploy` — Cloud Run admin, Artifact
  Registry writer, service-account user
- Workload Identity pool + OIDC provider so GitHub Actions can assume
  `beech-deploy`, scoped by attribute condition to `markjen/beech` only

## What Terraform does NOT create

- The Cloud Run service itself. `.github/workflows/deploy-gcp.yml`
  creates/updates the `beech` service on every deploy. Terraform only
  provides what the deploy needs to exist first.
- The Terraform state bucket (bootstrap it first, below — chicken-and-egg).
- The Google OAuth client for sign-in (Console, below).

## 0. Prerequisites

1. **Billing — linked.** The `beech-prod` project has billing enabled
   via the "My Billing Account" billing account.
2. `gcloud` authenticated as an owner of `beech-prod`
   (`gcloud auth login`, then `gcloud config set project beech-prod`).
3. Terraform >= 1.5 installed (`terraform -v`). The project id and
   region default to `beech-prod` / `us-central1` (see `variables.tf`).

## 1. Bootstrap the state bucket (once)

Terraform state lives in a private GCS bucket. The bucket must exist
before the first `terraform init`, and it is deliberately not managed by
this configuration.

```bash
gsutil mb -p beech-prod -l us-central1 gs://beech-prod-tfstate
gsutil versioning set on gs://beech-prod-tfstate
```

The state contains the database password (marked sensitive), so the
bucket must stay private and must never be committed to git. The repo's
`.gitignore` should also exclude `*.tfstate*` and `.terraform/` — add
those lines if they are not there yet.

## 2. Apply

```bash
cd infra
terraform init
terraform plan
terraform apply
```

The Cloud SQL instance takes several minutes to create. `terraform
output` prints the values for the next step.

## 3. Set the GitHub Actions variables

Repo → Settings → Secrets and variables → Actions → Variables. There
are **no secrets** to add — these are all public identifiers.

| Variable | Value (from `terraform output`) |
|---|---|
| `GCP_ENABLED` | `1` (turns `deploy-gcp.yml` on; leave unset/`0` until ready) |
| `GCP_PROJECT_ID` | `beech-prod` |
| `GCP_REGION` | `us-central1` |
| `GCP_WIF_PROVIDER` | `wif_provider` output |
| `GCP_DEPLOY_SA` | `deploy_service_account` output |
| `GCP_RUNTIME_SA` | `runtime_service_account` output |
| `GCP_SQL_INSTANCE` | `sql_connection_name` output (`beech-prod:us-central1:beech-db`) |
| `GOOGLE_CLIENT_ID` | OAuth web client ID (below) |
| `GOOGLE_CLIENT_IDS` | web client ID, plus iOS/Android client IDs when they exist, comma-separated |
| `APPLE_CLIENT_IDS` | later, for Sign in with Apple |
| `ADMIN_EMAILS` | the Google account(s) allowed into the admin console (the `beech-admin` service), comma-separated — production: `markjen@gmail.com` |

## 4. Google sign-in (Console, once)

Google Cloud Console → APIs & Services → Credentials → Create OAuth
client ID → **Web application**. Add the production URL as an authorized
JavaScript origin and fill in the OAuth consent screen (name, support
email, privacy policy). Use that client ID for `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_IDS` above.

Note: the server verifies Google ID tokens directly (against Google's
keys, with the client IDs as audience), so **no OAuth client secret is
needed on the server** — nothing secret goes into Secret Manager for
sign-in.

## 5. First deploy

Push to the repo's default branch (`ccr-85f84f81-0scrin` — see the
branch note in `deploy-gcp.yml`). The workflow:

1. Runs the web tests (`npm ci && npm test`) and the server tests
   (`npm ci && npm run typecheck && npm test` in `server/`).
2. Authenticates to GCP with Workload Identity Federation as
   `beech-deploy` (no key).
3. Builds the Docker image (web app built with accounts on, API server
   in the same container), pushes it to Artifact Registry.
4. Deploys the Cloud Run service `beech` (1 CPU, 512 Mi, concurrency
   80, scales to zero, max 10 instances), attached to Cloud SQL via the
   unix socket, with `DB_PASSWORD` read from Secret Manager at runtime.
5. Smoke-tests the live URL: `GET /api/health` and `GET /`.

The server applies database migrations at startup under a Postgres
advisory lock, so several instances starting together don't race. The
first deploy creates the service; later pushes update it in place.

Check it: `gcloud run services describe beech --region us-central1
--format 'value(status.url)'`, or Cloud Run → beech → Logs.

## 6. Custom domain

Two options (docs/GCP.md); pick one:

- **Cloud Run domain mapping (default in this Terraform):** set
  `custom_domain = "play.beech.games"` (in a `terraform.tfvars` or
  `-var`), `terraform apply`, then add the DNS records the mapping
  prints. Only do this after the first successful deploy — the mapping
  needs the service to exist. (`beech.markjen.com` stays mapped as a
  legacy host, but it was created manually and is not managed here.)
- **Firebase Hosting in front:** rewrites everything to the `beech`
  service, adds a CDN, works in every region. Then leave
  `custom_domain` empty and set the rewrite in Firebase.

### Admin console domain: `admin.beech.games`

Same shape, separate variable — the admin console is its own Cloud Run
service (`beech-admin`, split out in PR #29). Order of operations:

1. Merge and deploy first, so the `beech-admin` service exists. The
   mapping fails if the service does not exist yet.
2. `terraform apply -var admin_custom_domain=admin.beech.games`
   (or set `admin_custom_domain` in a `terraform.tfvars`). This creates
   the `beech-admin` domain mapping and an uptime check for the admin
   sign-in page (gated on the same variable; it is not yet wired into
   the uptime alert policy — see the follow-up below).
3. Add the DNS records the mapping prints, in Squarespace (the
   `beech.games` zone). Certificate provisioning waits on DNS.
4. Add `https://admin.beech.games` to the web OAuth client's
   Authorized JavaScript origins (Console → APIs & Services →
   Credentials), next to `https://beech.games`. Google sign-in on the
   admin console will not work until this is done.

Note: the `play.beech.games` game mapping and the `beech.games` landing
mapping were created manually with
`gcloud beta run domain-mappings create` and Terraform state may not
yet include them — this configuration does not claim to manage them. If
one of them is imported later, `custom_domain` should be set to that
domain (the one resource manages one mapping).

### Landing page domain: `beech.games` + `www.beech.games`

The server already serves the landing page for those hosts
(docs/LANDING_PAGE.md). Order of operations:

1. Deploy first (the code is in the `beech` service already; `/landing`
   works now).
2. `terraform apply -var landing_custom_domain=www.beech.games`
   (or set `landing_custom_domain` in a `terraform.tfvars`). This creates
   the `www.beech.games` domain mapping and an uptime check for the
   landing page (gated on the same variable; it is not yet wired into
   the uptime alert policy — see the follow-up in docs/LANDING_PAGE.md).
   The apex mapping is **not** created here: it already exists, created
   manually — do not import it as part of this step.
3. Add the DNS records the mappings print, in Squarespace (the
   `beech.games` zone): the apex records come from the existing manual
   mapping (`gcloud beta run domain-mappings describe --service beech
   --domain beech.games`), the www records from the new mapping.
   Certificate provisioning waits on DNS.

Follow-up: wire the landing uptime check into the `beech: site or API
down` alert policy (`google_monitoring_alert_policy.uptime` in
`infra/monitoring.tf`). It was left out of this change because the
policy's conditions reference the checks by index, and a new condition
that only exists when the landing domain is set needs a `dynamic` block
(or a separate policy) — untested here, since `terraform plan` was not
run (see below).

Follow-up: wire the admin uptime check into the `beech: site or API
down` alert policy (`google_monitoring_alert_policy.uptime` in
`infra/monitoring.tf`). It was left out of this change because the
policy's conditions reference the checks by index, and a new condition
that only exists when the admin domain is set needs a `dynamic` block
(or a separate policy) — untested here, since `terraform plan` was not
run (see below).

### Shore site domain: `beechshore.com`

Same shape as the admin domain, one more mapping — the shore site is
served by the `beech` service itself (Host-header routing in
`server/src/rootApp.ts`), so the server already answers to both hosts;
only the mappings and DNS are missing:

1. Verify the domain for the GCP account first. As of Nov 23, 2026
   `beechshore.com` is **not** in the verified-domains list (`beech.games`
   is), and mapping creation fails with "the provided domain does not
   appear to be verified" until it is. Run `gcloud domains verify
   beechshore.com`, which opens the Search Console flow in a browser;
   add the TXT record it gives in the Squarespace DNS zone
   (`beechshore.com`), then complete verification there.
2. Merge and deploy first, so the `beech` service exists. The mappings
   fail if the service does not exist yet.
3. `terraform apply -var shore_custom_domain=beechshore.com`
   (or set `shore_custom_domain` in a `terraform.tfvars`). This creates
   the `beechshore.com` and `www.beechshore.com` domain mappings
   (`google_cloud_run_domain_mapping.shore` and `.shore_www`, both gated
   on the same variable) and an uptime check for the shore home page
   (gated on the same variable; it is not yet wired into the uptime
   alert policy — same follow-up as the admin check above).
4. Add the DNS records both mappings print, in Squarespace (the
   `beechshore.com` zone). Certificate provisioning waits on DNS.
5. No OAuth or app change: the shore site has no sign-in, and the game
   links to it with `VITE_SHORE_URL` (default `https://beechshore.com`).

   If the mappings are created with `gcloud beta run domain-mappings
   create` instead of `terraform apply`, import both mappings into
   Terraform state before any apply, or apply fails with "already
   exists" (same situation as the manual `play.beech.games` and
   `beech.games` mappings above).

Until the domain is on, the shore is at `/shore` on https://play.beech.games
(see [SHORE_SITE.md](../docs/SHORE_SITE.md)).

## 7. Firebase (Android push notifications)

The Android app gets push through FCM. The setup is Terraform-managed
(`infra/firebase.tf`): the Firebase project link, the Android app
`app.beech.beach` (App ID `1:650382817342:android:762319383603d406b3b96f`),
the Firebase + FCM APIs, and the `roles/firebasecloudmessaging.admin`
grant on `beech-run`. Analytics is off, and no other Firebase product is
enabled. The Firebase resources are **beta-only** in the provider, so
they use the `google-beta` provider (see `infra/versions.tf`); everything
else uses the GA provider.

The project was linked to Firebase and the app registered in the console
on 2026-11-26, before this configuration existed, and then imported into
state — do not recreate them in the console. The imports used:

```bash
cd infra
terraform import google_firebase_project.beech beech-prod
terraform import google_firebase_android_app.beech 'projects/beech-prod/androidApps/1:650382817342:android:762319383603d406b3b96f'
terraform import 'google_project_service.apis["firebase.googleapis.com"]' beech-prod/firebase.googleapis.com
terraform import 'google_project_service.apis["fcm.googleapis.com"]' beech-prod/fcm.googleapis.com
terraform import google_project_iam_member.beech_run_fcm_admin 'projects/beech-prod roles/firebasecloudmessaging.admin serviceAccount:beech-run@beech-prod.iam.gserviceaccount.com'
```

What stays outside Terraform (by hand): the `GOOGLE_SERVICES_JSON`
GitHub secret (download `google-services.json` from Firebase console →
Project settings), the `FCM_PROJECT_ID` and `NATIVE_PUSH` GitHub
Actions variables, and the Play Data safety form line for the push
token (device IDs). See `docs/INBOX_NOTIFICATIONS.md`, "Turning on
push". iOS push is APNs directly, not Firebase (same doc, §B).

## 8. Push tick (Cloud Scheduler)

Push delivery is ticked once a minute by Cloud Scheduler
(`docs/INBOX_NOTIFICATIONS.md`, "Push"): the `beech-push-tick` job
POSTs `/api/push/tick` on the beech service with OIDC as the
`beech-scheduler` service account, which holds `roles/run.invoker` on
the service. The setup is Terraform-managed (`infra/scheduler.tf`):
the job, the service account, the invoker grant, and the
`cloudscheduler.googleapis.com` API. The service itself is deployed
by GitHub Actions, not Terraform, so the job's target URL comes from
the `beech_service_url` variable (the run.app URL — it does not
change across revisions or redeploys).

The job was created with gcloud on 2026-11-26, before this
configuration existed, and then imported into state — do not recreate
it in the console. The imports used:

```bash
cd infra
terraform import google_service_account.beech_scheduler 'projects/beech-prod/serviceAccounts/beech-scheduler@beech-prod.iam.gserviceaccount.com'
terraform import google_cloud_run_v2_service_iam_member.beech_scheduler_invoker 'projects/beech-prod/locations/us-central1/services/beech roles/run.invoker serviceAccount:beech-scheduler@beech-prod.iam.gserviceaccount.com'
terraform import google_cloud_scheduler_job.beech_push_tick 'projects/beech-prod/locations/us-central1/jobs/beech-push-tick'
terraform import 'google_project_service.apis["cloudscheduler.googleapis.com"]' beech-prod/cloudscheduler.googleapis.com
```

The invoker grant is non-authoritative for the role: the binding
also holds `allUsers` (public access to the service), which this
configuration leaves alone.

## Server runtime contract (for reference)

From `server/src/server.ts` — what the container needs at runtime:

| Env var | Value in production |
|---|---|
| `PORT` | provided by Cloud Run (container defaults to 8080) |
| `PUBLIC_DIR` | `/srv/public` (set in the Dockerfile) |
| `DB_SOCKET` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `/cloudsql/<project>:<region>:beech-db`, `beech`, secret `beech-db-password`, `beech` |
| `GOOGLE_CLIENT_IDS` | comma-separated client IDs (web, iOS, Android) |
| `APPLE_CLIENT_IDS` | comma-separated (bundle id, Services ID); empty until Apple sign-in ships |
| `ALLOWED_ORIGINS` | unset — defaults to `capacitor://localhost,https://localhost` |
| `GIFT_CODE_PEPPER` | pepper for gift card code hashes, from Secret Manager secret `beech-gift-code-pepper`; unset: works, but logs a warning. Must match `beech-admin`'s |
| `DEV_AUTH` | **never set in production** (enables a dev-only sign-in; the server refuses to start with it when `NODE_ENV=production`) |

`DATABASE_URL` is an alternative to the socket vars (used locally and
in CI's image boot test); production uses the socket. The DB pool is
capped at 5 connections per instance (`server/src/db.ts`).

### The admin console service, `beech-admin` (docs/GIFT_CARDS_PROMOS.md)

The deploy workflow deploys a second service, `beech-admin`, from the
Dockerfile's `admin` target. It uses the same runtime service account and
Cloud SQL connection, with `--max-instances 1`. Its environment:

| Variable | Value |
|---|---|
| `DB_SOCKET` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | same as `beech` |
| `GOOGLE_CLIENT_ID` | the web OAuth client; **add this service's URL to the client's Authorized JavaScript origins** |
| `ADMIN_EMAILS` | comma-separated verified Google emails allowed in — production: `markjen@gmail.com`; empty: nobody |
| `ADMIN_API_TOKEN` | the CLI's credential, from secret `beech-admin-token`; unset: the CLI can't authenticate |
| `GIFT_CODE_PEPPER` | from secret `beech-gift-code-pepper` (same value as `beech`) |
| `BEECH_APP_URL` | the `beech` service URL, for "open in the game" links (set by the workflow) |

### Gift cards / admin secrets

The two admin secrets are **not** in Terraform: create them by hand, then
add them to the deploy workflow's `--set-secrets` next to `DB_PASSWORD`.
Neither value ever goes in the repo.

```bash
# one random value each (keep them somewhere safe — the CLI token is the only copy)
openssl rand -hex 32  # -> ADMIN_API_TOKEN, secret beech-admin-token
openssl rand -hex 32  # -> GIFT_CODE_PEPPER, secret beech-gift-code-pepper
gcloud secrets create beech-admin-token --data-file=- --project beech-prod <<<"<token>"
gcloud secrets create beech-gift-code-pepper --data-file=- --project beech-prod <<<"<pepper>"
# grant the runtime service account read access, then redeploy
gcloud secrets add-iam-policy-binding beech-admin-token --member="serviceAccount:beech-run@beech-prod.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor" --project beech-prod
gcloud secrets add-iam-policy-binding beech-gift-code-pepper --member="serviceAccount:beech-run@beech-prod.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor" --project beech-prod
```

Rotating `GIFT_CODE_PEPPER` orphans unredeemed gift cards issued under
the old pepper — issue replacements instead of rotating casually.

## Destroying

```bash
terraform destroy
```

`db_deletion_protection` defaults to `true` — set
`-var db_deletion_protection=false` first, or the destroy will refuse
to delete the Cloud SQL instance. The state bucket is not managed by
Terraform; delete it by hand if you really want it gone (it holds the
old state, including the old database password — empty it first).
