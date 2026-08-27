# Nightly packaging and clean-machine smoke

This is the last M1 packaging path that can be repeated without a signing
service or update feed. Unsigned installers may show SmartScreen; that is
expected, not a surprise.

## Nightly Windows x64 package

From the Forge repository root, on Windows x64, with Node.js **24.18.x**:

```bat
set BUILD_SOURCEVERSION=c125b2a2432ff78b2d1f7b8ed8b0c67cf3af6187
npm ci
npm run gulp vscode-win32-x64
npm run gulp vscode-win32-x64-inno-updater
npm run gulp vscode-win32-x64-system-setup
```

Outputs:

- Unpacked app: `.build\VSCode-win32-x64` (`Forge.exe` plus staged Codex natives)
- Default installer: `.build\win32-x64\system-setup\VSCodeSetup.exe`

Do not sign. Do not publish an update feed. Copy these files next to the
installer payload (gulp already includes `LICENSE.txt` and
`ThirdPartyNotices.txt`; include the others when present):

- `LICENSE.txt` (Code-OSS MIT)
- `LICENSE` (Forge Apache-2.0, when present)
- `LICENSING.md`
- `codex/NOTICE`
- `ThirdPartyNotices.txt`

## Clean Windows checklist

Machine: Windows 10/11 x64. No Node.js, no Git, no Forge source tree.

1. Copy the unsigned installer onto the machine.
2. Run it. If SmartScreen appears, use **More info → Run anyway**. This is an
   unsigned nightly, not a broken install.
3. Launch Forge from the Start Menu or install directory.
4. Confirm the workbench window opens (editors, explorer, settings).
5. Open Settings and search for Codex / Agent Host. The Codex provider should
   be the default chat agent. There must be no Copilot signup as the default.
6. If ChatGPT login is already available on that account, start a Codex chat
   and confirm app-server comes up. If signed out, the sign-in path should open
   without a Copilot entitlement request.
7. Open Help → About / License and confirm the issue URL is
   `github.com/asd123718/Forge`, not microsoft/vscode.

Live Edit and `write_file` Windows bugs show up on this path. That is the point
of the smoke, not another Agent feature.

## What this does not claim

- Code signing / Authenticode
- Auto-update
- macOS / Linux installers
- A green full VS Code GitHub Actions matrix
