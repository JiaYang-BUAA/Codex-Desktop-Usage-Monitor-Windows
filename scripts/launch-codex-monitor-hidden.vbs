Option Explicit

Dim arguments, shell, fileSystem, powershellPath, launcherPath, port, command
Set arguments = WScript.Arguments

If arguments.Count < 2 Then WScript.Quit 2

powershellPath = arguments.Item(0)
port = arguments.Item(1)
If Not IsNumeric(port) Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
launcherPath = fileSystem.BuildPath(fileSystem.GetParentFolderName(WScript.ScriptFullName), "launch-codex-monitor.ps1")

command = Quote(powershellPath) & " -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File " & Quote(launcherPath) & " -Port " & port
shell.Run command, 0, False

Function Quote(value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
