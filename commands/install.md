---
description: Install the clock-out background service (Windows) — Startup shortcut, config, start now
---

Install the part of clock-out that runs outside Claude Code: the service that wakes stopped sessions so their CronCreate jobs keep firing.

1. On Windows, run exactly:

```
powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/service/windows/install.ps1"
```

   Show the user its output as is (config path, Startup shortcut, service pid, log path).

2. On macOS or Linux, do not run anything. Tell the user the service is Windows-only for now and point them to `${CLAUDE_PLUGIN_ROOT}/service/posix/README.md` for the cron-based outline.

3. Then run `/clock-out` and show the result. If an older `claude-usage-widget` (v1) is also running on this machine, say that both would wake the same sessions and that v1 should be closed.

Do nothing else.
