<#
.SYNOPSIS
    Adds a "在 DeepSeek Harness 中打开" entry to the Windows Explorer context menu.

.DESCRIPTION
    -Scope User    (default) per-user install: HKCU\Software\Classes, no admin.
    -Scope Machine machine-wide install: HKLM\Software\Classes, needs an elevated shell.

    Both scopes compile the windowless launcher dsh-open.exe and render dsh.ico from
    the DeepSeek Harness artwork. The verb writes the chosen folder into
    %LOCALAPPDATA%\DeepSeekHarness\dsh-open and starts (or re-focuses) DeepSeek
    Harness; the open-in-dsh plugin turns that request into an open Workspace.

    Windows 11 26H2 shows only machine-wide legacy verbs in its new context menu,
    so -Scope Machine is the reliable scope there unless the classic menu is back.

.PARAMETER Scope
    User (default, HKCU) or Machine (HKLM, administrator).

.PARAMETER AppPath
    DeepSeek Harness executable. Detected from the uninstall entry or the usual
    install directories when omitted.

.PARAMETER IconSource
    PNG file to render the menu icon from. Defaults to the app's own icon.png;
    pass an explicit PNG when the app artwork is not beside the executable.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Scope Machine
#>
[CmdletBinding()]
param(
    [ValidateSet('User', 'Machine')]
    [string]$Scope = 'User',
    [string]$AppPath = '',
    [string]$IconSource = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Write-Step([string]$Text) { Write-Host "  $Text" }

function Get-PropertyValue($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Find-AppPath {
    $candidates = New-Object 'System.Collections.Generic.List[string]'
    if ($env:DSH_DESKTOP_APP_PATH) { $candidates.Add($env:DSH_DESKTOP_APP_PATH) }
    $uninstallRoots = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $uninstallRoots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($entry in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
            $item = Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction SilentlyContinue
            $displayName = Get-PropertyValue $item 'DisplayName'
            if ($displayName -ne 'DeepSeek Harness') { continue }
            $location = Get-PropertyValue $item 'InstallLocation'
            if ($location) { $candidates.Add((Join-Path $location 'DeepSeek Harness.exe')) }
            $displayIcon = Get-PropertyValue $item 'DisplayIcon'
            if ($displayIcon) { $candidates.Add((($displayIcon -split ',')[0]).Trim().Trim('"')) }
        }
    }
    $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'))
    $candidates.Add((Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe'))
    if (${env:ProgramFiles(x86)}) { $candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'DeepSeek Harness\DeepSeek Harness.exe')) }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

$machine = $Scope -eq 'Machine'
if ($machine) {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw '机器范围安装需要管理员权限：请以管理员身份运行 PowerShell，或直接双击 install-machine.cmd。'
    }
    $installDir = Join-Path $env:ProgramData 'DeepSeekHarness\shell-integration'
    $registryRoot = 'HKLM:\Software\Classes'
}
else {
    $installDir = Join-Path $env:LOCALAPPDATA 'DeepSeekHarness\shell-integration'
    $registryRoot = 'HKCU:\Software\Classes'
}

# Per-user hand-off queue: the plugin reads the queue of the user running the app.
$queueDir = Join-Path $env:LOCALAPPDATA 'DeepSeekHarness\dsh-open'
$iconFile = Join-Path $installDir 'dsh.ico'
$exeFile = Join-Path $installDir 'dsh-open.exe'

if ([string]::IsNullOrWhiteSpace($AppPath)) {
    $AppPath = Find-AppPath
    if (-not $AppPath) {
        throw 'DeepSeek Harness executable not found. Pass -AppPath "<path to DeepSeek Harness.exe>".'
    }
}
if (-not (Test-Path -LiteralPath $AppPath -PathType Leaf)) {
    throw "DeepSeek Harness executable not found: $AppPath (pass -AppPath <path>)"
}
$AppPath = (Resolve-Path -LiteralPath $AppPath).Path

if ([string]::IsNullOrWhiteSpace($IconSource)) {
    # The suite ships a vector icon, so the only raster artwork nearby is the
    # app's own copy; an explicit -IconSource still wins for unusual layouts.
    $appIcon = Join-Path (Split-Path -Parent $AppPath) 'resources\icon.png'
    if (Test-Path -LiteralPath $appIcon -PathType Leaf) { $IconSource = $appIcon }
    else { throw "Icon artwork not found: $appIcon (pass -IconSource <png path>)" }
}

$sourceFile = Join-Path $PSScriptRoot 'dsh-open.cs'
if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    throw "Launcher source not found: $sourceFile"
}

New-Item -ItemType Directory -Force -Path $installDir, $queueDir | Out-Null

Write-Host "Installing ($Scope scope) ..."
Write-Host 'Rendering menu icon ...'
Add-Type -AssemblyName System.Drawing

# One DIB (uncompressed BMP) icon frame: 32-bit pixels plus the 1-bit AND mask.
# DIB frames are the format GDI+ and the shell read without image-codec help.
function New-IcoFrame {
    param([System.Drawing.Image]$Source, [int]$Size)

    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.DrawImage($Source, 0, 0, $Size, $Size)
        }
        finally { $graphics.Dispose() }

        $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
        $locked = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $stride = $locked.Stride
            $pixels = New-Object byte[] ($stride * $Size)
            [System.Runtime.InteropServices.Marshal]::Copy($locked.Scan0, $pixels, 0, $pixels.Length)
        }
        finally { $bitmap.UnlockBits($locked) }

        $maskStride = [int]([Math]::Floor(($Size + 31) / 32) * 4)
        $mask = New-Object byte[] ($maskStride * $Size)
        if ($Size -le 64) {
            for ($y = 0; $y -lt $Size; $y++) {
                for ($x = 0; $x -lt $Size; $x++) {
                    if ($pixels[($y * $stride) + ($x * 4) + 3] -lt 128) {
                        $mask[($y * $maskStride) + [int][Math]::Floor($x / 8)] = $mask[($y * $maskStride) + [int][Math]::Floor($x / 8)] -bor (1 -shl (7 - ($x % 8)))
                    }
                }
            }
        }

        $body = New-Object System.IO.MemoryStream
        $writer = New-Object System.IO.BinaryWriter($body)
        try {
            $writer.Write([UInt32]40)
            $writer.Write([Int32]$Size)
            $writer.Write([Int32]($Size * 2))
            $writer.Write([UInt16]1)
            $writer.Write([UInt16]32)
            $writer.Write([UInt32]0)
            $writer.Write([UInt32]($Size * $Size * 4))
            $writer.Write([Int32]0)
            $writer.Write([Int32]0)
            $writer.Write([UInt32]0)
            $writer.Write([UInt32]0)
            for ($y = $Size - 1; $y -ge 0; $y--) { $writer.Write($pixels, ($y * $stride), ($Size * 4)) }
            $writer.Write($mask)
            $writer.Flush()
            return , $body.ToArray()
        }
        finally {
            $writer.Dispose()
            $body.Dispose()
        }
    }
    finally { $bitmap.Dispose() }
}

function New-IcoFile {
    param([string]$SourcePng, [string]$Destination)

    $source = [System.Drawing.Image]::FromFile($SourcePng)
    try {
        $sizes = @(16, 24, 32, 48, 64, 128, 256)
        $frames = New-Object 'System.Collections.Generic.List[byte[]]'
        foreach ($size in $sizes) {
            $frame = New-IcoFrame -Source $source -Size $size
            $frames.Add([byte[]]$frame)
        }

        $buffer = New-Object System.IO.MemoryStream
        $writer = New-Object System.IO.BinaryWriter($buffer)
        try {
            $writer.Write([UInt16]0)
            $writer.Write([UInt16]1)
            $writer.Write([UInt16]$sizes.Count)
            $offset = 6 + 16 * $sizes.Count
            for ($i = 0; $i -lt $sizes.Count; $i++) {
                [byte[]]$bytes = $frames[$i]
                $dimension = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
                $writer.Write([byte]$dimension)
                $writer.Write([byte]$dimension)
                $writer.Write([byte]0)
                $writer.Write([byte]0)
                $writer.Write([UInt16]1)
                $writer.Write([UInt16]32)
                $writer.Write([UInt32]$bytes.Length)
                $writer.Write([UInt32]$offset)
                $offset += $bytes.Length
            }
            foreach ($frame in $frames) {
                [byte[]]$bytes = $frame
                $writer.Write($bytes, 0, $bytes.Length)
            }
            $writer.Flush()
            [System.IO.File]::WriteAllBytes($Destination, $buffer.ToArray())
        }
        finally {
            $writer.Dispose()
            $buffer.Dispose()
        }
    }
    finally { $source.Dispose() }
}

New-IcoFile -SourcePng $IconSource -Destination $iconFile
Write-Step "icon  -> $iconFile"

Write-Host 'Compiling launcher ...'
$launcherSource = [System.IO.File]::ReadAllText($sourceFile)
if (Test-Path -LiteralPath $exeFile) { Remove-Item -LiteralPath $exeFile -Force }
Add-Type -TypeDefinition $launcherSource -OutputAssembly $exeFile -OutputType WindowsApplication
Write-Step "exe   -> $exeFile"

[System.IO.File]::WriteAllText((Join-Path $installDir 'app-path.txt'), $AppPath, (New-Object System.Text.UTF8Encoding($false)))
Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $installDir 'dsh-open.cs') -Force
Write-Step "app   -> $AppPath"

Write-Host 'Registering Explorer verbs ...'
# MultiSelectModel belongs on the folder and drive verbs, which are always invoked
# with one selected item. The background verb runs with an empty selection, so a
# "Single" model makes Explorer hide it.
$verbs = @(
    @{ Key = "$registryRoot\Directory\shell\DeepSeekHarness";            Label = '在 DeepSeek Harness 中打开';   Argument = '%1'; MultiSelect = 'Single' },
    @{ Key = "$registryRoot\Directory\Background\shell\DeepSeekHarness"; Label = '在此处打开 DeepSeek Harness'; Argument = '%V'; MultiSelect = '' },
    @{ Key = "$registryRoot\Drive\shell\DeepSeekHarness";                Label = '在 DeepSeek Harness 中打开';   Argument = '%1'; MultiSelect = 'Single' }
)
foreach ($verb in $verbs) {
    New-Item -Path $verb.Key -Force | Out-Null
    Set-Item -Path $verb.Key -Value $verb.Label
    New-ItemProperty -Path $verb.Key -Name 'Icon' -Value $iconFile -PropertyType String -Force | Out-Null
    if ($verb.MultiSelect) {
        New-ItemProperty -Path $verb.Key -Name 'MultiSelectModel' -Value $verb.MultiSelect -PropertyType String -Force | Out-Null
    }
    elseif ($null -ne (Get-ItemProperty -Path $verb.Key -Name 'MultiSelectModel' -ErrorAction SilentlyContinue)) {
        Remove-ItemProperty -Path $verb.Key -Name 'MultiSelectModel' -Force
    }
    $commandKey = Join-Path $verb.Key 'command'
    New-Item -Path $commandKey -Force | Out-Null
    Set-Item -Path $commandKey -Value ('"' + $exeFile + '" "' + $verb.Argument + '"')
    Write-Step ($verb.Key -replace '^.*?\\Software\\Classes\\', '')
}

if ($machine) {
    # A per-user duplicate would show twice once the classic menu returns.
    foreach ($key in @(
            'HKCU:\Software\Classes\Directory\shell\DeepSeekHarness',
            'HKCU:\Software\Classes\Directory\Background\shell\DeepSeekHarness',
            'HKCU:\Software\Classes\Drive\shell\DeepSeekHarness')) {
        if (Test-Path -LiteralPath $key) {
            Remove-Item -LiteralPath $key -Recurse -Force
            Write-Host "  removed per-user $key"
        }
    }
}

# The menu now exists, so the plugin must not offer its one-time prompt again.
$marker = Join-Path $env:LOCALAPPDATA 'DeepSeekHarness\shell-integration\auto-install.json'
if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force }

try {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class IcoRefresh { [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b); }' -ErrorAction Stop
    [IcoRefresh]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
}
catch { }

Write-Host ''
Write-Host "Done ($Scope scope). 右键文件夹 / 文件夹空白处 / 驱动器即可看到「在 DeepSeek Harness 中打开」。"
Write-Host '如果刚才打开着资源管理器窗口，重开一个窗口（或重启资源管理器）再试。'
Write-Host ''
Write-Host "卸载：powershell -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'uninstall.ps1')`" -Scope $Scope"
