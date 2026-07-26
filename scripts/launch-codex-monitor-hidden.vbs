Option Explicit

Const ForWriting = 2

Dim arguments, shell, fileSystem, powershellPath, launcherPath, port, command
Dim localAppData, stateRoot, errorLogPath, exitCode, errorNumber, errorDescription
Set arguments = WScript.Arguments
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

localAppData = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
If Len(Trim(localAppData)) = 0 Or localAppData = "%LOCALAPPDATA%" Then
  localAppData = shell.ExpandEnvironmentStrings("%TEMP%")
End If
stateRoot = fileSystem.BuildPath(localAppData, "CodexUsageMonitor")
errorLogPath = fileSystem.BuildPath(stateRoot, "launcher-error.log")

On Error Resume Next
If fileSystem.FileExists(errorLogPath) Then fileSystem.DeleteFile errorLogPath, True
On Error GoTo 0

If arguments.Count < 2 Then FailAndQuit "Hidden launcher requires the PowerShell path and CDP port.", 2

powershellPath = arguments.Item(0)
port = arguments.Item(1)
If Not IsNumeric(port) Then FailAndQuit "The CDP port must be numeric.", 2
launcherPath = fileSystem.BuildPath(fileSystem.GetParentFolderName(WScript.ScriptFullName), "launch-codex-monitor.ps1")
If Not fileSystem.FileExists(powershellPath) Then FailAndQuit "PowerShell executable not found: " & powershellPath, 2
If Not fileSystem.FileExists(launcherPath) Then FailAndQuit "PowerShell launcher not found: " & launcherPath, 2

command = Quote(powershellPath) & " -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(launcherPath) & " -Port " & port
On Error Resume Next
Err.Clear
exitCode = shell.Run(command, 0, True)
errorNumber = Err.Number
errorDescription = Err.Description
On Error GoTo 0

If errorNumber <> 0 Then
  FailAndQuit "Unable to start PowerShell (" & errorNumber & "): " & errorDescription, 1
End If
If exitCode <> 0 Then
  If Not fileSystem.FileExists(errorLogPath) Then WriteFailure "PowerShell launcher exited with code " & exitCode & "."
  WScript.Quit exitCode
End If

WScript.Quit 0

Sub FailAndQuit(message, code)
  WriteFailure message
  WScript.Quit code
End Sub

Sub WriteFailure(message)
  Dim logFile
  On Error Resume Next
  If Not fileSystem.FolderExists(stateRoot) Then fileSystem.CreateFolder stateRoot
  Set logFile = fileSystem.OpenTextFile(errorLogPath, ForWriting, True, 0)
  logFile.WriteLine "[" & Timestamp() & "] " & message
  logFile.Close
  On Error GoTo 0
End Sub

Function Timestamp()
  Dim current
  current = Now
  Timestamp = Year(current) & "-" & Pad2(Month(current)) & "-" & Pad2(Day(current)) & " " & Pad2(Hour(current)) & ":" & Pad2(Minute(current)) & ":" & Pad2(Second(current))
End Function

Function Pad2(value)
  Pad2 = Right("0" & CStr(value), 2)
End Function

Function Quote(value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
