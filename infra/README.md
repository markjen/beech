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
  `custom_domain = "beech.markjen.com"` (in a `terraform.tfvars` or
  `-var`), `terraform apply`, then add the DNS records the mapping
  prints. Only do this after the first successful deploy — the mapping
  needs the service to exist.
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

Note: the `beech.games` game mapping was created manually with
`gcloud beta run domain-mappings create` and Terraform state may not
yet include it — this configuration does not claim to manage it. If it
is imported later, `custom_domain` should be set to `beech.games`.

Follow-up: wire the admin uptime check into the `beech: site or API
down` alert policy (`google_monitoring_alert_policy.uptime` in
`infra/monitoring.tf`). It was left out of this change because the
policy's conditions reference the checks by index, and a new condition
that only exists when the admin domain is set needs a `dynamic` block
(or a separate policy) — untested here, since `terraform plan` was not
run (see below).

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
