<#
.SYNOPSIS
    One-shot installer for discord-yt-adblock: blocks YouTube ads in Discord's
    Watch Together activity (Windows desktop client).

.DESCRIPTION
    - Makes sure Node.js 22+ is installed. If it isn't, offers to install it with
      winget (and to install winget first if this PC doesn't have it). Only that
      install step asks for administrator rights; everything else runs as you.
    - Downloads the project to %LOCALAPPDATA%\discord-yt-adblock (re-run to update).
    - Patches Discord, adds a "Discord (no YT ads)" shortcut (Start Menu + Desktop),
      and takes over Discord's start-at-login if it was on.
    - Offers to restart Discord so the blocker is active right away.
    Use -Uninstall to remove everything again.

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
    [switch]$Uninstall
)

# Everything lives inside this function so that, when piped into `iex`, no
# preferences or helpers leak into the caller's PowerShell session.
function Invoke-DiscordYtAdblockSetup {
    param([string]$InstallDir, [string]$Source, [string]$RestartDiscord, [bool]$Uninstall)

    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is very slow with the progress bar on 5.1

    function Say([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

    function Confirm-Choice([string]$Question, [string]$Mode) {
        if ($Mode -eq 'Yes') { return $true }
        if ($Mode -eq 'No') { return $false }
        try { $answer = Read-Host "$Question [Y/n]" } catch { return $false } # non-interactive host
        return ($answer -eq '' -or $answer -match '^\s*y')
    }

    # Pick up PATH changes made by installers that ran after this session started.
    function Update-SessionPath {
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }

    # ---- Node.js -------------------------------------------------------------------

    # The ONLY code that runs with administrator rights. It is fixed text (nothing
    # user-controlled is spliced in), handed over inline via -EncodedCommand (no
    # script file that another process could swap before it runs), and it only
    # starts programs from admin-protected locations: Windows PowerShell from
    # System32 and winget from its package folder under Program Files\WindowsApps.
    $elevatedInstallNode = {
        $ErrorActionPreference = 'Stop'
        $ProgressPreference = 'SilentlyContinue'
        function Get-WingetExe {
            $pkg = Get-AppxPackage -Name 'Microsoft.DesktopAppInstaller' -ErrorAction SilentlyContinue |
                Sort-Object Version -Descending | Select-Object -First 1
            if ($pkg -and $pkg.InstallLocation) {
                $exe = Join-Path $pkg.InstallLocation 'winget.exe'
                if (Test-Path -LiteralPath $exe) { return $exe }
            }
            return $null
        }
        try {
            $winget = Get-WingetExe
            if (-not $winget) {
                # Microsoft's documented bootstrap: register the App Installer that ships
                # with Windows; if that isn't enough, use the official WinGet module.
                Write-Host '==> Installing winget (Microsoft App Installer)' -ForegroundColor Cyan
                try { Add-AppxPackage -RegisterByFamilyName -MainPackage 'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe' } catch { }
                $winget = Get-WingetExe
            }
            if (-not $winget) {
                [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
                Install-PackageProvider -Name NuGet -Force | Out-Null
                Install-Module -Name Microsoft.WinGet.Client -Force -Repository PSGallery | Out-Null
                Import-Module Microsoft.WinGet.Client
                Repair-WinGetPackageManager -AllUsers
                $winget = Get-WingetExe
            }
            if (-not $winget) { throw 'winget could not be installed.' }
            Write-Host '==> Installing Node.js LTS with winget' -ForegroundColor Cyan
            & $winget install --id OpenJS.NodeJS.LTS --exact --silent --scope machine --accept-package-agreements --accept-source-agreements
            exit $LASTEXITCODE
        } catch {
            Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
            Start-Sleep -Seconds 10 # leave time to read it before this admin window closes
            exit 1
        }
    }

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

    function Test-Winget { [bool](Get-Command winget -CommandType Application -ErrorAction SilentlyContinue) }

    function Install-NodeElevated {
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($elevatedInstallNode.ToString()))
        $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        Say 'Windows will now ask for administrator rights to install it'
        try {
            $proc = Start-Process -FilePath $windowsPowerShell -Verb RunAs -PassThru `
                -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
        } catch {
            throw 'Administrator rights are needed to install Node.js. Run the command again and choose Yes in the Windows prompt.'
        }
        $proc.WaitForExit()
        return $proc.ExitCode
    }

    function Get-Node {
        $node = Find-Node
        if ($node) { return $node }
        if (Test-Winget) {
            $question = 'Node.js 22+ is required. Install Node.js LTS with winget now?'
            $declined = 'Node.js 22 or newer is required. Install it (winget install OpenJS.NodeJS.LTS, or https://nodejs.org), then run this again.'
        } else {
            Write-Host "Node.js 22+ is required. It's installed with winget, which isn't installed on this PC." -ForegroundColor Yellow
            $question = 'Install winget, then Node.js, now?'
            $declined = "winget isn't installed, so Node.js can't be installed automatically. Install App Installer (https://aka.ms/getwinget) or Node.js 22+ (https://nodejs.org), then run this again."
        }
        if (-not (Confirm-Choice $question 'Ask')) { throw $declined }
        $code = Install-NodeElevated
        Update-SessionPath
        $node = Find-Node
        if (-not $node) {
            throw "Node.js was not found after the install (exit code $code). Install Node.js 22+ from https://nodejs.org, then run this again."
        }
        return $node
    }

    # ---- download + install ------------------------------------------------------

    function Get-Archive {
        $zip = Join-Path ([IO.Path]::GetTempPath()) ('discord-yt-adblock-' + [guid]::NewGuid().ToString('N') + '.zip')
        if ($Source -match '^https?://') {
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
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

    $discordRoot = Join-Path $env:LOCALAPPDATA 'Discord'

    function Test-DiscordRunning { [bool](Get-Process -Name 'Discord' -ErrorAction SilentlyContinue) }

    function Stop-Discord {
        Get-Process -Name 'Discord' -ErrorAction SilentlyContinue | Stop-Process -Force
        $deadline = (Get-Date).AddSeconds(15)
        while ((Test-DiscordRunning) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
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
            if ($restart) {
                Start-Process -FilePath (Join-Path $discordRoot 'Update.exe') -ArgumentList '--processStart', 'Discord.exe' -WorkingDirectory $discordRoot
            }
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
        # Opening the shortcut runs the launcher exactly like a double-click does,
        # with Discord's folder (not the install folder) as its working directory.
        Start-Process -FilePath (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Discord (no YT ads).lnk')
    }
    Say 'Done. YouTube ads in Watch Together are now blocked. Start Discord with the "Discord (no YT ads)" shortcut.'
}

try {
    Invoke-DiscordYtAdblockSetup -InstallDir $InstallDir -Source $Source -RestartDiscord $RestartDiscord -Uninstall $Uninstall.IsPresent
} catch {
    Write-Host "discord-yt-adblock: $($_.Exception.Message)" -ForegroundColor Red
    if ($PSCommandPath) { exit 1 } # never `exit` when piped into iex: that would close the user's shell
}
