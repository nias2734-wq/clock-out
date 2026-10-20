' clock-out: start service.ps1 without a console window (used by the Startup shortcut)
Set shell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -STA -File """ & scriptDir & "\service.ps1""", 0, False
