<#
.SYNOPSIS
    One-shot installer for discord-yt-adblock: blocks YouTube ads in Discord's
    Watch Together activity (Windows desktop client).

.DESCRIPTION
    - Runs as administrator (re-launches itself with a UAC prompt if needed).
    - Makes sure Node.js 22+ is installed: installs it with winget, and installs
      winget first if this PC doesn't have it (asks before each).
    - Downloads the project to %LOCALAPPDATA%\discord-yt-adblock (re-run to update).
    - Patches Discord, adds a "Discord (no YT ads)" shortcut (Start Menu + Desktop),
      and takes over Discord's start-at-login if it was on.
    - Offers to restart Discord (as your normal user, not as admin).
    Use -Uninstall to remove everything again.

.PARAMETER NoElevate
    Don't ask for administrator rights. Only works if Node.js 22+ is already installed.

.EXAMPLE
    irm https://raw.githubusercontent.com/tarballz/discord-yt-adblock/master/install.ps1 | iex

.EXAMPLE
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/tarballz/discord-yt-adblock/master/install.ps1))) -Uninstall
#>
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'discord-yt-adblock'),
    [string]$Source = 'https://github.com/tarballz/discord-yt-adblock/archive/refs/heads/master.zip',
    [ValidateSet('Ask', 'Yes', 'No')]
    [string]$RestartDiscord = 'Ask',
    [switch]$Uninstall,
    [switch]$NoElevate,
    # Internal: set on the elevated re-launch to the SID of the user who started it.
    [string]$ElevatedFrom = ''
)

# Our own source text, used to re-launch elevated. Not available when piped into
# `iex` (PowerShell keeps only the iex command), in which case it is re-downloaded.
$dytaSelfText = if ($MyInvocation.MyCommand.ScriptBlock) { $MyInvocation.MyCommand.ScriptBlock.ToString() } else { '' }

# Everything lives inside this function so that, when piped into `iex`, no
# preferences or helpers leak into the caller's PowerShell session.
function Invoke-DiscordYtAdblockSetup {
    param(
        [string]$InstallDir, [string]$Source, [string]$RestartDiscord, [bool]$Uninstall,
        [bool]$NoElevate, [string]$ElevatedFrom, [string]$SelfText
    )

    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is very slow with the progress bar on 5.1
    $scriptUrl = 'https://raw.githubusercontent.com/tarballz/discord-yt-adblock/master/install.ps1'

    function Say([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

    function Confirm-Choice([string]$Question, [string]$Mode) {
        if ($Mode -eq 'Yes') { return $true }
        if ($Mode -eq 'No') { return $false }
        try { $answer = Read-Host "$Question [Y/n]" } catch { return $false } # non-interactive host
        return ($answer -eq '' -or $answer -match '^\s*y')
    }

    function Enable-Tls12 {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    }

    # Pick up PATH changes made by installers that ran after this session started.
    function Update-SessionPath {
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }

    # ---- administrator rights ----------------------------------------------

    $me = [Security.Principal.WindowsIdentity]::GetCurrent()
    $isAdmin = ([Security.Principal.WindowsPrincipal]$me).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not $isAdmin -and -not $NoElevate) {
        Say 'Asking Windows for administrator rights (used to install winget and Node.js if they are missing)'
        $text = $SelfText
        if (-not $text.Contains('Invoke-DiscordYtAdblockSetup')) {
            Enable-Tls12
            $text = (Invoke-WebRequest -Uri $scriptUrl -UseBasicParsing).Content
        }
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ('discord-yt-adblock-setup-' + [guid]::NewGuid().ToString('N') + '.ps1')
        [IO.File]::WriteAllText($tmp, $text)
        $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$tmp`"",
            '-InstallDir', "`"$InstallDir`"", '-Source', "`"$Source`"", '-RestartDiscord', $RestartDiscord,
            '-ElevatedFrom', $me.User.Value)
        if ($Uninstall) { $argList += '-Uninstall' }
        try {
            $proc = Start-Process -FilePath (Get-Process -Id $PID).Path -Verb RunAs -ArgumentList ($argList -join ' ') -Wait -PassThru
        } catch {
            throw 'Administrator rights are needed. Run the command again and choose Yes in the Windows prompt.'
        } finally {
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        }
        if ($proc.ExitCode -ne 0) { throw 'Setup did not finish; see the administrator window for details.' }
        Say 'Finished in the administrator window.'
        return
    }

    if ($ElevatedFrom -and $ElevatedFrom -ne $me.User.Value) {
        throw ('Windows ran this as a different user (' + $me.Name + '), so it would install into the wrong profile. ' +
            'Sign in to Windows with an administrator account and run the command again.')
    }

    # ---- Node.js (and winget to install it) -----------------------------------

    function Find-Node {
        $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $cmd) { return $null }
        $major = [int](& $cmd.Source -p "process.versions.node.split('.')[0]")
        if ($major -lt 22) {
            Write-Host "Found Node.js $major at $($cmd.Source), but version 22 or newer is required." -ForegroundColor Yellow
            return $null
        }
        return $cmd.Source
    }

    function Find-Winget {
        $cmd = Get-Command winget -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) { return $cmd.Source }
        return $null
    }

    function Install-Winget {
        Say 'Installing winget (Microsoft App Installer)'
        # Done in Windows PowerShell 5.1 even when this runs in PowerShell 7, whose
        # Appx support is unreliable. Steps follow Microsoft's documented bootstrap:
        # register the App Installer that ships with Windows; if that isn't enough,
        # install it with the official Microsoft.WinGet.Client module.
        $bootstrap = {
            $ProgressPreference = 'SilentlyContinue'
            try { Add-AppxPackage -RegisterByFamilyName -MainPackage 'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe' -ErrorAction Stop } catch { }
            $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
            if (Get-Command winget -CommandType Application -ErrorAction SilentlyContinue) { return }
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            Install-PackageProvider -Name NuGet -Force | Out-Null
            Install-Module -Name Microsoft.WinGet.Client -Force -Repository PSGallery | Out-Null
            Import-Module Microsoft.WinGet.Client
            Repair-WinGetPackageManager -AllUsers
        }
        & (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -ExecutionPolicy Bypass -Command $bootstrap | Out-Host
        Update-SessionPath
        $winget = Find-Winget
        if (-not $winget) {
            throw 'winget could not be installed automatically. Install "App Installer" from the Microsoft Store (https://aka.ms/getwinget), then run this again.'
        }
        return $winget
    }

    function Get-Node {
        $node = Find-Node
        if ($node) { return $node }

        $winget = Find-Winget
        if ($winget) {
            $ok = Confirm-Choice 'Node.js 22+ is required. Install Node.js LTS with winget now?' 'Ask'
            if (-not $ok) {
                throw 'Node.js 22 or newer is required. Install it (winget install OpenJS.NodeJS.LTS, or https://nodejs.org), then run this again.'
            }
        } else {
            Write-Host "Node.js 22+ is required. It's installed with winget, which isn't installed on this PC." -ForegroundColor Yellow
            $ok = Confirm-Choice 'Install winget now, then Node.js?' 'Ask'
            if (-not $ok) {
                throw "winget isn't installed, so Node.js can't be installed automatically. Install App Installer (https://aka.ms/getwinget) or Node.js 22+ (https://nodejs.org), then run this again."
            }
            $winget = Install-Winget
        }

        Say 'Installing Node.js LTS with winget'
        & $winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements | Out-Host
        Update-SessionPath
        $node = Find-Node
        if (-not $node) {
            throw "Node.js was not found after installing it with winget (exit code $LASTEXITCODE). Install Node.js 22+ from https://nodejs.org, then run this again."
        }
        return $node
    }

    # ---- download + install ------------------------------------------------------

    function Get-Archive {
        $zip = Join-Path ([IO.Path]::GetTempPath()) ('discord-yt-adblock-' + [guid]::NewGuid().ToString('N') + '.zip')
        if ($Source -match '^https?://') {
            Enable-Tls12
            try { Invoke-WebRequest -Uri $Source -OutFile $zip -UseBasicParsing }
            catch { throw "Could not download $Source ($($_.Exception.Message))" }
        } elseif (Test-Path -LiteralPath $Source -PathType Leaf) {
            Copy-Item -LiteralPath $Source -Destination $zip
        } else {
            throw "Could not find the source archive $Source"
        }
        return $zip
    }

    # Unpacks next to InstallDir, then swaps folders, so a failure part-way never
    # leaves a half-installed copy (the old install is restored instead).
    function Install-Files([string]$Zip) {
        $parent = Split-Path -Parent $InstallDir
        $leaf = Split-Path -Leaf $InstallDir
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
        $id = [guid]::NewGuid().ToString('N').Substring(0, 8)
        $staging = Join-Path $parent ".$leaf.new-$id"
        $old = Join-Path $parent ".$leaf.old-$id"
        try {
            # Not Expand-Archive: when 5.1 inherits PowerShell 7's module path it loads
            # an Archive module that calls .NET Core-only APIs and fails.
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $staging)
            $root = $staging
            if (-not (Test-Path -LiteralPath (Join-Path $root 'package.json'))) {
                $dirs = @(Get-ChildItem -LiteralPath $staging -Directory)
                if ($dirs.Count -ne 1 -or -not (Test-Path -LiteralPath (Join-Path $dirs[0].FullName 'package.json'))) {
                    throw "The downloaded archive does not look like discord-yt-adblock."
                }
                $root = $dirs[0].FullName
            }
            if (Test-Path -LiteralPath $InstallDir) { Move-Item -LiteralPath $InstallDir -Destination $old }
            try {
                Move-Item -LiteralPath $root -Destination $InstallDir
            } catch {
                if (Test-Path -LiteralPath $old) { Move-Item -LiteralPath $old -Destination $InstallDir }
                throw
            }
            # Keep the logs (a running Discord may still be writing injector.log).
            $oldLogs = Join-Path $old 'logs'
            if ((Test-Path -LiteralPath $oldLogs) -and -not (Test-Path -LiteralPath (Join-Path $InstallDir 'logs'))) {
                Move-Item -LiteralPath $oldLogs -Destination (Join-Path $InstallDir 'logs') -ErrorAction SilentlyContinue
            }
        } finally {
            Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    function Invoke-NodeScript([string]$Node, [string]$Script) {
        & $Node (Join-Path $InstallDir $Script) | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "$Script failed (exit code $LASTEXITCODE)." }
    }

    # ---- Discord -----------------------------------------------------------------

    function Test-DiscordRunning { [bool](Get-Process -Name 'Discord' -ErrorAction SilentlyContinue) }

    function Stop-Discord {
        Get-Process -Name 'Discord' -ErrorAction SilentlyContinue | Stop-Process -Force
        $deadline = (Get-Date).AddSeconds(15)
        while ((Test-DiscordRunning) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
    }

    # Started through Explorer so it runs as the signed-in user's normal (non-admin)
    # session, even though this script is elevated. Also keeps the install folder
    # from being any process's working directory (that would lock it for updates).
    function Start-AsUser([string]$Path) {
        Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList "`"$Path`""
    }

    # ---- uninstall ---------------------------------------------------------------

    if ($Uninstall) {
        if (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'bin\uninstall.js'))) {
            Say "discord-yt-adblock is not installed at $InstallDir; nothing to do."
            return
        }
        $node = Get-Node
        $wasRunning = Test-DiscordRunning
        $restart = $wasRunning -and (Confirm-Choice 'Restart Discord now to finish removing the blocker?' $RestartDiscord)
        if ($restart) { Say 'Closing Discord'; Stop-Discord }
        Say 'Removing the patch, shortcuts and login entry'
        Invoke-NodeScript $node 'bin\uninstall.js'
        if ($wasRunning -and -not $restart) {
            # The running Discord still has the blocker loaded; keep only the
            # `uninstalled` marker, which stops it from re-patching itself.
            Get-ChildItem -LiteralPath $InstallDir -Force | Where-Object { $_.Name -ne 'uninstalled' } | Remove-Item -Recurse -Force
            Say "Done. Discord keeps blocking ads until it restarts; after that you can delete $InstallDir."
        } else {
            Remove-Item -LiteralPath $InstallDir -Recurse -Force
            if ($restart) { Start-AsUser (Join-Path $env:LOCALAPPDATA 'Discord\Discord.exe') }
            Say 'Done. discord-yt-adblock has been removed.'
        }
        return
    }

    # ---- install -----------------------------------------------------------------

    Say 'Checking for Node.js 22+'
    $node = Get-Node
    Say 'Downloading discord-yt-adblock'
    $zip = Get-Archive
    Say "Installing to $InstallDir"
    try { Install-Files $zip } finally { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }

    $restart = $false
    if (Test-DiscordRunning) {
        $restart = Confirm-Choice 'Discord is running. Restart it now so ads are blocked right away?' $RestartDiscord
        if ($restart) { Say 'Closing Discord'; Stop-Discord }
    }
    Say 'Patching Discord'
    Invoke-NodeScript $node 'bin\install.js'
    if ($restart) {
        Say 'Starting Discord'
        Start-AsUser (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Discord (no YT ads).lnk')
    }
    Say 'Done. YouTube ads in Watch Together are now blocked. Start Discord with the "Discord (no YT ads)" shortcut.'
}

$dytaExitCode = 0
try {
    Invoke-DiscordYtAdblockSetup -InstallDir $InstallDir -Source $Source -RestartDiscord $RestartDiscord -Uninstall $Uninstall.IsPresent `
        -NoElevate $NoElevate.IsPresent -ElevatedFrom $ElevatedFrom -SelfText $dytaSelfText
} catch {
    Write-Host "discord-yt-adblock: $($_.Exception.Message)" -ForegroundColor Red
    $dytaExitCode = 1
}
# The elevated re-launch runs in its own window, which would vanish with its output.
if ($ElevatedFrom) { try { Read-Host 'Press Enter to close this window' | Out-Null } catch { } }
# Never `exit` when piped into iex: that would close the user's shell.
if ($PSCommandPath -and $dytaExitCode -ne 0) { exit $dytaExitCode }
