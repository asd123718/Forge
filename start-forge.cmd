@echo off
setlocal
set "FORGE_ROOT=%~dp0"
set "PACKAGED=%~dp0.build\VSCode-win32-x64\Forge.exe"

if exist "%FORGE_ROOT%start-forge.exe" (
	start "" "%FORGE_ROOT%start-forge.exe" %*
	exit /b 0
)
if exist "%PACKAGED%" (
	start "" "%PACKAGED%" %*
	exit /b 0
)
if exist "%FORGE_ROOT%start-forge.vbs" (
	start "" "%SystemRoot%\System32\wscript.exe" //nologo "%FORGE_ROOT%start-forge.vbs" %*
	exit /b 0
)

echo Forge is not ready to start from this source tree.
echo Missing: start-forge.exe and .build\VSCode-win32-x64\Forge.exe
echo.
echo If you installed Forge before, restore the packaged runtime with:
echo   powershell -ExecutionPolicy Bypass -File scripts\forge\restore-packaged.ps1
echo.
echo Or build it with: npm ci ^&^& npm run gulp vscode-win32-x64
exit /b 1
