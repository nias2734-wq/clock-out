---
description: Remove the clock-out background service (Windows) — stop it and delete the Startup shortcut
---

Stop the clock-out service and remove its Startup shortcut. Recorded sessions and config stay unless the user asks to purge them.

On Windows run exactly (add `-Purge` only if the user asked to delete the data too):

```
powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/service/windows/uninstall.ps1"
```

Show the output as is. On other systems say there is nothing installed by this plugin outside Claude Code.
