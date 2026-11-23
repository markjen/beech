# Production on Google Cloud

**Recommendation: Cloud Run + Cloud SQL for PostgreSQL**, deployed from
GitHub Actions with Workload Identity Federation (no keys stored anywhere).

```
 browsers ─┐                        ┌─────────────── Cloud Run: "beech" ───────────────┐
           ├── https://beech.<you> ─►  one container (Dockerfile)                     │
 iOS/      │   (Cloud Run domain     │   /           the web app (built with accounts) │
 Android ──┘    mapping or Firebase  │   /api/*      Hono API (server/src/app.ts)      │
   apps          Hosting in front)   └──────────────┬───────────────────────────────────┘
                                                    │ unix socket /cloudsql/…
                                     ┌──────────────▼──────────────┐   Secret Manager:
                                     │ Cloud SQL, PostgreSQL 16    │   beech-db-password
                                     │ users · sessions · beaches  │
                                     │ neighbors (+ future social) │
                                     └─────────────────────────────┘
```

Why this setup:

- **One service for web and mobile.** The website gets the app and API from
  the same origin, so there's no CORS or cookie setup. The Capacitor apps call
  the same `/api` with a bearer token, and their origins
  (`capacitor://localhost`, `https://localhost`) are allowed.
- **Postgres for the social features.** Neighbors are already relational
  (who sits beside whom, who has you next door). Friends, visits, guestbooks
  and shared beaches will be too. SQL with foreign keys (`ON DELETE CASCADE`
  keeps account deletion honest) fits better than a document store.
- **Cheap when quiet.** Cloud Run scales to zero and has a monthly free
  allowance. The smallest shared-core Cloud SQL instance costs roughly
  $10/month; use the GCP pricing calculator for current prices. A saved
  beach is 2-20 KB, so 100k players is about 1-2 GB.
- **Portable.** The server is plain Node (Hono + `pg`) in a container. It
  runs anywhere Postgres does, and locally it runs with no database at all
  (embedded PGlite).

Alternatives considered: Firestore (no idle cost, but social graph queries get
awkward and the security rules grow), GKE (much more to operate), and App
Engine (fine, but Cloud Run is the simpler modern option).

## One-time setup

Pick a project id and region. `us-central1` supports Cloud Run domain mappings.

```bash
PROJECT=beech-prod            # your project id
REGION=us-central1
REPO=markjen/beech            # GitHub owner/repo
gcloud config set project $PROJECT

gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com

# container registry
gcloud artifacts repositories create beech --repository-format=docker --location=$REGION

# database (smallest instance; resize later without code changes)
gcloud sql instances create beech-db --database-version=POSTGRES_16 \
  --region=$REGION --tier=db-f1-micro --edition=ENTERPRISE \
  --storage-size=10GB --storage-auto-increase --backup-start-time=03:00
gcloud sql databases create beech --instance=beech-db
DBPASS=$(openssl rand -base64 24)
gcloud sql users create beech --instance=beech-db --password="$DBPASS"
printf %s "$DBPASS" | gcloud secrets create beech-db-password --data-file=-

# the service's runtime identity
gcloud iam service-accounts create beech-run
RUN_SA=beech-run@$PROJECT.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$RUN_SA --role=roles/cloudsql.client
gcloud secrets add-iam-policy-binding beech-db-password --member=serviceAccount:$RUN_SA --role=roles/secretmanager.secretAccessor

# the deployer identity, used by GitHub Actions with no key file
gcloud iam service-accounts create beech-deploy
DEPLOY_SA=beech-deploy@$PROJECT.iam.gserviceaccount.com
for role in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$DEPLOY_SA --role=$role
done
gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers create-oidc github --location=global \
  --workload-identity-pool=github --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
  --attribute-condition="assertion.repository=='$REPO'"
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding $DEPLOY_SA --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
echo "GCP_WIF_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github"
```

**Google sign-in:** Google Cloud Console → APIs & Services → Credentials →
Create OAuth client ID → *Web application*. Add your production URL as an
authorized JavaScript origin, and fill in the OAuth consent screen (name,
support email, privacy policy).

**GitHub** (Settings → Secrets and variables → Actions → Variables). There
are no secrets to add.

| Variable | Value |
|---|---|
| `GCP_ENABLED` | `1` |
| `GCP_PROJECT_ID`, `GCP_REGION` | as above |
| `GCP_WIF_PROVIDER` | printed above |
| `GCP_DEPLOY_SA`, `GCP_RUNTIME_SA` | `beech-deploy@…`, `beech-run@…` |
| `GCP_SQL_INSTANCE` | `$PROJECT:$REGION:beech-db` |
| `GOOGLE_CLIENT_ID` | the web client ID |
| `GOOGLE_CLIENT_IDS` | web, plus iOS and Android client IDs, comma-separated |
| `APPLE_CLIENT_IDS` | later, for Sign in with Apple |

Then push to `main`. `.github/workflows/deploy-gcp.yml` runs the tests,
builds the image, pushes it to Artifact Registry, deploys `beech`, and
smoke-tests the live URL. The server applies database migrations at startup,
under a Postgres advisory lock.

**Custom domains:** the main site is **https://beech.games** (registered
Nov 23, 2026 on Squarespace Domains, alongside `beechgame.com`,
`beechgames.com` and `beechshore.com`). `beech.markjen.com` stays mapped
and working. `beechgame.com` and `beechgames.com` 301-redirect to
`https://beech.games` (Squarespace domain forwarding); `www.beech.games`
redirects the same way — only the apex is mapped to Cloud Run.
`beechshore.com` is a separate future product and is not pointed at this
service.

A new mapping needs the domain verified for the Google account first:
`gcloud domains verify <domain>` opens a Search Console flow that shows
a `google-site-verification` TXT record to add in Squarespace DNS, then:

`gcloud beta run domain-mappings create --service beech --domain beech.games --region $REGION`

then add the DNS records the mapping prints. For the apex those are A
records (for apex domains Google prints its 216.239.32.21 / 34.21 /
36.21 / 38.21 set — confirm against the mapping output); for a
subdomain it is a CNAME to `ghs.googlehosted.com` (that is how the
existing `beech.markjen.com` mapping is wired). The managed certificate
takes a while to provision after DNS propagates. Alternatively, put
Firebase Hosting in front (it rewrites everything to the `beech`
service), which adds a CDN and works in every region.

Google sign-in on the new domain needs one console change: the OAuth
web client ("beech web") Authorized JavaScript origins must add
`https://beech.games` (keep `https://beech.markjen.com`). The web app
uses Google Identity Services in popup mode (`ux_mode: 'popup'`,
`src/net/account.ts`), so no redirect URIs are involved. The web build
itself needs no change: `VITE_API_URL` is empty in the Dockerfile, so
the app calls the API same-origin, the server allows its own origin for
CORS, share-link previews use the request URL, and the PWA manifest
uses relative URLs.

**Phone apps:** build with `VITE_ACCOUNTS=1 VITE_API_URL=https://beech.markjen.com`.
(The apps keep calling the old host for now — it stays live. Moving the
apps' API base to `https://beech.games` is a follow-up; it means editing
the mobile workflows, which can't be pushed with the usual `gh` token.)

## Running it locally

```bash
npm run server:dev        # builds the app with accounts + dev sign-in and serves both on :8787 (embedded PGlite, no Postgres needed)
# or against a real Postgres:
DATABASE_URL=postgres://user:pass@localhost:5432/beech DEV_AUTH=1 PORT=8787 node server/build/server.js

docker build -t beech .   # the production image
docker run -p 8080:8080 -e DATABASE_URL=postgres://… beech
```

Behind a TLS-inspecting proxy (like the agent sandbox), build with
`--network host --build-arg HTTPS_PROXY=$HTTPS_PROXY --secret id=ca,src=<ca bundle>`.

## Operations

- **Logs:** Cloud Run → beech → Logs (stdout).
- **Backups:** daily Cloud SQL backups (configured above). Enable
  point-in-time recovery once there are real players.
- **Abuse:** add Cloud Armor rate limiting on `/api/*` once you're behind a
  load balancer, or a per-IP limit in the app.
- **Scaling:** raise `--max-instances` and the Cloud SQL tier. Each
  instance's pool uses at most 5 connections (`server/src/db.ts`).
