# Rebuild the packaged runtime under .build\VSCode-win32-x64 from current src/.
# Keeps the Electron shell; replaces workbench, agent host, and related bundles.
param(
	[switch]$RestoreShell
)

$ErrorActionPreference = 'Stop'
$forgeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$shellExe = Join-Path $forgeRoot '.build\VSCode-win32-x64\Forge.exe'

Push-Location $forgeRoot
try {
	if ($RestoreShell -or -not (Test-Path -LiteralPath $shellExe)) {
		Write-Host 'Packaged shell missing; restoring Electron runtime from installed Forge...'
		& (Join-Path $PSScriptRoot 'restore-packaged.ps1')
	}

	Write-Host 'Copying codicons...'
	$env:NODE_OPTIONS = '--max-old-space-size=8192'
	npm run gulp copy-codicons | Out-Null

	Write-Host 'Bundling current source (this takes about a minute)...'
	node --experimental-strip-types build/next/index.ts bundle --minify --nls --out .build/forge-bundle

	Write-Host 'Deploying into .build\VSCode-win32-x64...'
	& (Join-Path $PSScriptRoot 'deploy-bundle.ps1')

	Write-Host ''
	Write-Host 'Done. Fully quit Forge, then run start-forge.exe.'
} finally {
	Pop-Location
}
