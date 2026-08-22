' Launches the reminder script with no console window.
'
' Task Scheduler running powershell.exe directly pops a console every five
' minutes, whatever -WindowStyle Hidden says, because the console is created
' before PowerShell reads its arguments. wscript creates none at all.
'
' The alternative was registering the task as SYSTEM, which needs elevation
' this account does not have.

Dim shell, here, script
Set shell = CreateObject("WScript.Shell")

here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
script = here & "send-reminders.ps1"

' 0 = hidden window, False = do not wait for it to finish.
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & script & """", 0, False
