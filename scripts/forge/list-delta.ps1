$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$listPath = Join-Path $PSScriptRoot 'forge-delta-files.txt'
if (-not (Test-Path -LiteralPath $listPath)) {
	throw "Forge delta list is missing: $listPath"
}

$missing = @()
$present = @()
$listed = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
Get-Content -LiteralPath $listPath | ForEach-Object {
	$line = $_.Trim()
	if (-not $line -or $line.StartsWith('#')) {
		return
	}
	$null = $listed.Add(($line -replace '\\', '/'))
	$full = Join-Path $projectRoot ($line -replace '/', [IO.Path]::DirectorySeparatorChar)
	if (Test-Path -LiteralPath $full) {
		$present += $line
	} else {
		$missing += $line
	}
}

# These are Forge-owned families rather than upstream files with a small patch.
# Every file in them must be inventoried so a future upstream replay cannot
# silently omit a newly added feature, test, launcher, or branded resource.
$ownedPatterns = @(
	'scripts/forge/*',
	'extensions/forge-language-pack-zh-hans/*',
	'src/vs/workbench/contrib/forge/*',
	'src/vs/platform/agentHost/common/forge*.ts',
	'src/vs/platform/agentHost/common/officialModelCards.ts',
	'src/vs/platform/agentHost/node/orchestration/*',
	'src/vs/platform/agentHost/test/*/orchestration/*',
	'src/vs/workbench/services/agentHost/*/forgeVendorAccountService.ts',
	'resources/win32/forge-*',
	'build/agent-sdk/agents/codex/package*.json'
)
$unlisted = @()

$trackedFiles = @(& git -C $projectRoot ls-files)
foreach ($relative in $trackedFiles) {
	foreach ($pattern in $ownedPatterns) {
		if ($relative -like $pattern -and -not $listed.Contains($relative)) {
			$unlisted += $relative
			break
		}
	}
}
$unlisted = @($unlisted | Sort-Object -Unique)

Write-Host "Forge delta inventory: $($present.Count) present, $($missing.Count) missing."
if ($missing.Count -gt 0) {
	$missing | ForEach-Object { Write-Host "MISSING $_" }
	throw "Forge delta inventory has missing paths."
}
if ($unlisted.Count -gt 0) {
	$unlisted | ForEach-Object { Write-Host "UNLISTED $_" }
	throw "Forge-owned files are missing from the delta inventory."
}
$present | ForEach-Object { Write-Host "OK $_" }
