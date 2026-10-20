' Starts the n8n auto-deploy loop with no window (a scheduled PowerShell task would flash a console every run).
' The ArakMarketingAutoDeploy task runs this every 5 minutes; if the loop is already running the new one exits at once.
Set shell = CreateObject("WScript.Shell")
folder = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & folder & "\auto-deploy.ps1"" -Loop", 0, False
