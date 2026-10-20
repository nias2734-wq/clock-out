#!/bin/sh
# PostToolUse hook (CronCreate | CronDelete): touch the stamp file so the service recomputes its list.
# Safety net for sessions where the hooks module did not load; the module touches the same file itself.
base="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
dir="$base/clock-out/sessions"
mkdir -p "$dir" 2>/dev/null
date +%Y-%m-%dT%H:%M:%S > "$dir/_stamp" 2>/dev/null
exit 0
