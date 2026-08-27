# Restores .build\VSCode-win32-x64 from an installed Forge app.
# This only restores the Electron shell + old binaries. It does NOT compile your
# current src/. After restoring, run:
#   powershell -ExecutionPolicy Bypass -File scripts\forge\rebuild-from-source.ps1

$ErrorActionPreference = 'Stop'

$forgeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$dest = Join-Path $forgeRoot '.build\VSCode-win32-x64'
$candidates = @(
	'C:\Program Files\Forge AI IDE',
	'C:\Program Files (x86)\Forge AI IDE'
)

$source = $null
foreach ($candidate in $candidates) {
	if (Test-Path -LiteralPath (Join-Path $candidate 'Forge.exe') -PathType Leaf) {
		$source = $candidate
		break
	}
}

if (-not $source) {
	Write-Error @"
No installed Forge app was found.

Install Forge from setup\ForgeSetup-x64-0.1.exe, or run:
  npm ci
  npm run gulp vscode-win32-x64
"@
}

if (Test-Path -LiteralPath $dest) {
	try {
		icacls $dest /reset /T /C | Out-Null
		Remove-Item -LiteralPath $dest -Recurse -Force
	} catch {
		Write-Warning "Could not remove $dest ($($_.Exception.Message)). Copying into a fresh folder instead."
		$dest = Join-Path $forgeRoot ('.build\VSCode-win32-x64-restored-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
	}
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
robocopy $source $dest /E /R:2 /W:2 /XD unins000.dat | Out-Null
if ($LASTEXITCODE -ge 8) {
	Write-Error "robocopy failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath (Join-Path $dest 'Forge.exe') -PathType Leaf)) {
	Write-Error "Restore finished but Forge.exe is still missing at $dest"
}

if ($dest -ne (Join-Path $forgeRoot '.build\VSCode-win32-x64')) {
	Write-Host "Restored to $dest"
	Write-Host "Update start-forge to point at this folder, or move it to .build\VSCode-win32-x64 manually."
} else {
	Write-Host "Restored packaged Forge to $dest"
}
