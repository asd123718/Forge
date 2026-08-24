# `product.json` audit

Forge is a Code-OSS fork with a Codex-only agent. This table is the service
boundary for `product.json`: keep Code-OSS defaults that the workbench still
needs, replace user-visible Microsoft product identity, and disable silent
reporting until Forge hosts its own endpoints.

| Field | Decision | Reason |
| --- | --- | --- |
| `nameShort` / `nameLong` / `applicationName` / `urlProtocol` / Windows IDs | Retain | Already rebranded to Forge. |
| `licenseName` | Replace | `Apache-2.0 AND MIT`. The tree is not a single MIT work. |
| `licenseUrl` / `serverLicenseUrl` | Replace | Point at this repository's `LICENSE.txt` (Code-OSS MIT), not microsoft/vscode. See `LICENSING.md`. |
| `licenseFileName` | Retain | Inno/gulp still pack `LICENSE.txt`. Nightly also copies `codex/NOTICE` and `ThirdPartyNotices.txt`. |
| `reportIssueUrl` | Replace | `https://github.com/asd123718/Forge/issues/new`. |
| `defaultChatAgent` | Disable | Removed. Forge's default agent is Codex via Agent Host. Leaving Copilot entitlement URLs would still call GitHub Copilot APIs. |
| `builtInExtensionsEnabledWithAutoUpdates` | Disable | Emptied. Copilot Chat is not a default Forge agent. |
| `builtInExtensions` `ms-vscode.js-debug*` | Retain | Debugger capability, not Copilot. |
| `webviewContentExternalBaseUrlTemplate` | Retain | Workbench hard-depends on this template (`environmentService.ts`). Blind delete breaks webviews. Self-host later. |
| `enableTelemetry` | Disable | `false`. No Forge telemetry service yet; do not silently report to Microsoft. |
| `voiceWsUrl` | Disable | Cleared. Microsoft voice endpoint is not a Forge service. |
| `crashReporter` / update feed / `nodejsArtifactFeed` / `electronArtifactFeed` | Disable / absent | No self-hosted crash or update service. Feeds are already empty. |
| `trustedExtensionAuthAccess` for `GitHub.copilot-chat` | Retain | Only matters if a user installs Copilot themselves. Not a default entry. |
| `onboardingKeymaps` / `onboardingThemes` | Retain | Editor onboarding, not Copilot. |

Regenerate this table when adding product endpoints. Do not reintroduce Copilot
as `defaultChatAgent`.
