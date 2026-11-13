# discord-yt-adblock

Blocks YouTube ads inside the Discord desktop client's **Watch Together** activity (verified live on 2026-11-12). It is also meant to cover YouTube embeds played inline in chat, but that path hasn't been seen working yet: no chat-embed player frame showed up in the test run. If chat videos still show ads, create the `debug` flag, play one, and check `logs/injector.log` for its frame URL. It only affects your own client. Friends in the activity still see their ads unless they run it too.

> Modifying the Discord client is against Discord's Terms of Service. Use at your own risk.

## Quick install

In PowerShell (Windows PowerShell 5.1 or PowerShell 7):

```powershell
irm https://raw.githubusercontent.com/tarballz/discord-yt-adblock/master/install.ps1 | iex
```

The installer:

- checks for Node.js 22+, and if it's missing, offers to install it with `winget`. If `winget` itself is missing, it offers to install that first (Microsoft's App Installer). Only this step asks for **administrator rights** (UAC); if Node.js is already installed there's no admin prompt at all;
- downloads this repo to `%LOCALAPPDATA%\discord-yt-adblock`;
- patches Discord and adds a **Discord (no YT ads)** shortcut to the Start Menu and Desktop;
- if Discord was set to start at login, moves that over to the blocker's launcher;
- offers to restart Discord so ads are blocked right away.

Run the same command again to update. To uninstall:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/tarballz/discord-yt-adblock/master/install.ps1))) -Uninstall
```

Piping a script from the internet into `iex` runs it with your permissions, so feel free to [read `install.ps1`](install.ps1) first. It's short.

## How it works

1. A small managed block is added to the top of Discord's `discord_desktop_core\index.js`. It loads `src/injector.js` into Discord's Electron main process, and it's wrapped in `try/catch`, so if this folder disappears Discord still starts normally.
2. The injector watches every frame Discord creates. `src/frameMatch.js` decides which frames are YouTube players.
3. Matching frames get two page scripts, run as one injection:
   - `src/page/prune.js` (ours) removes `adSlots` from the player's JSON. Current YouTube responses schedule video ads through `adSlots`, which AdGuard's script doesn't strip, so without this those ads start and only get fast-forwarded.
   - `src/vendor/adguard.js` is AdGuard's YouTube script, taken from Vencord. It strips `adPlacements`/`playerAds`, hides ad elements, and fast-forwards any ad that still slips through.

Discord updates create a fresh `app-1.0.XXXX` folder without the patch. Three things handle that:

- **The launcher** (`bin/launch.js`, behind the shortcut and the login entry) patches every installed version before starting Discord.
- **The launcher keeps watching for 10 minutes after starting Discord.** This covers updates Discord installs during its splash screen before restarting itself.
- **The injector re-patches every 10 minutes while Discord runs, and again when Discord quits.** This covers updates downloaded in the background.

**Remaining gap:** if Discord installs an update during its splash screen *and* you didn't start it through the shortcut (say, from Discord's own taskbar pin), that session runs without the blocker. Restart Discord from the "Discord (no YT ads)" shortcut to fix it.

## Requirements

- Windows, with the Discord desktop app (stable) installed in the default location (`%LOCALAPPDATA%\Discord`)
- Node.js 22 or newer. No npm dependencies.

## Install from a clone (for development)

```sh
git clone https://github.com/tarballz/discord-yt-adblock.git
cd discord-yt-adblock
npm run install-patch   # patch + shortcuts (Start Menu, Desktop) + login entry
npm run uninstall       # restore Discord's index.js, remove shortcuts + login entry
```

Start-at-login is only taken over from Discord while Discord is fully closed, because Discord rewrites its settings file while running. If `install-patch` reports that Discord was running, quit Discord from the tray and run it again.

Either way, pin the **Discord (no YT ads)** shortcut to your taskbar instead of the normal Discord pin.

## Flags and logs

Create an empty file named `debug` or `disabled` in the install folder to turn a flag on. That's `%LOCALAPPDATA%\discord-yt-adblock` for the quick install, or your clone. They're re-read for every frame, so no restart is needed; just reopen the activity.

| File | Effect |
|---|---|
| `debug` | Log every frame URL Discord loads. Useful if YouTube or Discord changes their URLs. |
| `disabled` | Don't inject, but still log what would have been injected. Use it for on/off comparisons. |

Logs:

- `logs/injector.log` is written from inside Discord and cleared each time Discord starts. A good line looks like `injected → https://www.youtube.com/embed/… adguardInjected=true`.
- `logs/launcher.log` records the patch and watch activity.

## Development

```sh
npm test   # node --test, no dependencies; install.ps1 tests run under Windows PowerShell 5.1
```

## License

GPL-3.0-or-later. Includes AdGuard's Block YouTube Ads script (GPL-3.0), taken from Vencord's `youtubeAdblock` plugin (GPL-3.0). See `src/vendor/adguard.js` for the exact source commit.
