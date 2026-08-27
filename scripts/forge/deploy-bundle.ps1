# Deploy .build/forge-bundle into the packaged app and refresh product.json checksums.
param(
	[string]$BundleDir = (Join-Path $PSScriptRoot '..\..\.build\forge-bundle'),
	[string]$PackageRoot = (Join-Path $PSScriptRoot '..\..\.build\VSCode-win32-x64\resources\app'),
	[string]$BundleName = 'forge-bundle'
)

$ErrorActionPreference = 'Stop'
$forgeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))

if (-not $BundleDir) {
	$BundleDir = Join-Path $forgeRoot ".build\$BundleName"
}
if (-not $PackageRoot) {
	$PackageRoot = Join-Path $forgeRoot '.build\VSCode-win32-x64\resources\app'
}

$outDir = Join-Path $PackageRoot 'out'
$productJson = Join-Path $PackageRoot 'product.json'

if (-not (Test-Path -LiteralPath (Join-Path $BundleDir 'vs\workbench\workbench.desktop.main.js'))) {
	throw "Bundle not found. Run: node --experimental-strip-types build/next/index.ts bundle --minify --nls --out .build/$BundleName"
}
if (-not (Test-Path -LiteralPath $outDir)) {
	throw "Packaged app output folder not found: $outDir"
}

robocopy $BundleDir $outDir /E /XO /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) {
	throw "robocopy failed with exit code $LASTEXITCODE"
}

node --input-type=module -e @"
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

const packageRoot = process.argv[1];
const productPath = path.join(packageRoot, 'product.json');
const outDir = path.join(packageRoot, 'out');
const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
const checksums = product.checksums ?? {};

function hashFile(rel) {
	const full = path.join(outDir, rel.replaceAll('/', path.sep));
	const data = fs.readFileSync(full);
	return crypto.createHash('sha256').update(data).digest('base64').replace(/=+$/, '');
}

for (const key of Object.keys(checksums)) {
	checksums[key] = hashFile(key);
}
product.checksums = checksums;
fs.writeFileSync(productPath, JSON.stringify(product, null, '\t') + '\n');
console.log('Updated checksums for', Object.keys(checksums).length, 'files');
"@ $PackageRoot

Write-Host "Deployed bundle to $outDir"
