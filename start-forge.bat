@echo off
setlocal EnableExtensions

set "FORGE_ROOT=%~dp0"
set "FORGE_START_SCRIPT=%FORGE_ROOT%scripts\forge\start-source.ps1"

if not exist "%FORGE_START_SCRIPT%" (
	echo Forge source launcher is missing:
	echo   %FORGE_START_SCRIPT%
	pause
	exit /b 1
)

rem Keep BAT as the only user-facing launcher. PowerShell is hidden immediately and
rem records compilation/startup failures in forge\logs instead of spawning consoles.
start "" /b powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%FORGE_START_SCRIPT%" %*
if errorlevel 1 (
	echo Forge could not start its source launcher.
	pause
	exit /b 1
)

endlocal
exit /b 0
