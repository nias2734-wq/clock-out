#!/bin/sh
# Outline of the service for cron (needs jq). Wakes stopped sessions that have live jobs:
#   default: next job within 10 minutes, or a recurring job expiring within 24 hours
#   --all:   every stopped session with jobs (the daily sweep)
here=$(cd "$(dirname "$0")" && pwd)
dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/clock-out/sessions"
live="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions"
now=$(date +%s000)
lead=$((10 * 60 * 1000)); expiry=$((24 * 60 * 60 * 1000)); stale=$((3 * 60 * 1000))
for f in "$dir"/*.json; do
  [ -f "$f" ] || continue
  id=$(jq -r '.sessionId' "$f")
  # alive: fresh heartbeat, or a live record of Claude Code for this session
  hb=$(jq -r '.heartbeatAt // 0' "$f"); alive=$(jq -r '.alive' "$f")
  if [ "$alive" = "true" ] && [ $((now - hb)) -lt $stale ]; then continue; fi
  if grep -lq "\"sessionId\":\"$id\"" "$live"/*.json 2>/dev/null; then continue; fi
  jobs=$(jq '[.jobs[] | select(.deletedAt == null and .goneAt == null and .firedAt == null)]' "$f")
  [ "$(printf '%s' "$jobs" | jq 'length')" -gt 0 ] || continue
  reason=""
  if [ "$1" = "--all" ]; then reason="daily sweep"; else
    next=$(printf '%s' "$jobs" | jq '[.[].nextFireAt // empty] | min // empty')
    [ -n "$next" ] && [ $((next - now)) -le $lead ] && reason="next job soon"
    exp=$(printf '%s' "$jobs" | jq '[.[] | select(.recurring) | .expiresAt // empty] | min // empty')
    [ -z "$reason" ] && [ -n "$exp" ] && [ $((exp - now)) -le $expiry ] && reason="recurring job expiring"
  fi
  [ -n "$reason" ] || continue
  echo "$(date '+%F %T') REVIVE $id ($reason)"
  sh "$here/revive.sh" "$id"
done
