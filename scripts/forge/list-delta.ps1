$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$listPath = Join-Path $PSScriptRoot 'forge-delta-files.txt'
if (-not (Test-Path -LiteralPath $listPath)) {
	throw "Forge delta list is missing: $listPath"
}

$missing = @()
$present = @()
Get-Content -LiteralPath $listPath | ForEach-Object {
	$line = $_.Trim()
	if (-not $line -or $line.StartsWith('#')) {
		return
	}
	$full = Join-Path $projectRoot ($line -replace '/', [IO.Path]::DirectorySeparatorChar)
	if (Test-Path -LiteralPath $full) {
		$present += $line
	} else {
		$missing += $line
	}
}

Write-Host "Forge delta inventory: $($present.Count) present, $($missing.Count) missing."
if ($missing.Count -gt 0) {
	$missing | ForEach-Object { Write-Host "MISSING $_" }
	throw "Forge delta inventory has missing paths."
}
$present | ForEach-Object { Write-Host "OK $_" }
