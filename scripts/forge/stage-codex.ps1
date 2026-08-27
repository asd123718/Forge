param(
	[ValidateSet('Debug', 'Release')]
	[string]$Configuration = 'Debug'
)

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$codexRoot = Join-Path $projectRoot 'codex\codex-rs'
$vscodeRoot = $projectRoot
$triple = 'x86_64-pc-windows-msvc'
$targetName = 'win32-x64'
$profile = if ($Configuration -eq 'Release') { 'release' } else { 'debug' }
$sourceBinary = Join-Path $codexRoot "target\$profile\codex.exe"
$sdkRoot = Join-Path $vscodeRoot '.build\forge-codex-sdk'
$targetDirectory = Join-Path $sdkRoot "node_modules\@openai\codex-$targetName\vendor\$triple\bin"
$targetBinary = Join-Path $targetDirectory 'codex.exe'

if (-not (Test-Path -LiteralPath $codexRoot -PathType Container)) {
	throw "Codex source was not found at $codexRoot"
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
	throw 'Cargo is required to build the local Codex checkout.'
}

Push-Location $codexRoot
try {
	$arguments = @('build', '-p', 'codex-cli', '--bin', 'codex')
	if ($Configuration -eq 'Release') {
		$arguments += '--release'
	}
	& cargo @arguments
	if ($LASTEXITCODE -ne 0) {
		throw "Codex build failed with exit code $LASTEXITCODE"
	}
} finally {
	Pop-Location
}

if (-not (Test-Path -LiteralPath $sourceBinary -PathType Leaf)) {
	throw "The Codex build completed without producing $sourceBinary"
}

New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceBinary -Destination $targetBinary -Force
Write-Host "Staged local Codex at $targetBinary"
Write-Host "SDK root: $sdkRoot"
