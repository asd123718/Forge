param(
	[switch]$BuildLocalCodex,
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$LaunchArguments
)

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$vscodeRoot = $projectRoot
$runtimeRoot = Join-Path $projectRoot '.build\forge-runtime'
$sdkRoot = Join-Path $projectRoot '.build\forge-codex-sdk'
$stagedBinary = Join-Path $sdkRoot 'node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
$launcher = Join-Path $vscodeRoot 'scripts\code.bat'

if ($BuildLocalCodex) {
	& (Join-Path $PSScriptRoot 'stage-codex.ps1')
	if ($LASTEXITCODE -ne 0) {
		exit $LASTEXITCODE
	}
}
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
	throw "Code - OSS development launcher was not found at $launcher"
}
if (Test-Path -LiteralPath $stagedBinary -PathType Leaf) {
	$env:VSCODE_AGENT_HOST_CODEX_SDK_ROOT = $sdkRoot
}
$env:VSCODE_AGENT_HOST_CODEX_AGENT_ENABLED = 'true'
$env:FORGE_BUILTIN_EXTENSIONS_CONTROL_PATH = Join-Path $projectRoot '.build\builtInExtensions\.control\control.json'
$env:PATH = "$(Join-Path $runtimeRoot 'node');$runtimeRoot;$env:PATH"

Push-Location $vscodeRoot
try {
	& $launcher @LaunchArguments
	if ($LASTEXITCODE -ne 0) {
		exit $LASTEXITCODE
	}
} finally {
	Pop-Location
}
