# Service on macOS / Linux (outline)

The plugin module works everywhere; only the *service* (the process that wakes stopped sessions while no Claude Code session is running) is Windows-only so far. On macOS/Linux you can approximate it with cron:

```
# every 5 minutes: wake stopped sessions whose next job is within 10 minutes or whose recurring job expires within a day
*/5 * * * * /bin/sh "<plugin root>/service/posix/service.sh" >> "$HOME/.claude/clock-out/service.log" 2>&1
# weekdays at 17:55: wake every stopped session that still has jobs
55 17 * * 1-5 /bin/sh "<plugin root>/service/posix/service.sh" --all >> "$HOME/.claude/clock-out/service.log" 2>&1
```

`service.sh` reads `~/.claude/clock-out/sessions/*.json` (written by the plugin module) and calls `revive.sh <session id>` for each session to wake. It needs `jq`. This is an outline: it is not measured on macOS or Linux yet.
