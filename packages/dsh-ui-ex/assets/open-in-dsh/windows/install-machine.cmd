@echo off
setlocal EnableExtensions
rem ---------------------------------------------------------------------------
rem  One-click installer: registers "Open in DeepSeek Harness" in the Windows
rem  Explorer context menu for every user of this PC (HKLM).
rem
rem  Just double-click this file. Windows shows one administrator prompt:
rem  click Yes. No PowerShell window, no path typing, no arguments.
rem
rem  Optional: run it from an elevated prompt with -AppPath / -IconSource when
rem  DeepSeek Harness is not in a standard location.
rem ---------------------------------------------------------------------------

set "PS1=%~dp0install.ps1"
set "SELF=%~f0"
set "HERE=%~dp0"

if not exist "%PS1%" (
    echo install.ps1 is missing next to this file.
    echo Expected: "%PS1%"
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "exit ([int](-not (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)))"
if errorlevel 1 goto elevate

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Scope Machine
set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" (
    echo Finished. Open a new Explorer window to see the new menu entry.
) else (
    echo Failed with exit code %CODE%.
)
echo.
pause
exit /b %CODE%

:elevate
echo Requesting administrator rights... click Yes in the Windows prompt.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath $env:ComSpec -ArgumentList '/c', ([char]34 + '%SELF%' + [char]34) -Verb RunAs -WorkingDirectory '%HERE%'; exit 0 } catch { Write-Host 'Administrator rights were not granted; nothing was installed.'; exit 1 }"
if errorlevel 1 pause
exit /b 0
