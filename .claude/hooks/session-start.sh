#!/bin/bash
# Cloud-session setup: installs rtk (token-saving output filter, see
# docs/AGENT_TOKENS.md) and the npm dependencies for the app and the server.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# rtk, pinned and checksum-verified. Bump both lines together.
RTK_VERSION=1.2.1
RTK_SHA256=75f64525711be935657a6b228d929c24bd9d1ab7d640ea374a8b913e5b5bac05
if ! rtk --version 2>/dev/null | grep -qx "rtk $RTK_VERSION"; then
  if [ "$(uname -m)" = "x86_64" ]; then
    tmp="$(mktemp -d)"
    curl -fsSL -o "$tmp/rtk.tgz" \
      "https://github.com/rtk-ai/rtk/releases/download/v$RTK_VERSION/rtk-x86_64-unknown-linux-musl.tar.gz"
    echo "$RTK_SHA256  $tmp/rtk.tgz" | sha256sum --check --status
    tar -xzf "$tmp/rtk.tgz" -C "$tmp" rtk
    install -m 755 "$tmp/rtk" /usr/local/bin/rtk
    rm -rf "$tmp"
  else
    echo "session-start: no pinned rtk build for $(uname -m); skipping" >&2
  fi
fi
# npm dependencies, only when a lockfile or this script changed.
for dir in . server; do
  hashes="$dir/node_modules/.session-start.sha256"
  if ! sha256sum --check --status "$hashes" 2>/dev/null; then
    rm -f "$hashes"
    (cd "$dir" && npm ci --no-audit --no-fund --loglevel=error)
    sha256sum .claude/hooks/session-start.sh "$dir/package.json" "$dir/package-lock.json" > "$hashes" || rm -f "$hashes"
  fi
done
