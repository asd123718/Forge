param(
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$LaunchArguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:launcherLog = $null
$script:launchMutex = $null
$script:ownsLaunchMutex = $false

function Add-LauncherLog {
	param([string]$Message)

	if ($script:launcherLog) {
		$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff zzz'
		Add-Content -LiteralPath $script:launcherLog -Value "[$timestamp] $Message" -Encoding utf8
	}
}

function Show-LaunchFailure {
	param([string]$Message)

	try {
		Add-Type -AssemblyName System.Windows.Forms
		[System.Windows.Forms.MessageBox]::Show(
			$Message,
			'Forge failed to start',
			[System.Windows.Forms.MessageBoxButtons]::OK,
			[System.Windows.Forms.MessageBoxIcon]::Error
		) | Out-Null
	} catch {
		# The diagnostic files remain authoritative if the desktop cannot show a dialog.
	}
}

function New-ForgeSessionName {
	$now = Get-Date
	$offset = [System.TimeZoneInfo]::Local.GetUtcOffset($now)
	$sign = if ($offset.TotalMinutes -ge 0) { '+' } else { '-' }
	$absoluteMinutes = [Math]::Abs([int]$offset.TotalMinutes)
	$offsetName = '{0}{1:00}-{2:00}' -f $sign, [Math]::Floor($absoluteMinutes / 60), ($absoluteMinutes % 60)
	$zoneName = ([System.TimeZoneInfo]::Local.Id -replace '[^a-zA-Z0-9._-]+', '-')
	$run = [Guid]::NewGuid().ToString('N').Substring(0, 7)
	return '{0}_UTC{1}_{2}_run-{3}' -f $now.ToString('yyyy-MM-dd_HH-mm-ss.fff'), $offsetName, $zoneName, $run
}

try {
	$forgeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
	$logsRoot = Join-Path $forgeRoot 'logs'
	New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
	$hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
	try {
		$rootHash = $hashAlgorithm.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($forgeRoot.ToLowerInvariant()))
	} finally {
		$hashAlgorithm.Dispose()
	}
	$mutexSuffix = -join ($rootHash[0..7] | ForEach-Object { $_.ToString('x2') })
	$script:launchMutex = [System.Threading.Mutex]::new($false, "Local\Forge.SourceLauncher.$mutexSuffix")
	try {
		$script:ownsLaunchMutex = $script:launchMutex.WaitOne(0)
	} catch [System.Threading.AbandonedMutexException] {
		$script:ownsLaunchMutex = $true
	}
	if (-not $script:ownsLaunchMutex) {
		# A hidden source launcher is already compiling or opening Forge.
		exit 0
	}
	$sessionDirectory = Join-Path $logsRoot (New-ForgeSessionName)
	New-Item -ItemType Directory -Path $sessionDirectory -Force | Out-Null
	$script:launcherLog = Join-Path $sessionDirectory '00-launcher.txt'
	Set-Content -LiteralPath $script:launcherLog -Value '# FORGE SOURCE LAUNCHER' -Encoding utf8

	$node = Join-Path $forgeRoot 'resources\forge-runtime\win32-x64\node.exe'
	$nativeOverlay = Join-Path $forgeRoot 'resources\forge-runtime\win32-x64\native-overlay'
	$nodeModules = Join-Path $forgeRoot 'node_modules'
	$electron = Join-Path $forgeRoot '.build\electron\Forge.exe'
	$gulp = Join-Path $nodeModules 'gulp\bin\gulp.js'
	$codex = Join-Path $nodeModules '@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'

	foreach ($required in @($node, $nativeOverlay, $nodeModules, $electron, $gulp, $codex)) {
		if (-not (Test-Path -LiteralPath $required)) {
			throw "Required embedded runtime is missing: $required"
		}
	}

	Add-LauncherLog "root=$forgeRoot"
	Add-LauncherLog "session=$sessionDirectory"
	Add-LauncherLog "node=$node"
	Add-LauncherLog "electron=$electron"

	# Restore the checked-in Electron ABI bindings into the ignored dependency tree.
	# This is an offline overlay: no npm install, download, or native compilation occurs.
	Get-ChildItem -LiteralPath $nativeOverlay -Recurse -File | ForEach-Object {
		$relative = $_.FullName.Substring($nativeOverlay.Length).TrimStart('\')
		$destination = Join-Path $nodeModules $relative
		New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
		Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
	}
	Add-LauncherLog 'native-overlay=restored'

	$codexHome = Join-Path $env:USERPROFILE '.forge\codex'
	New-Item -ItemType Directory -Path $codexHome -Force | Out-Null
	$officialCodexHome = Join-Path $env:USERPROFILE '.codex'
	foreach ($name in @('auth.json', 'config.toml')) {
		$destination = Join-Path $codexHome $name
		$source = Join-Path $officialCodexHome $name
		if (-not (Test-Path -LiteralPath $destination) -and (Test-Path -LiteralPath $source)) {
			Copy-Item -LiteralPath $source -Destination $destination
		}
	}

	$env:CODEX_HOME = $codexHome
	$env:FORGE_LOGS_ROOT = $logsRoot
	$env:VSCODE_AGENT_HOST_CODEX_AGENT_ENABLED = 'true'
	$env:NODE_ENV = 'development'
	$env:VSCODE_DEV = '1'
	$env:VSCODE_CLI = '1'
	$env:ELECTRON_ENABLE_LOGGING = '1'
	$env:ELECTRON_ENABLE_STACK_DUMPING = '1'
	Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

	$compileStdout = Join-Path $sessionDirectory '01-compile.stdout.txt'
	$compileStderr = Join-Path $sessionDirectory '02-compile.stderr.txt'
	$buildStamp = Join-Path $forgeRoot 'out\.forge-source-build-stamp'
	$requiredOutputs = @(
		(Join-Path $forgeRoot 'out\main.js'),
		(Join-Path $forgeRoot 'out\vs\code\electron-main\main.js'),
		(Join-Path $forgeRoot 'out\vs\workbench\workbench.desktop.main.js')
	)
	$compileRequired = -not (Test-Path -LiteralPath $buildStamp)
	if (-not $compileRequired) {
		$compileRequired = $null -ne ($requiredOutputs | Where-Object { -not (Test-Path -LiteralPath $_) } | Select-Object -First 1)
	}
	if (-not $compileRequired) {
		$stampTime = (Get-Item -LiteralPath $buildStamp).LastWriteTimeUtc
		$sourceRoot = Join-Path $forgeRoot 'src'
		$compileRequired = $null -ne (Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | Where-Object { $_.LastWriteTimeUtc -gt $stampTime } | Select-Object -First 1)
	}

	if ($compileRequired) {
		$compileArguments = @('--max-old-space-size=8192', ('"{0}"' -f $gulp), 'compile')
		Add-LauncherLog 'compile=status:started task:gulp-compile'
		$compiler = Start-Process -FilePath $node -ArgumentList $compileArguments -WorkingDirectory $forgeRoot -NoNewWindow -RedirectStandardOutput $compileStdout -RedirectStandardError $compileStderr -Wait -PassThru
		Add-LauncherLog "compile=status:completed exitCode=$($compiler.ExitCode)"
		if ($compiler.ExitCode -ne 0) {
			throw "Source compilation failed with exit code $($compiler.ExitCode). See $compileStderr"
		}
		Set-Content -LiteralPath $buildStamp -Value ([DateTime]::UtcNow.ToString('O')) -Encoding ascii
	} else {
		Set-Content -LiteralPath $compileStdout -Value '# Forge source output is current; compilation skipped.' -Encoding utf8
		Set-Content -LiteralPath $compileStderr -Value '' -Encoding utf8
		Add-LauncherLog 'compile=status:skipped reason:source-output-current'
	}

	$guiStdout = Join-Path $sessionDirectory '03-gui.stdout.txt'
	$guiStderr = Join-Path $sessionDirectory '04-gui.stderr.txt'
	$extraArguments = if ($null -eq $LaunchArguments) { @() } else { @($LaunchArguments | Where-Object { $null -ne $_ }) }
	$guiArguments = @('.', '--disable-extension=vscode.vscode-api-tests', '--logsPath', ('"{0}"' -f $sessionDirectory)) + $extraArguments
	Add-LauncherLog 'gui=status:starting'
	$gui = Start-Process -FilePath $electron -ArgumentList $guiArguments -WorkingDirectory $forgeRoot -RedirectStandardOutput $guiStdout -RedirectStandardError $guiStderr -PassThru
	Start-Sleep -Milliseconds 1800
	if ($gui.HasExited) {
		Add-LauncherLog "gui=status:exited exitCode=$($gui.ExitCode)"
		if ($gui.ExitCode -ne 0) {
			throw "Forge GUI exited with code $($gui.ExitCode). See $guiStderr"
		}
	} else {
		Add-LauncherLog "gui=status:running pid=$($gui.Id)"
	}
} catch {
	$message = $_.Exception.Message
	Add-LauncherLog "error=$message"
	$details = if ($script:launcherLog) { "`n`nDetailed log:`n$script:launcherLog" } else { '' }
	Show-LaunchFailure "$message$details"
	exit 1
} finally {
	if ($script:launchMutex) {
		if ($script:ownsLaunchMutex) {
			try { $script:launchMutex.ReleaseMutex() } catch { }
		}
		$script:launchMutex.Dispose()
	}
}
