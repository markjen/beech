#!/bin/bash
# Cloud-session setup: installs rtk (token-saving output filter, see
# docs/AGENT_TOKENS.md), the LemmaScript/Dafny verifier (docs/VERIFICATION.md)
# and the npm dependencies for the app and the server.
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
# LemmaScript toolchain for the .claude/skills/lemmascript* skills
# (docs/VERIFICATION.md): Dafny (self-contained, includes Z3) and lsc, pinned.
DAFNY_VERSION=4.11.0
DAFNY_SHA256=a46a9ff7cdd720f7955854c78e95df13f4cfe6b80691b05f8654fe19e8267179
if [ "$(uname -m)" = "x86_64" ] && ! dafny --version 2>/dev/null | grep -q "^$DAFNY_VERSION+"; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/dafny.zip" \
    "https://github.com/dafny-lang/dafny/releases/download/v$DAFNY_VERSION/dafny-$DAFNY_VERSION-x64-ubuntu-22.04.zip"
  echo "$DAFNY_SHA256  $tmp/dafny.zip" | sha256sum --check --status
  rm -rf /opt/dafny
  unzip -q "$tmp/dafny.zip" -d /opt
  ln -sf /opt/dafny/dafny /usr/local/bin/dafny
  rm -rf "$tmp"
fi
LSC_VERSION=0.6.12
if ! npm ls -g --depth=0 "lemmascript@$LSC_VERSION" >/dev/null 2>&1; then
  npm install -g --no-audit --no-fund --loglevel=error "lemmascript@$LSC_VERSION"
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
