#!/bin/sh
# Wake one stopped Claude Code session in the background. Usage: revive.sh <session id> [first message]
# Flags only on the first background start (bgSince absent in the session file); a stray copy is stopped.
id="$1"; shift
msg="${1:-clock-out woke this session so its scheduled jobs keep firing. Call CronList, re-create any job that is missing, re-register a recurring job that expires within a day, report in one line, then stop.}"
dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/clock-out/sessions"
file="$dir/$id.json"
flags=""
if [ -f "$file" ] && ! grep -q '"bgSince"' "$file"; then flags="--dangerously-skip-permissions"; fi
out=$(claude --bg --resume "$id" $flags "$msg" 2>&1) || { echo "revive $id failed: $out"; exit 1; }
copy=$(printf '%s' "$out" | sed -n 's/.*started a copy as \([A-Za-z0-9]*\).*/\1/p')
[ -n "$copy" ] && claude stop "$copy" >/dev/null 2>&1
if [ -f "$file" ] && command -v jq >/dev/null 2>&1 && ! grep -q '"bgSince"' "$file"; then
  tmp=$(mktemp) && jq --arg now "$(date +%s000)" '.bgSince = ($now|tonumber)' "$file" > "$tmp" && mv "$tmp" "$file"
fi
echo "revive $id: woken${copy:+ (copy $copy stopped)}"
