param(
	[string]$OutputPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'start-forge.exe')
)

$ErrorActionPreference = 'Stop'
$forgeRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourcePath = Join-Path $PSScriptRoot 'ForgeLauncher.cs'
$iconBuilderPath = Join-Path $PSScriptRoot 'build-launcher-icon.ps1'
$iconPath = Join-Path $forgeRoot 'resources\win32\forge-agent.ico'
$compilerCandidates = @(
	(Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
	(Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $compiler) {
	throw 'The Windows .NET Framework C# compiler was not found.'
}
if (-not (Test-Path -LiteralPath $sourcePath)) {
	throw "Launcher source was not found: $sourcePath"
}
if (-not (Test-Path -LiteralPath $iconBuilderPath)) {
	throw "Launcher icon builder was not found: $iconBuilderPath"
}

& $iconBuilderPath -OutputPath $iconPath

if (-not (Test-Path -LiteralPath $iconPath)) {
	throw "Launcher icon was not found: $iconPath"
}

& $compiler `
	/nologo `
	/target:winexe `
	/platform:anycpu `
	/optimize+ `
	/utf8output `
	/win32icon:$iconPath `
	/reference:System.dll `
	/reference:System.Windows.Forms.dll `
	/out:$OutputPath `
	$sourcePath

if ($LASTEXITCODE -ne 0) {
	throw "Launcher compilation failed with exit code $LASTEXITCODE."
}

$launcher = Get-Item -LiteralPath $OutputPath
Write-Host "Built console-free Forge launcher: $($launcher.FullName) ($($launcher.Length) bytes)"
