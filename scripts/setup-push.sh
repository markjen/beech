#!/usr/bin/env bash
# Turn on push notifications: the Google Cloud side of
# docs/INBOX_NOTIFICATIONS.md, "Turning on push: owner steps". Run it on a
# machine where gcloud is signed in to the project (not in CI). Safe to run
# again: it skips what already exists. Secrets go straight into Secret
# Manager and are never printed; at the end it prints the GitHub Actions
# variables to set (Settings -> Secrets and variables -> Actions -> Variables).
#
#   scripts/setup-push.sh web                       # A: web push + the Cloud Scheduler tick
#   scripts/setup-push.sh ios ~/AuthKey_ABC123.p8 TEAMID   # B: the APNs key (after making it at developer.apple.com)
#   scripts/setup-push.sh android                   # C: let the server send through FCM (after adding Firebase)
#
# PROJECT, REGION and SERVICE can be overridden from the environment.
set -euo pipefail

PROJECT="${PROJECT:-beech-prod}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-beech}"
RUN_SA="${RUN_SA:-beech-run@$PROJECT.iam.gserviceaccount.com}"
SCHED_SA="beech-scheduler@$PROJECT.iam.gserviceaccount.com"
GC=(gcloud --project "$PROJECT" --quiet)

vars=()
say() { printf '\n== %s\n' "$*"; }
has_secret() { "${GC[@]}" secrets describe "$1" >/dev/null 2>&1; }
grant_secret() {
  "${GC[@]}" secrets add-iam-policy-binding "$1" \
    --member="serviceAccount:$RUN_SA" --role=roles/secretmanager.secretAccessor >/dev/null
}

web() {
  say "Web push: the VAPID key pair"
  if has_secret beech-vapid-private-key; then
    echo "beech-vapid-private-key exists; keeping it"
  else
    # a P-256 key pair; only the private half (raw d, base64url) is stored
    node -e '
      const c = require("crypto");
      const { privateKey } = c.generateKeyPairSync("ec", { namedCurve: "P-256" });
      process.stdout.write(privateKey.export({ format: "jwk" }).d);
    ' | "${GC[@]}" secrets create beech-vapid-private-key --replication-policy=automatic --data-file=-
    echo "created beech-vapid-private-key"
  fi
  grant_secret beech-vapid-private-key
  # the public key, from the stored private key (it's public: the app needs it)
  local pub
  pub=$("${GC[@]}" secrets versions access latest --secret=beech-vapid-private-key | node -e '
    let d = ""; process.stdin.on("data", (x) => (d += x)).on("end", () => {
      const e = require("crypto").createECDH("prime256v1");
      e.setPrivateKey(Buffer.from(d.trim(), "base64url"));
      process.stdout.write(e.getPublicKey().toString("base64url"));
    });')
  vars+=("VAPID_PUBLIC_KEY=$pub" "VAPID_SUBJECT=mailto:<a support address>")

  say "Web push: the once-a-minute tick (Cloud Scheduler)"
  "${GC[@]}" services enable cloudscheduler.googleapis.com
  "${GC[@]}" iam service-accounts describe "$SCHED_SA" >/dev/null 2>&1 ||
    "${GC[@]}" iam service-accounts create beech-scheduler --display-name="beech push tick"
  local url
  url=$("${GC[@]}" run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')
  "${GC[@]}" run services add-iam-policy-binding "$SERVICE" --region="$REGION" \
    --member="serviceAccount:$SCHED_SA" --role=roles/run.invoker >/dev/null
  local verb=create
  "${GC[@]}" scheduler jobs describe beech-push-tick --location="$REGION" >/dev/null 2>&1 && verb=update
  "${GC[@]}" scheduler jobs "$verb" http beech-push-tick --location="$REGION" \
    --schedule='* * * * *' --http-method=POST --uri="$url/api/push/tick" \
    --oidc-service-account-email="$SCHED_SA" --oidc-token-audience="$url/api/push/tick" >/dev/null
  echo "beech-push-tick: ${verb}d (404s until the next deploy picks up the variables)"
  vars+=("PUSH_TICK_SERVICE_ACCOUNT=$SCHED_SA" "PUSH_TICK_AUDIENCE=$url/api/push/tick")
}

ios() {
  local p8="${1:?usage: setup-push.sh ios <AuthKey_KEYID.p8> <TEAM_ID>}"
  local team="${2:?usage: setup-push.sh ios <AuthKey_KEYID.p8> <TEAM_ID>}"
  local kid
  kid=$(basename "$p8" .p8)
  kid="${kid#AuthKey_}"
  grep -q 'BEGIN PRIVATE KEY' "$p8" || { echo "$p8 doesn't look like an APNs .p8 key" >&2; exit 1; }
  say "iOS push: the APNs key"
  if has_secret beech-apns-key; then
    "${GC[@]}" secrets versions add beech-apns-key --data-file="$p8" >/dev/null
    echo "beech-apns-key: new version added"
  else
    "${GC[@]}" secrets create beech-apns-key --replication-policy=automatic --data-file="$p8"
  fi
  grant_secret beech-apns-key
  vars+=("APNS_KEY_ID=$kid" "APNS_TEAM_ID=$team")
  echo "Also: developer.apple.com -> Identifiers -> app.beech.beach -> Push Notifications on."
}

android() {
  say "Android push: FCM"
  "${GC[@]}" services enable fcm.googleapis.com
  gcloud projects add-iam-policy-binding "$PROJECT" --quiet \
    --member="serviceAccount:$RUN_SA" --role=roles/firebasecloudmessaging.admin >/dev/null
  echo "the game server may send through FCM"
  vars+=("FCM_PROJECT_ID=$PROJECT")
  echo "Also: the GOOGLE_SERVICES_JSON secret in GitHub (base64 -w0 google-services.json)."
}

case "${1:-}" in
  web) web ;;
  ios) shift; ios "$@" ;;
  android) android ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac

say "Now set these GitHub Actions variables, then deploy (push to main or run the deploy workflow):"
printf '  %s\n' "${vars[@]}"
case "$1" in ios | android) echo "  NATIVE_PUSH=1   (once iOS and/or Android are done; then run \"Release to stores\")" ;; esac
