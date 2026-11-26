#!/bin/bash
# Model-check the game's state machines with TLC (docs/STATE_MACHINES.md).
#
#   specs/tla/check.sh            every spec, in its fixed form (should pass)
#   specs/tla/check.sh --bugs     the pre-fix forms too (each should find its bug)
#   specs/tla/check.sh Snacks     one spec
#
# Needs Java 11+. Downloads a pinned, checksum-verified tla2tools.jar once.
set -euo pipefail
cd "$(dirname "$0")"

TLA_VERSION=1.7.4
TLA_SHA256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
JAR="${TLA_JAR:-${XDG_CACHE_HOME:-$HOME/.cache}/tla/tla2tools-$TLA_VERSION.jar}"
if [ ! -f "$JAR" ]; then
  mkdir -p "$(dirname "$JAR")"
  curl -fsSL -o "$JAR.tmp" "https://github.com/tlaplus/tlaplus/releases/download/v$TLA_VERSION/tla2tools.jar"
  echo "$TLA_SHA256  $JAR.tmp" | sha256sum --check --status
  mv "$JAR.tmp" "$JAR"
fi

bugs=false
specs=()
for a in "$@"; do
  if [ "$a" = "--bugs" ]; then bugs=true; else specs+=("$a"); fi
done
[ ${#specs[@]} -eq 0 ] && specs=(Snacks Pets Neighbors BeachEditing Piers BeachCopy SandBucks Push Invites InlandSections)

meta="$(mktemp -d)"
trap 'rm -rf "$meta"' EXIT
run() { # spec cfg (TLC exits non-zero when it finds a violation: that's an answer, not a failure here)
  { java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -config "$2.cfg" -deadlock -workers auto -metadir "$meta/$2" "$1.tla" 2>&1 || true; } \
    | grep -v "^Progress" | grep -E "is violated|No error has been found|distinct states found|^Error" | head -2 | tr '\n' ' '
  echo
}
status=0
for spec in "${specs[@]}"; do
  printf '%-22s ' "${spec}Fixed"
  out="$(run "$spec" "${spec}Fixed")"
  echo "$out"
  case "$out" in *"No error has been found"*) ;; *) status=1 ;; esac
  if $bugs; then
    # each invariant on its own: TLC stops at the first one it breaks
    for inv in $(sed -n 's/^INVARIANTS //p' "$spec.cfg"); do
      [ "$inv" = TypeOK ] && continue
      sed "s/^INVARIANTS .*/INVARIANTS TypeOK $inv/" "$spec.cfg" > "$meta/one.cfg"
      cp "$meta/one.cfg" "_$spec.$inv.cfg"
      printf '%-22s ' "$spec $inv"
      run "$spec" "_$spec.$inv"
      rm -f "_$spec.$inv.cfg"
    done
  fi
done
exit $status
