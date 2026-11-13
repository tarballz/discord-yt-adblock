<#
.SYNOPSIS
    One-shot installer for discord-yt-adblock: blocks YouTube ads in Discord's
    Watch Together activity (Windows desktop client).

.DESCRIPTION
    - Makes sure Node.js 22+ is available (offers to install Node.js LTS with winget).
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

    function Get-Node {
        $node = Find-Node
        if ($node) { return $node }
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if ($winget -and (Confirm-Choice 'Node.js 22+ is required. Install Node.js LTS with winget now?' 'Ask')) {
            & $winget.Source install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements | Out-Host
            $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
            $node = Find-Node
            if ($node) { return $node }
        }
        throw 'Node.js 22 or newer is required. Install it from https://nodejs.org (or run: winget install OpenJS.NodeJS.LTS), then run this again.'
    }

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

    function Test-DiscordRunning { [bool](Get-Process -Name 'Discord' -ErrorAction SilentlyContinue) }

    function Stop-Discord {
        Get-Process -Name 'Discord' -ErrorAction SilentlyContinue | Stop-Process -Force
        $deadline = (Get-Date).AddSeconds(15)
        while ((Test-DiscordRunning) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
    }

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
                Start-Process -FilePath (Join-Path $env:LOCALAPPDATA 'Discord\Update.exe') -ArgumentList '--processStart', 'Discord.exe'
            }
            Say 'Done. discord-yt-adblock has been removed.'
        }
        return
    }

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
        $launch = Join-Path $InstallDir 'bin\launch.js'
        # Not -WorkingDirectory $InstallDir: a live process's cwd locks the folder,
        # which would make the next update's folder swap fail.
        Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\conhost.exe') -ArgumentList "--headless `"$node`" `"$launch`"" -WorkingDirectory (Join-Path $env:LOCALAPPDATA 'Discord')
    }
    Say 'Done. YouTube ads in Watch Together are now blocked. Start Discord with the "Discord (no YT ads)" shortcut.'
}

try {
    Invoke-DiscordYtAdblockSetup -InstallDir $InstallDir -Source $Source -RestartDiscord $RestartDiscord -Uninstall $Uninstall.IsPresent
} catch {
    Write-Host "discord-yt-adblock: $($_.Exception.Message)" -ForegroundColor Red
    if ($PSCommandPath) { exit 1 } # never `exit` when piped into iex: that would close the user's shell
}
