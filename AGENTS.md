# Codex Instructions

These instructions apply to the entire repository. They are primarily for Codex or another coding agent helping a Windows user install, configure, update, or customize the monitor.

## Install For The Current User

When the user asks to install this project:

1. Confirm that the host is Windows and read `README.md` before acting.
2. Use the checked-out repository or an extracted official Release. Do not download executables or scripts from unrelated locations.
3. Run `pwsh -NoProfile -File .\install.ps1`. The installer checks Microsoft Store and common non-Store Codex paths first; if no executable is found, answer its path prompts instead of guessing. If PowerShell 7 is unavailable, use `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`.
4. The installer must create a versioned copy under `%LOCALAPPDATA%\Programs\CodexUsageMonitor` and a desktop shortcut named `Codex Usage Monitor`.
5. Verify the installed version directory and shortcut. Its target must be `wscript.exe`, which launches PowerShell invisibly through `launch-codex-monitor-hidden.vbs`. Do not launch, restart, or terminate the user's current Codex session. Tell the user to exit Codex normally and then use the new shortcut.
6. Official subscription monitoring needs no API key or additional configuration.

For a non-Store Codex installation, preserve any paths the installer discovers in the current user's environment. Do not silently invent a path; if the installer asks for `ChatGPT.exe` or `codex.exe`, ask the user to select the real file.

Do not replace the normal Codex shortcut. Do not modify `WindowsApps`, `app.asar`, Codex authentication files, model configuration, or registry startup entries. Do not terminate Codex processes to finish an installation.

## API Provider Configuration

- Never ask the user to paste an API key into chat, a source file, a JSON file, a command argument, or a log.
- Ask the user to copy the complete key to the Windows clipboard, then run the relevant `configure-*.ps1 -FromClipboard` script. Do not inspect or print clipboard contents.
- Provider JSON contains only endpoint and response-field mappings. Validate it with `scripts/validate-provider.mjs` before configuration.
- Persistent keys must use the existing Windows DPAPI flow. Keep `-SessionOnly` available when the user explicitly does not want persistence.
- Do not read `%USERPROFILE%\.codex\auth.json` or `config.toml` for credentials.

## Changes And Verification

- Preserve user changes and `*.local.json` files. Never commit provider secrets or personal paths.
- Keep CDP bound to `127.0.0.1` and retain the policy that an already-running Codex instance is not forcefully restarted.
- After code or configuration-template changes, run `pwsh -NoProfile -File .\tests\run-tests.ps1`.
- After installer or package-manifest changes, also verify `pwsh -NoProfile -File .\install.ps1 -InstallRoot <temporary-directory> -SkipShortcut` and remove only that exact temporary directory afterward.
- Report the installed path, shortcut path, selected mode, tests run, and any action the user still needs to take. Never claim that the monitor is visible until it has actually been launched and verified in a CDP-enabled Codex session.
