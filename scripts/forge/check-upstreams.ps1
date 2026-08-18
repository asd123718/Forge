$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$vscodeRoot = $projectRoot
$codexRoot = Join-Path $projectRoot 'codex'
$requiredPaths = @(
	(Join-Path $vscodeRoot 'src\vs\platform\agentHost\node\codex\codexAgent.ts'),
	(Join-Path $vscodeRoot 'src\vs\platform\agentHost\node\codex\protocol\generated\README.md'),
	(Join-Path $vscodeRoot 'src\vs\sessions'),
	(Join-Path $codexRoot 'codex-rs\app-server'),
	(Join-Path $codexRoot 'codex-rs\app-server-protocol'),
	(Join-Path $codexRoot 'codex-rs\core')
)

foreach ($requiredPath in $requiredPaths) {
	if (-not (Test-Path -LiteralPath $requiredPath)) {
		throw "Required upstream seam is missing: $requiredPath"
	}
}

$packageJson = Get-Content -LiteralPath (Join-Path $vscodeRoot 'package.json') -Raw | ConvertFrom-Json
$codexVersion = $packageJson.devDependencies.'@openai/codex'
$protocolVersion = (Get-Content -LiteralPath (Join-Path $vscodeRoot 'build\codex\codex-version.txt') -Raw).Trim()
if ($protocolVersion -ne $codexVersion) {
	throw "Generated protocol provenance does not match the @openai/codex pin ($codexVersion)."
}

Write-Host "Upstream seams and Codex protocol pin ($codexVersion) are consistent."
