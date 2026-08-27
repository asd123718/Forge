param(
	[string]$UpstreamDir
)

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$listPath = Join-Path $PSScriptRoot 'forge-delta-files.txt'
$packageJsonText = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw
if ($packageJsonText -notmatch '"distro"\s*:\s*"([0-9a-f]+)"') {
	throw 'package.json does not contain a distro hash.'
}
$distro = $Matches[1]
if ($packageJsonText -notmatch '"version"\s*:\s*"([^"]+)"') {
	throw 'package.json does not contain a version.'
}
$version = $Matches[1]

if (-not $UpstreamDir) {
	$candidates = @(
		(Join-Path $projectRoot '..\vscode-main'),
		(Join-Path $projectRoot '.build\upstream-code-oss')
	)
	$UpstreamDir = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

Write-Host "Forge three-way compare"
Write-Host "  ours:     $projectRoot"
Write-Host "  distro:   $distro"
Write-Host "  version:  $version"
if (-not $UpstreamDir) {
	Write-Host "  upstream: (not found)"
	Write-Host "Pass -UpstreamDir to a microsoft/vscode checkout at distro $distro."
	Write-Host "This script never rebases or rewrites git history."
	exit 0
}

$UpstreamDir = [System.IO.Path]::GetFullPath($UpstreamDir)
Write-Host "  upstream: $UpstreamDir"

$forgeOnly = @()
$changed = @()
$identical = @()
$missingOurs = @()

Get-Content -LiteralPath $listPath | ForEach-Object {
	$line = $_.Trim()
	if (-not $line -or $line.StartsWith('#')) {
		return
	}
	$ours = Join-Path $projectRoot ($line -replace '/', [IO.Path]::DirectorySeparatorChar)
	$upstream = Join-Path $UpstreamDir ($line -replace '/', [IO.Path]::DirectorySeparatorChar)
	if (-not (Test-Path -LiteralPath $ours)) {
		$missingOurs += $line
		return
	}
	if (-not (Test-Path -LiteralPath $upstream)) {
		$forgeOnly += $line
		return
	}
	$oursHash = (Get-FileHash -LiteralPath $ours -Algorithm SHA256).Hash
	$upstreamHash = (Get-FileHash -LiteralPath $upstream -Algorithm SHA256).Hash
	if ($oursHash -eq $upstreamHash) {
		$identical += $line
	} else {
		$changed += $line
	}
}

Write-Host ""
Write-Host "FORGE_ONLY ($($forgeOnly.Count))"
$forgeOnly | ForEach-Object { Write-Host "  $_" }
Write-Host "FORGE_CHANGED ($($changed.Count))"
$changed | ForEach-Object { Write-Host "  $_" }
Write-Host "IDENTICAL_TO_UPSTREAM ($($identical.Count))"
$identical | ForEach-Object { Write-Host "  $_" }

if ($missingOurs.Count -gt 0) {
	Write-Host "MISSING_OURS ($($missingOurs.Count))"
	$missingOurs | ForEach-Object { Write-Host "  $_" }
	throw "Forge delta inventory has missing local paths."
}

Write-Host ""
Write-Host "Replay is mechanical: copy FORGE_ONLY files, three-way merge FORGE_CHANGED files, leave IDENTICAL files to upstream."
Write-Host "Do not git rebase main onto Code-OSS history."
