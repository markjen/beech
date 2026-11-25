#!/bin/bash
# PreToolUse(Bash) hook: lets rtk rewrite commands to compact-output versions.
# A no-op when rtk isn't installed, so the repo works without it.
command -v rtk >/dev/null 2>&1 || exit 0
exec rtk hook claude
