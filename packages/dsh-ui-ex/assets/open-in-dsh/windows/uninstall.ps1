<#
.SYNOPSIS
    Removes the "在 DeepSeek Harness 中打开" Explorer context-menu entry.

.DESCRIPTION
    Deletes the verbs registered by install.ps1 and the installed launcher
    directory for the same scope. The DeepSeek Harness app and its profile are
    untouched. The one-time auto-install record is removed as well, so installing
    the menu again is offered by the plugin on the next launch.

.PARAMETER Scope
    User (default, HKCU) or Machine (HKLM, administrator).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Scope Machine
#>
[CmdletBinding()]
param(
    [ValidateSet('User', 'Machine')]
    [string]$Scope = 'User'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$machine = $Scope -eq 'Machine'
if ($machine) {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw '机器范围卸载需要管理员权限：请以管理员身份运行 PowerShell。'
    }
    $installDir = Join-Path $env:ProgramData 'DeepSeekHarness\shell-integration'
    $registryRoot = 'HKLM:\Software\Classes'
    $keys = @(
        "$registryRoot\Directory\shell\DeepSeekHarness",
        "$registryRoot\Directory\Background\shell\DeepSeekHarness",
        "$registryRoot\Drive\shell\DeepSeekHarness"
    )
}
else {
    $installDir = Join-Path $env:LOCALAPPDATA 'DeepSeekHarness\shell-integration'
    $keys = @(
        'HKCU:\Software\Classes\Directory\shell\DeepSeekHarness',
        'HKCU:\Software\Classes\Directory\Background\shell\DeepSeekHarness',
        'HKCU:\Software\Classes\Drive\shell\DeepSeekHarness'
    )
}

foreach ($key in $keys) {
    if (Test-Path -LiteralPath $key) {
        Remove-Item -LiteralPath $key -Recurse -Force
        Write-Host "  removed $key"
    }
}

if (Test-Path -LiteralPath $installDir) {
    Remove-Item -LiteralPath $installDir -Recurse -Force
    Write-Host "  removed $installDir"
}

$queueDir = Join-Path $env:LOCALAPPDATA 'DeepSeekHarness\dsh-open'
if (Test-Path -LiteralPath $queueDir) {
    Remove-Item -LiteralPath $queueDir -Recurse -Force
    Write-Host "  removed $queueDir"
}

$marker = Join-Path $env:LOCALAPPDATA 'DeepSeekHarness\shell-integration\auto-install.json'
if (Test-Path -LiteralPath $marker) {
    Remove-Item -LiteralPath $marker -Force
    Write-Host "  removed $marker"
}

Write-Host ''
Write-Host "已卸载 $Scope 范围右键菜单。DSH 插件 dsh-ui-ex 仍在 profile 中，可在「插件」页禁用或移除。"
