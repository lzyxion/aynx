# Settings guide

This guide explains each item on the Aynx settings screen (`Ctrl+,`) in detail. The ⓘ on the settings screen shows only a short
description (rows that a one-line summary covers have no ⓘ). Circumstances, exceptions and relationships with other features are written here. The order matches the list on the left of the settings screen.

**Common rules**

- A settings change **applies to the screen right away**. [Save] writes the values you see now to the file (`settings.toml`),
  and [Cancel] goes back to the last saved values. Pressing [Save] does not close the settings screen.
- The settings screen covers only frequently changed items. Finer appearance changes (user CSS overrides) do not exist yet. They are follow-up work.

---

## General

The rows are grouped under four headings: **Display** · **Startup & connections** · **File tiles** · **Session server**.

<a id="app-language"></a>
### Language

The display language of the app. It applies as soon as you pick it.

- **Auto (system)** follows the OS display language: Korean if the OS is Korean, English otherwise.
- Screens that have not been translated yet stay in Korean whichever language you pick.

<a id="app-ui-scale"></a>
### UI scale

Scales the whole app (tabs, docks, settings, menus and so on) up or down by one factor.

- **Terminal text keeps its size.** Terminal text is adjusted to appear at the size set in the Terminal section,
  and the only thing that changes is how many columns and rows fit on screen for the window size.
- It applies to all open windows together.

<a id="app-ui-font"></a>
### App font

The font used outside the terminal (menus, settings, tabs and so on). Leave it empty for the default font.

- Write it in CSS `font-family` format. Example: `'Pretendard', sans-serif`
- Only fonts installed on this PC are used. If the first font is missing, the next one after the comma is used.
- The terminal font is set separately in the Terminal section.

<a id="app-auto-reconnect"></a>
### Auto-reconnect SSH on startup

Decides whether SSH tiles left open last time connect right away when you reopen the app. **Off by default.**

- The layout of open tabs (tiles, split ratios, names) is saved automatically regardless of this setting and comes back on the next run.
  Sessions (local shells and SSH) stay alive in the session server, so the next run's tiles reattach to the same sessions. This setting is used only for SSH tiles
  that did not survive in the session server (closed ones).
- When it is off, restored SSH tiles appear unconnected. Connect them with the tile's [Connect] or the **Reconnect all restored sessions** shortcut.
- It is off by default because connecting to many servers at once can make servers refuse you under their concurrent connection limits, or can bring up a
  long series of password and host key prompts. Even when it is on, connections start one at a time, 120 ms apart.

<a id="app-host-history"></a>
### Connection history

Stores each host's last connection time and last failure time on this PC only (`history.json`). The button on the right clears all of it.

- The **Sort: recent** order of the host list and the recent row of the start screen use these values.
- No passwords, key paths or commands are stored.
- Headless connections (AI permission) and quick connections are not recorded.

<a id="project-start-screen"></a>
### Project start screen

Decides whether opening a project or worktree shows a **start screen** first instead of a shell. The default is **Auto**.

- **Auto**: opening a local project or worktree (including a newly created one) shows a new tile with the start screen. From there, choose either
  - Start new: shell, AI or start command
  - Past conversations in that folder (Claude Code, Codex): resume or continue in a new conversation

  and the tile changes in place. If there are no conversations yet, Enter opens a shell immediately. Conversations from other worktrees
  can be seen with "Whole project".
- **Off**: the shell (or the start command) appears immediately, as it used to.
- Remote projects and existing remote worktrees behave the same way (conversations are read through an SSH tile attached to that host). When you **create** a new remote worktree,
  the first input is what creates it, so an SSH tile appears immediately. See the [projects guide](projects.md#project-start) for details.

<a id="app-tray-on-close"></a>
### Stay in the tray when all windows close

Decides whether closing the main window (the last window) quits the app or leaves it in the notification area (tray). **On by default.** Either way, **sessions do not end**:
local shells, SSH and the AI CLIs inside them keep running in the session server, and tiles reattach to the same sessions when you reopen the app.

- **On**: the app stays in the tray when you close the window. OS notifications and messenger messages for task plan run results keep coming. The tooltip shows the number of sessions and the number awaiting approval.
- Tray menu: **Open** (reopens the main window, starting with the veil if the vault is locked) · **Detached sessions N** (opens the app at that list) ·
  **Quit the GUI (sessions keep running)** · **End all sessions…** (after confirmation, closes every session and quits the session server and the app).
- **Off**: closing the window quits the app. Sessions stay in the session server.
- When there are no windows, **the vault locks** (even in the tray, no window is viewing it). It opens when you lift the veil on reopening.
- Pre-set policy **auto-approval** is run by the session server even while the app is closed. Runs that finished while the app was closed are reported the next time you start the app in one line:
  "N task plan run(s) finished while the app was closed".
- In environments without a tray, this row is dimmed and closing the window quits the app.

<a id="files-default-view"></a>
### File tile default view

How newly opened file tiles (both This PC and remote) show folders. The default is **Details**.

- **Icons** is a grid of large pictures (size is set with the slider in the tile's status line or `Ctrl+wheel`).
- **Compact** fills from top to bottom, and columns grow sideways.
- **Details** is a list with size, date and permission columns. Folders expand in place.
- A tile whose view you changed with the toolbar's view buttons (`Ctrl+1/2/3`) remembers its own view. A new tile opens in the view last picked from a toolbar on this device, and uses this value if there is none. Picking a value here clears the last-picked view, so new tiles open in this value again.
- The old values "tree" and "navigate" are read as **Details** (the old strings in settings files and layout files still load).

---

## Theme

<a id="theme-profile-lead"></a>
### Profiles

Save the current look as one set, then swap it all at once by choosing a card. For a quick switch, use `Ctrl+Shift+U`.

- **What is included**: everything this section sets, meaning wallpaper (image, dim, blur, fit), brightness (mode), colors and
  opacity, material, tab, status bar and tile header styles, [resource rings](#resource-rings) and [usage rings](#usage-rings) on or off,
  [window buttons](#window-buttons), [dock layout](#dock-layout), the [app icon](#app-icon) and the [app font](#app-ui-font).
  From the Terminal section it also takes the terminal palette (including colors extracted from the wallpaper), terminal opacity,
  the terminal font, [cursor style](#cursor-style) and [ligatures](#term-ligatures).
- **What is not included**: settings that are not about appearance, such as shortcuts, shells, tile placement and auto-reconnect, and font sizes (app and terminal).
- Profiles saved before a setting was added keep your current value for it when you apply them.
- Wallpapers keep a separate copy per picture in the app folder, so each profile switches to its own picture. The same picture is stored only once,
  and copies used by neither any profile nor the current settings are cleaned up.
- If a profile's picture copy is missing, only the background stays as it is and the rest is applied.

<a id="wp-lead"></a>
### Wallpaper

The background image of the whole window. It sits behind the title bar, in the gaps between tiles, and behind the start screen.

- The image you pick is **copied** to the app folder. The background stays even if you move or delete the original.
- **Random wallpaper** downloads one 16:9 image of 1920×1080 or larger from konachan.net and applies it right away (it downloads only when you press it, up to 30MB). After the download, the picture's original post appears as its "Source" (this disappears when you restart the app).
- To show more of the image, lower **Opacity** below (app chrome, glass panels, tiles other than the terminal) and **Terminal opacity** (the area text sits in).
  The two sliders set "how densely things cover the image".

<a id="wp-dim"></a>
### Dim

The strength (%) of the black laid over the image. The brighter the photo, the higher this needs to be for text between tiles to be readable.

<a id="wp-blur"></a>
### Blur

How much the photo is blurred (px). It keeps the photo's patterns from competing with text. At 0, the sharp original is shown as is.

<a id="wp-fit"></a>
### Fit (wallpaper)

How the image sits in the window.

- **Fill** fills the window completely. If the aspect ratios differ, the edges are cropped. This is the default.
- **Fit** fits the whole image in view. The remaining space is left as margins.
- **Tile** repeats the image at its original size like a checkerboard.
- **Center** places the image in the center at its original size.

<a id="app-colors"></a>
### Color themes

Chips below the wallpaper choose the **whole theme**. Background, panels, text, lines, semantic colors, the accent color and the 21 terminal colors all change together.

- **Signal** is the default family: Azure → Tide → Phosphor → Volt → Ember → Iris. The first run uses Azure, a neutral graphite background with a blue accent color. The other variants keep the same neutral graphite chrome with a different accent color.
- **Classic** is Ocean → Forest → Sunset → Lavender → Rose → Amber → Slate. It keeps the colors and behavior of the seven older themes.
- **Monochrome** is White → Silver → Graphite. It offers three levels of achromatic accent color on a neutral graphite screen.
- Pressing a family chip moves to the next variant within that family. Coming from another family, a custom color or wallpaper extraction starts at the first variant.
  The chip shows the family and the name of the variant selected now.
- The older variants (Luna, Aoi, Hikari, Sumire) and the Cyberpunk family were removed. Settings that used them keep their colors, and no chip lights up
  (they are treated like hand-edited colors, so they do not follow brightness changes until you pick a chip again). The Cyberpunk terminal presets were
  also removed. Settings that chose them change to the Aynx preset of the same mode (Aynx Dark · Aynx Light). The unpaired light terminal preset
  "Light (basic)" was removed too. Settings that chose it change to Aynx Light.
- **Custom color**: pressing the chip opens a color picker. One color builds the whole palette, and only the accent color's lightness is adjusted so it stays readable.
- **Extract from wallpaper** builds the full app and terminal palette from the photo's representative color (Material You TonalSpot).
  Changing the photo rebuilds it. Picking a built-in theme, a custom color or a terminal preset turns photo extraction off. You can press it only when there is a photo.
- Chips and custom colors preview right away. [Save] confirms them and [Cancel] reverts them. Color calculation takes place only inside the app window.

<a id="app-mode"></a>
### Brightness

The palette for the whole app chrome: **System** · **Dark** · **Light**. It is applied and saved as soon as you pick it. The default is System.

- **System** follows the OS brightness setting and reacts right away when the OS setting changes.
- Changing the mode also changes the terminal theme if it is a preset with a pair (Aynx Dark ↔ Aynx Light and so on).
- Built-in themes and custom colors change to the opposite-mode palette of the same variant and source color. Wallpaper extraction is also rebuilt from the same source color.
- A preset picked separately in the terminal stays selected, and changes to its opposite-mode pair if it has one.
- **Match color theme · Dark** and **· Light** in the terminal keep their brightness: changing the mode does not switch them (see [Terminal › Theme](#term-preset)).

<a id="app-opacity"></a>
### Opacity

The opacity of the app chrome (sidebar, tab bar, docks, glass panels) and of tile surfaces such as file, DB and document tiles. The lower it is, the more the wallpaper (or the app background if there is none) shows through. The default is 60%.

- The window itself is always opaque, so the desktop does not show through.
- The lower a glass panel's value, the more of the blurred background shows through. The higher it is, the denser the panel and the crisper the text.

- The terminal area is not affected by this value. **Terminal opacity** below sets it separately.

<a id="term-opacity"></a>
### Terminal opacity

The opacity of the terminal area (where text sits). 100% is opaque.

- Lowering it lets the wallpaper (or the app background if there is none) show through behind the terminal area.
- This area is for reading text, so it is easier to read when set higher than chrome opacity (for example, chrome 40% and terminal 85%).

<a id="app-icon"></a>
### App icon

The icon of windows and the taskbar: **GPT** (default, the same picture as the build icon) · **Claude** · **Gemini** · **Grok**, plus your own pictures added with [＋]
(choose a square area and it is cut to the same rounded shape, up to 24, and removed with the × on the chip). Pressing a thumbnail previews the icon on all open windows
right away, and it is kept only when you press settings [Save] (it then carries over to the next run and new windows; [Cancel] reverts it).

- The icons of the executable, installer and shortcuts (including ones pinned to the taskbar) are set at build time and do not change.
- Saving also applies the current icon to the selected theme profile. The remote web screen does not support choosing, adding or removing icons.

<a id="material"></a>
### Material

What the app chrome is drawn with: **Glass** · **Flat**. The default is Glass.

- **Glass**: the tab bar, status bar, docks, command palette, menus, dialogs and toasts become translucent glass panels, and what is behind them (wallpaper, tiles) shows through
  blurred. Strips that are always visible (tab bar, status bar) are drawn lightly, and surfaces that float above (palette, dialogs, menus) are drawn densely.
- **Flat** is an opaque surface, exactly the older look.
- It is chosen separately from color. Color themes, custom colors, wallpaper color extraction and brightness tint the glass as they are.
- With no wallpaper, Glass lays a faint glow made from the color theme behind the window (a single flat color behind glass would look like just a gray panel).
- The terminal area and tile bodies do not change. **Terminal opacity** sets the terminal separately.
- **Opacity** sets how much the glass panels show through.

<a id="tab-style"></a>
### Tab style

How tabs in the tab bar are drawn: **Pill** · **Flat**. The default is Pill.

- **Flat** shows text only, without a panel. The current tab appears as accent-colored text and an accent-colored indicator line attached to the border below the tab bar.
- Everything is drawn in CSS, so no extra font is needed.
- The older **Powerline** and **Slanted** styles are gone. If they remain in a settings file or a look profile, they appear as Pill.

<a id="window-buttons"></a>
### Window buttons

Whether to show **minimize · maximize · close** at the right end of the tab bar. **On** by default.

- When off, close with the dock's [Quit…], maximize by double-clicking the empty space after the tabs, and minimize with your OS shortcut.

<a id="status-bar"></a>
### Status bar

A thin strip that holds usage, notifications and app status. Its position can be **Left** (default) ·
**Top** · **Bottom** · **Right**.

- There is no menu slot at the front of the status bar. New terminals and past conversations open from the dock's launch panel, the session list with `Ctrl+Shift+M`, and the command palette with `Ctrl+Shift+P`.
- The middle group (resource rings → divider → usage rings) starts at 28% of the status bar's full length, whether horizontal or vertical. App status and notifications stay at the very end.
- The slots in the order **Pin · Favorites · Launcher** are on the **favorites dock**, which rises when you hover the bottom center. No separate handle is shown. With a bottom status bar, hover right above the status bar. Files and settings moved to the side dock.
- This dock is the only place to manage favorites. Pressing one connects to a host or opens a project. Names appear as tooltips. To add one, drag a host, project or DB connection row from the side dock onto this dock (up to 10). Right-click (or the menu key · `Shift+F10`) and choose **Remove** to take one out, and drag or use `Alt+←/→` · `Home`/`End` to change the order. Pin and Launcher stay even with no favorites.
- When you move out of the dock, it collapses downward after a moment. It stays open during a favorites right-click menu, a drag or keyboard use. Turning **Pin** on keeps it raised. **Launcher** opens and closes the side dock.
- **Top · Bottom** is a horizontal strip.
- **Left · Right** is a 30px vertical column. Only icons stand, and names go into the dots' tooltips.
- With **Left · Right**, the host and project docks open on the same side. They do not overlap the status bar and align to the tile edge, and the width handle sits on the content side.
- With a **Right** status bar, notification toasts appear at the top left. In other positions they appear at the top right.
- A workspace is a screen board that remembers tabs and tile placement. The project list is global, so any workspace can open the same project or worktree as a tab. If it is already open here, the app moves to that tab or tile.
- Deleting a workspace closes the tabs and sessions it shows. The project list stays as it is.
- Pick a workspace from the list on the button at the very front of the tab bar. Each row shows its most urgent state as a badge: the number of waiting sessions (accent color) · the number of failed sessions (red) · running (green dot), or ↗ if none of these apply and it is open in another window. The pill next to the button is the total of waiting sessions in other workspaces.
- In the main window, drag rows in that list to reorder them (`Esc` cancels). Right-click a row and choose **Edit…** or **Delete workspace…** (or use the menu key · `Shift+F10` on the row, and `F2` for edit) to change the name, icon and color in one dialog or to delete it. In secondary windows you can only pick.
- The chosen icon and color appear in the workspace list, the switcher (`Ctrl+Shift+G`), the tab bar button and the membership chip of secondary windows. With no icon, the first letter of the name is used.
- When there is only one workspace, delete is disabled in the menu and palette. **New workspace…** at the end of the list asks only for a name.

<a id="status-bar-style"></a>
### Status bar style

How the status bar strip is drawn. The default is **Flat**.

- **Flat** is a thin strip attached to the window edge.
- **Rounded** gives it margins on all sides and rounded corners so it floats like a tile. The tab bar also becomes a floating panel with the same margins and corners
  (window buttons at the right end inside it). With the status bar on top, the tab bar and status bar become a single two-row panel with no divider.

<a id="dock-layout"></a>
### Dock layout

Which window edge holds the launcher dock and which holds the side chat: **Launcher left · chat right** (default) or **Launcher right · chat left**.
They are always on opposite sides. Each opens when you hover its edge (see [Getting started](getting-started.md#3-find-the-hidden-docks)).

<a id="resource-rings"></a>
### Resource rings

Whether to show two rings for **this whole PC's CPU and memory** at the very front of the status bar's middle group. **On** by default.

- The numbers use the same basis as Task Manager (CPU = whole-machine usage, memory = used / total). Gray is the default, the warning color starts at 80%,
  and the error color starts at 95% (the same rule as usage rings). If agent usage rings exist, these stand after a thin divider.
- Hovering (or reaching them with the keyboard) shows a card: a large number · a line for the last 5 minutes · **Aynx's share** (the sum of the screen, session server and local tiles) and
  everything else · the top three consumers (tile name and the process using the most in that tile, including a row for the app itself).
- Pressing opens the **Resources view** (charts and row lists for the last 30 minutes for this whole PC, the app and local tiles), and pressing again closes it.
- If the session server is an older version or has no first sample yet (a few seconds after startup), the rings do not appear. If there are no sessions at all, the server stops
  measuring and the rings disappear after 30 seconds.
- When off, the rings do not appear and the status bar's share of sample pulls stops. The tile [resource chip](#resource-chip) and the Resources view stay as they are.

<a id="usage-rings"></a>
### Usage rings

Whether to show the **AI CLI usage limit rings** (Claude Code · Codex) in the status bar's middle group, after the resource rings. **On** by default.

- Hovering shows usage per limit window. Pressing opens the **Usage view**.
- When off, only the rings disappear. The Usage view stays available from the command palette (`Ctrl+Shift+P`).

<a id="tiling"></a>
### Tile placement

The rule that decides where a new tile goes. The default is **Spiral**.

- **Spiral (dwindle)** splits the most recently placed slot, winding inward in the order right → down → left → up.
  The last placed slot is split wherever the focus is.
- **Focus** splits the long side of the tile you are viewing.
- Layouts already open are left alone. It applies from the next tile you open.
- To choose the position yourself, drag a tile onto another tile (four quadrants), or pick a split from the tile menu.

<a id="tile-header"></a>
### Tile header

When to show the name tag and button row on a tile (tile menu · maximize · close). The default is **Always**.

- The header of a terminal tile (local shell, AI, SSH) shows a **folder chip** after the name (the last name of the current folder; pressing it opens that folder as a file
  tile, same as `Ctrl+Shift+O`) and a **branch chip** (the folder's git branch, or a short hash if detached; pressing it opens that project's
  branch tile). With no repository or an unknown branch, there is no branch chip. If the folder is unknown (tmux tile, or a shell without shell integration), the folder chip is a dimmed **Folder** and its tooltip gives the reason. When the chips do not all fit in the header,
  chips collapse before the name does. See [the order in which chips collapse](#header-chip-fold).

- **Always**: visible even with one tile.
- **2+ tiles**: hidden when there is one tile.
- **Hidden**: no header, shortcuts only. Close (`Ctrl+D`) and the maximize, SFTP and remote editing shortcuts still
  work, but tearing a tile out to a new window by dragging its header, and the tile menu, are unavailable.
- The tile menu contains split · Port forwarding… · Edit remote file… · AI access… ·
  Join broadcast input · Detach to a new window. Right-clicking the header opens the same menu.
- The header of a remote tile always shows the AI permission chip (the level name Off · Read · Ask · Auto · YOLO and a small gauge; when off, an empty gauge + dimmed **Off**). Pressing it changes the level and the headless connection on the spot. See [AI permission in host settings](hosts.md#host-ai).
  A remote tile not in the host list (quick connect) shows a dimmed **Off** chip that cannot be pressed. Its tooltip says "Save it as a host to give the AI access".
  Local tiles have **the same chip**: if reading is allowed, one bar + **Read**, otherwise an empty gauge + **Off**. If you would rather not see the chip, turn off the **AI permission** chip in
  [Tile header chips](#header-chips). Pressing it (or **AI access…** in the tile menu)
  shows the same gauge as "AI access for this tile", and a local tile can only choose **Off · Read**. Ask · Auto · YOLO are
  locked, because local tiles are not AI execution targets (only remote hosts are). The value you pick applies to that one tile only.
  However, **AI tiles** (local tiles running Claude or Codex) have no AI permission at all: there is neither a chip nor **AI access…** in the tile menu, and it is always off.
- Turn header chips on or off and reorder them in [Terminal › Tile header chips](#header-chips).
- Start screen tiles never get a header at any value.

<a id="resource-chip"></a>
### Resource chip

The **CPU · memory** chip in local tile headers (in the form `CPU 34% · 1.2GB`). It is **on** by default, and you turn it on or off together with the other chips in
[Terminal › Tile header chips](#header-chips) (when off, samples are not pulled either).

- The value combines the tile's shell and all processes under it. CPU is relative to this whole PC (the same basis as Task Manager),
  and memory is the sum of each process's working set, so shared memory can be counted more than once.
- Hovering the chip shows up to three of the busiest process names, and pressing it opens the **Resources view** (whole app, charts for the last 30 minutes),
  the same view as pressing the status bar [resource rings](#resource-rings).
- The session server measures every 2 seconds while any of the chip, resource rings or Resources view is visible, and every 10 seconds otherwise (it rests with no sessions). Remote (SSH) tiles do not
  have it. WSL tiles show only `wsl.exe` on the Windows side.

---

## Terminal

<a id="default-shell"></a>
### Default shell

The shell that **New terminal** (`Ctrl+Shift+N`) and the start screen open. It also stands at the top of the shell slot in the dock's launch panel.

- The list holds the shells actually found on this PC. At first, a shell suited to the OS is selected (Windows: PowerShell 7,
  or Windows PowerShell if it is not installed).
- **This is the only place that sets the default shell.** Other shells can be opened one at a time from the shell slot in the dock's launch panel,
  and opening them that way does not change the default shell.
- A changed value applies from the next terminal you open.
- **If the saved shell is not on this PC** (for example, you deleted a WSL distribution), the summary line says so and names the shell used instead.
  The setting is not deleted, so reinstalling that shell brings it back. The saved value changes only when you pick another shell here.

<a id="term-preset"></a>
### Theme

The palette inside the terminal (background, text, cursor, selection, ANSI 16 colors). It is chosen separately from the app theme. The list is grouped into **Dark · Light · My themes**,
and when the app colors come from a color theme, a custom color or the wallpaper, two more options stand at the very bottom:

- **Match color theme · Dark** and **Match color theme · Light** build the terminal palette from the same source color as the app, in a fixed brightness.
  They stay as chosen when you switch the app between light and dark, so you can keep a dark terminal in a light app (or the other way around).
- Picking a new color theme, custom color or wallpaper extraction keeps the brightness you chose and rebuilds the palette from the new color.
- Older versions had a plain **Match color theme** that followed the app's brightness. A setting saved with it moves to the fixed option of the brightness it showed last.

<a id="term-theme-import"></a>
#### Import

**[Import theme…]** on the theme row brings another terminal's color scheme into **My themes**. Choose a file or paste its contents, then press [Read].

| Format | Accepts |
| --- | --- |
| Windows Terminal | Color scheme JSON: one `schemes` element, that array, or the whole `settings.json` (comments and trailing commas are fine). If there are several, you pick from a list |
| iTerm2 | `.itermcolors` file |
| Ghostty | Theme file (`palette = N=#rrggbb` · `background` · `foreground` · `cursor-color` · `selection-background` …) |
| Alacritty | TOML (`[colors.primary]` · `[colors.normal]` · `[colors.bright]` · `[colors.cursor]` · `[colors.selection]`). The old YAML is not accepted; convert it to TOML with `alacritty migrate` |

- Background, text and the normal 8 colors are required. The rest is filled in: cursor = text color, text under cursor = background color, selection = text mixed
  25% into the background, bright 8 colors = normal 8 colors (slightly brighter on dark themes).
- The name comes from the name inside the file (`name` in Windows Terminal), or from the file name if there is none. You can edit it in the list before importing.
- After importing, the first theme is selected right away. Like other settings, it stays only if you press **[Save]**.
- My themes are not swapped for other themes when you change the app mode (brightness).
- Files live at `<config folder>/terminal-themes/<id>.json` (Windows: `%APPDATA%\aynx\terminal-themes`). A file of the same shape placed directly in this
  folder also appears in the list (names use only lowercase English letters, digits and `-`). Unreadable files are skipped.
- **Manage** (the pencil button on the theme row, only when you have my themes): a name changes as soon as you edit it (settings that selected it carry over). Removal
  asks for confirmation, and if it was the theme in use, the terminal goes back to **Aynx Dark / Aynx Light** matching that theme's brightness and saves. If a my theme held in a theme profile
  was removed, that profile is drawn with the Aynx of the same brightness.
- Import (file or paste) and management also work on the remote web screen. Files are read in that browser and only their content is sent.

<a id="header-chips"></a>
### Tile header chips

**On/off and order** of the seven chips in the tile header (Folder · Branch · Jump host · tmux · Forwards · Resources · AI permission). By default all are on,
in this order (the jump host comes before tmux because that is the connection path order, and AI permission is last because it is the chip that stands even when off). The one **AI permission** chip turns the AI chips of remote, query and local tiles on or off together. Chip text is English in every language: keywords before values are lowercase (`via bastion` · `tmux main` · `forward 3`), and words standing alone are capitalized (`Folder` · AI level names).

- The **AI read** chip of earlier versions (local tiles) was merged into the AI permission chip. Old settings are migrated automatically when read: if either of the two
  was on, the AI permission chip is on, and its position follows the AI permission chip's position (or the AI read chip's position if it had none). Settings that moved
  only the AI read chip return to today's default order.

- **Pressing** a chip turns it on or off. A chip turned off appears in no tile's header, and the AI permission chip is no exception (the level color and the mark for
  a released DB connection permission are hidden too; you can still see the permission under "AI access…" in the tile menu).
- **Dragging** changes the order. Dropping outside the row or pressing `Esc` returns it to its original position. With the keyboard, focus the chip and press `Alt+←/→`.
- **[Defaults]** resets both the order and on/off to the original.
- Only chips turned off are written to the file. If a new chip appears later, it stands on, near its default position.

<a id="header-chip-fold"></a>
**The order in which chips collapse**: the order here is the **importance** (earlier chips last longer). Chips collapse only when they really do not fit in the header:
a tile with only two chips stays as it is even when narrow, and a short name lets chips stay expanded longer.

1. If they do not fit, chips are reduced to just their picture **one at a time, starting from the last chip** (AI permission keeps only the gauge, Forwards keeps its picture and traffic dot, and Resources goes
   `CPU 34% · 1.2GB` → `CPU 34%` → picture).
2. If they still overflow with only pictures, chips are **hidden one at a time, starting from the last chip**, and a **+N** chip takes their place. Hovering +N shows the hidden chips'
   text, and pressing it shows a list of them. Pressing a row is the same as pressing that chip (Folder → file tile · Branch → branch tile ·
   tmux · Forwards → list · Resources → Resources view; Jump host is view only).
3. **The AI permission chip is never hidden, wherever you place it.** It collapses to the gauge at most.

Tile names keep at least about five characters (72px), and shorter names keep their own length. To avoid flickering at the threshold where chips collapse and expand,
they expand again only after a little room (16px) appears. When the buttons (⋯ ⤢ ×) are hidden on an unfocused tile, chips still collapse as if the buttons were
visible, so chips do not collapse and expand each time the mouse passes over a tile.

<a id="cursor-style"></a>
### Cursor style

The shape of the terminal cursor. The default is **Block**.

- **Block** fills the character cell.
- **Underline** sits below the character.
- **Bar** sits in front of the character.

<a id="term-webgl"></a>
### WebGL acceleration

Draws the terminal with the GPU (WebGL). On by default.

- Turn it off if the screen tears or flickers. When off, the DOM renderer draws instead (slower but safe).
- It attaches only to terminals in the visible tab.
- WebGL stays in use even when you lower Terminal opacity.

<a id="term-ligatures"></a>
### Ligatures

Draws symbol combinations such as `->` `=>` `!=` as one joined glyph. Off by default.

- If you have not set a terminal font, turning this on switches to a font that supports ligatures (Cascadia Code).

<a id="term-inline-images"></a>
### Inline images

Draws pictures that programs send as sixel or iTerm2 images inside the terminal. On by default.

- The output of tools such as `img2sixel`, `chafa` and `imgcat` appears as is.
- It applies to open tiles right away, and turning it off also removes pictures already drawn.
- File downloads (`inline=0`) are not accepted.
- Inside tmux they usually do not show (tmux does not pass them through).
- Pictures do not follow when you move a tab to another window.

<a id="right-click"></a>
### Terminal right-click

What a right-click does inside the terminal. The default is **Menu**.

- **Menu**: a right-click shows a context menu. It contains Copy · Paste · Select all · Clear screen together with the tile menu's
  items, and when opened over a link, Open link · Copy link address are added at the top.
- **Copy and paste**: selecting with a drag copies right away, and a right-click pastes.
- Either way, **Shift+right-click** does the opposite.

<a id="paste-confirm"></a>
### Paste confirmation

Asks once before pasting text with more than one line. On by default.

- Text containing line breaks can run as commands the moment it is pasted. The confirmation dialog shows the line count and the first three lines.
- It is the same whichever way you paste: right-click, `Ctrl+Shift+V` or `Shift+Insert`.

<a id="osc52-clipboard"></a>
### Remote clipboard write (OSC 52)

Receives what remote programs such as vim and tmux copy onto this PC's clipboard. On by default.

- The text a remote program passes with `OSC 52` is written to the clipboard as is.
- tmux only sends it with `set -g set-clipboard on`.
- **Requests in the other direction (reading the clipboard) are always refused, regardless of this switch.** If they were answered, any
  program running remotely could read this PC's clipboard.
- When off, that sequence is silently discarded (no escape fragments leak onto the screen).
- It works the same way in tiles without shell integration.

<a id="local-shell-integration"></a>
### Inject local shell integration

Plants hooks that report command blocks and the current folder when PowerShell, Git Bash or WSL starts. On by default.

- When a shell starts, a startup file (`integration.ps1` · `integration-gitbash.rc` · `integration-wsl.rc`) is passed as an argument.
  All of them are in the config folder, so you can open and read them at any time.
- These hooks report the start and end of commands (block history · `#` find · run time display · long command notifications · snippet suggestions while typing) and
  the current folder (the tile header's folder and branch chips). **Command history** in the command palette also collects only from tiles with these
  hooks on.
- When off, those shells also start with no hooks, like `cmd`.
- It applies from the next terminal you open. Tiles already open stay as they are.
- Shell integration on remote hosts is set separately in the per-host settings of Edit host.

<a id="inline-snippets"></a>
### Snippet suggestions while typing

Type two or more characters at the prompt and matching snippets appear next to the cursor. On by default.

- Choose with `↓` and insert with `Tab` / `Enter`. **It does not run.** It erases the characters you typed and places only the command in their position,
  so you press Enter after checking it.
- `Enter` and `Tab` before you choose from the list go to the shell as usual. `Esc` collapses the list for those characters only.
- It does not appear in tiles without shell integration (`cmd`, tmux simple mode), because that hook is the only thing that tells where
  the characters a person typed begin.

<a id="mark-after"></a>
### Show run time

Writes the time taken (for example, `12.4s`) at the right end of the line for commands that took longer than the set number of seconds. The default is 3 seconds, and 0 turns it off.

- Commands that finish faster get nothing attached, whether they succeeded or failed, so a screen full of fast commands does not become a pattern.
- Failed commands are distinguished by a red strip and a red time.
- Hovering the red strip or the time marker shows the exit code, start and end times, and the full command.
- The marks sit over the screen text rather than being part of it, so they do not come along with copying or selecting.
- A change applies from the commands that finish after it. Markers already drawn stay as they are.
- It works only in tiles with shell integration.

<a id="bell"></a>
### Bell

The reaction when the shell sends a bell (`\a`): **Visual (border flash)** (default) · **Visual + sound** · **Off**.

- The tile's border briefly turns the accent color.
- On a tab you are not viewing, a small ring stays next to the tab name and disappears the moment you view the tab.
- The sound is one short blip generated in code (there is no audio file).
- Consecutive bells flash at most once per 0.25 seconds per tile.

<a id="logs-folder"></a>
### Session logs folder

The folder where records from hosts with session logging on are kept.

- Logging is **off by default** and is turned on per host (Edit host › Session logging).
- Log files contain control characters exactly as they arrived, so the app does not read them for you. Open them in an editor.
- For the log of a single tile, that tile's ⋯ › Output › **Open session log** opens it directly.

---

## Snippets

<a id="snip-lead"></a>
### Snippets

Save frequently used commands under a name and insert them into the focused terminal tile. They go out the same way as what a person types on the keyboard.

- **Asking fields**: writing `{{name}}` in a command asks for that value at the moment of inserting. The same name is asked once and goes into every
  position.
- **Default and description**: write them as `{{name=default|description}}`. The field opens filled with the default, and the description appears below the
  field. The only break points are the first `=` and the first `|`, so a default cannot contain `|`. If you leave a field empty and insert, that position
  becomes an empty string.
- **Run as soon as it goes in** (Enter): when on, Enter (`\r`) is appended so it runs right away. When off, only the text is placed on the command line, and you press Enter yourself
  after checking it. Turn this off for things you want to look at once more, such as commands that delete.
- **Scope**: when set to a specific host, the snippet appears and goes in only while an SSH tile with that alias is focused. Local shells have no
  alias, so host snippets do not apply there.
- The snippet list is saved separately in `snippets.json`, not `settings.toml`. Regardless of the settings screen's [Save]/[Cancel], it is
  kept the moment you press [Add] · [Save] · [Delete].

**List (summary).** Each row shows a name, a scope chip (plus a `No Enter` chip for those with Enter off), the start of the command and a description. Pressing a
row (**Edit ›** at the end of the row) moves to that snippet's **edit screen**. **[Insert]** on the right of a row inserts that snippet into the focused
terminal right away (the same path as the shortcut and palette; if settings are open as a dock, it goes into the tile behind).

**[Add snippet ›]** (top right) moves to the **add screen**. It is a sub-screen like Triggers and Auto-approval, so **‹ Snippets** above
or `Esc` returns to the list (one `Esc` goes to the list, and another closes the settings window). Moving to another section
or closing the settings window discards the fields you were filling in.

- **Fields**: Name (60 characters) · Command (4000 characters, multiple lines allowed) · Description (optional, 200 characters) · Scope · Enter (Run as soon as it goes in). If the name or
  command is empty, [Add] is dimmed, and trying to press it shows a red line under the field. At 200 snippets, [Add] is dimmed and the reason appears beside it.
- **Preview**: each asking field in the command gets a value field filled with its default. If you enter a test value, the line below changes to the text
  that would go out to the terminal (with `⏎` at the end if Enter is on). Nothing is sent, and the test values you enter are not saved.
- Pressing **[Add]** puts the snippet at the top of the list. **[Cancel]** adds nothing.

The **edit screen** is the same screen, with **[Delete]** (asks once) · **[Cancel]** · **[Save]**. Until you press [Save], edited
fields are not reflected in the list. Snippets have no example cards like triggers do.

---

## Triggers

<a id="trg-lead"></a>
### Triggers

Adds a **Highlight**, **Link** and **Tooltip** to the parts of terminal output that match a regular expression. All three can be on for one trigger
(for example, a red background + a description tooltip + a wiki link on an error code).

- **Highlights do not apply retroactively.** Editing the list removes the highlights now lit on screen, and new rules apply from subsequent
  output. Lines already past are not recolored.
- **Links and tooltips check only the line you hover, on the spot.** So they also work on past lines and on top of full-screen
  programs such as `vim` and `less`.
- **Captures**: link URLs and tooltip text can contain `$0` (the whole match) · `$1` · `$2` … (parenthesized captures in the regular expression).
  Write a literal `$` as `$$`.
- Captures going into a URL are URL-encoded automatically, so text from a remote cannot swap the address's scheme or host.
- Links open with `Ctrl+click` (`⌘+click` on macOS). In the terminal, a plain click is selection and focus. Only `http` · `https` ·
  `mailto` are passed to the default browser.

**List (summary).** Each row shows an on/off switch, a color sample, the pattern and what it does (Highlight · Link · Tooltip). Pressing outside the switch
(**Edit ›** at the end of the row) moves to that trigger's **edit screen**. When triggers overlap, the one higher in the list wins.

**[Add trigger ›]** (top right) moves to the **add screen**. It is a sub-screen like Auto-approval's [Edit ›], so **‹ Triggers** above
or `Esc` returns to the list (one `Esc` goes to the list, and another closes the settings window).

- **Start from an example**: "Blank trigger" and the 14 examples below are cards. Picking a card fills the rule fields below with that example,
  and puts one line of matching output in the test field. Cards whose pattern is already in the list get a ✓ but can still be picked.
- **Rule**: Pattern (regular expression, case-sensitive) · Colors (Text · Background, each cleared with ↺) · Link (URL template) · Tooltip (text template).
  There is no separate switch for each kind: any color makes it a highlight, and a non-empty link or tooltip field turns that kind on.
  An invalid regular expression shows a red line under the field and dims [Add]. An address a link will not open (a relative address, `file:` and so on) is reported
  with a yellow line.
- **Try it**: paste output lines (several lines are fine) and it shows right away where the current rule matches, in the same colors as the terminal.
  Below that, links expand to the address that would really open, and tooltips to the resulting text. Nothing is opened.
- Only pressing **[Add]** puts it at the end of the list, **turned on** (until then it has no effect on the terminal). At 50 triggers,
  [Add] is dimmed and the reason appears beside it. **[Cancel]** adds nothing.

The **edit screen** is the same screen without the example cards, with **[Delete]** (deletes right away) · **[Cancel]** · **[Save]**. Saving leaves
on/off as it is. Either way, changes are kept in the file by the settings window's [Save], like other settings.

Examples (tooltip text is a value written to `settings.toml`, so it is in English):

- `FATAL` · `PANIC` · `CRITICAL`: dark red background
- `FAIL` · `FAILED` · `FAILURE`: red text
- `PASS` · `PASSED` · `SUCCESS` · `SUCCESSFUL`: green text
- `DEPRECATED` · `deprecated`: yellow text
- `npm ERR!`: red background
- Python `Traceback (most recent call last):`: red background
- Kubernetes pod failure states (`CrashLoopBackOff` · `ImagePullBackOff` · `ErrImagePull` · `OOMKilled` · `Evicted`): red background
- `HTTP/1.1 5xx`: red background + tooltip "Server error 503"
- `HTTP/1.1 4xx`: brown background + tooltip "Client error 404"
- Rust error code `E0308`: tooltip + link (explanation page on doc.rust-lang.org)
- `CVE-2024-3094`: tooltip + link (NVD detail)
- `ERR-1234`: brown background + tooltip "Error code ERR-1234"
- IPv4 address: muted blue-gray text (informational)
- Issue keys such as `ABC-123`: Jira link template. Change the address `jira.example.com` to your own Jira

---

## MCP

The **MCP** menu of the settings window manages the server list and which targets to load on the next agent launch.
The AI agents menu holds CLI install status, the start folder, hooks, launch options and extra arguments.

The session server selection and the external server list are saved or reverted with the settings window's **[Save]·[Cancel]**, along with the other options.
Escape, the backdrop and the close button close the settings window. On a server add or edit screen, Escape first returns to the list.
Just closing keeps the draft for the next time you open it, and [Cancel] goes back to the last saved values.

<a id="ai-mcp-servers"></a>
### MCP servers

The fixed row at the very top is the **Aynx session server** (`aynx-sessions`, dev build `aynx-sessions-dev`). It has an **app-wide** scope.
Choose its use switch and the Claude Code · Codex target chips, then press [Save], and the change applies from the next launch.
It cannot be edited or deleted, and turning the server off keeps the target selection. It loads only into local AI tiles that receive an MCP token, and into `claude` · `codex` typed by hand in local
PowerShell · Git Bash tiles with shell integration on (each tile receives its own token).
It does not load into CLIs started from terminals or IDEs outside the app, or into SSH or WSL.
This server is run by the background **session server** process. Even if all app windows close or the app quits, the CLIs of live AI tiles keep reading sessions at the same address, and task plans already approved run to the end (a person's approval happens in the app; pre-set policy auto-approval is run by the session server even while the app is closed). Pressing [Restart] on the session server changes the address and token (sessions end along with it).
After an update, existing user-scope global registrations are removed at app startup, for this instance's current and old names only.
Tokens are not written to user CLI settings. Claude uses a header in a launch JSON in the app data folder, and Codex uses that tile's
token environment variable. Launch JSON files from earlier processes are cleaned up at the next app startup.

External MCP servers such as Playwright and filesystem are added, edited and deleted by name, type and command/URL.
**[Add MCP server ›]** (top right) moves to the **add screen**, and pressing an external server row (outside the switch and chips; **Edit ›** at the end of the row) moves to that server's
**edit screen**. It is a sub-screen like Triggers, Snippets and Auto-approval, so **‹ MCP** above or `Esc` returns to the list
(one `Esc` goes to the list, and another closes the settings window). Add has [Cancel][Add], and edit has [Delete][Cancel][Save].
Fields enter the list (the settings draft) only on [Add]/[Save], and they are kept in the file by the settings window's [Save]. The fixed row (session server) has no
edit screen.
The **Use** switch in the list and on the add and edit screens turns the server itself on or off, and rows turned off are dimmed.
The Claude Code · Codex chips choose only the **targets to load into**. Turning a server off keeps the target selection, and the chips remain editable.
New servers are on by default, and existing entries with no target information appear with both chips selected.
The list shows all external servers together, and a chip next to the name shows **All projects** or a project name.
App-wide entries come first, and project entries follow in project name order. The scope is chosen on the add and edit screens, either
**All projects** or a registered local project, and a new server's default scope is app-wide. App-wide entries apply to all
projects, and if a project entry with the same name exists, that whole entry takes priority. If you turn a project entry
off, the app-wide entry with the same name does not apply in that project either. Project settings also apply to subfolders and
that repository's worktrees. Existing entries stay app-wide. **After [Save], changes apply from the next launch of local Claude Code ·
Codex that Aynx starts**, and conversations already open are not changed retroactively. `claude` · `codex` typed by hand in local PowerShell ·
Git Bash tiles with shell integration on receive the same MCP, extra arguments and `--no-daemon` as those the app launches (from new tiles;
open tiles keep the settings from when they opened). Commands typed by hand in SSH, WSL and cmd tiles, and tiles with shell integration off, do not get them (for remote, see the host's
agent enablement in [hosts](hosts.md)).

On the add and edit screens of a **stdio** server, you can add, change and delete environment variable names and values. Enter what a PostgreSQL MCP
requires, such as `DATABASE_URL`, here. It is saved only if you agree to **Save environment values encrypted in the vault**,
and the values are held only in the encrypted vault. The settings file keeps only a reference, and values are passed only to the MCP server process.
A newly created vault has no master password, and you can add one under Settings → Security. A locked vault must be unlocked first before you can
save new values or start an MCP server that has environment variables.

On an **HTTP** server, you can add header names and secret values (up to 32). Authorization, X-Api-Key and the like are
saved by agreeing to **Save header values encrypted in the vault**. Environment variables are for stdio only, and headers are for HTTP only.
Transport and MCP session headers, and duplicate names differing only in case, cannot be used, and values cannot contain line breaks or NUL.
The proxy inside the app adds header values per request, and the CLI receives only a loopback URL and a ticket.
An HTTP server with no headers connects directly to its existing URL. OAuth login and the old SSE transport are not supported.
After the vault locks, the server settings change or the app quits, existing HTTP tickets cannot be reused. Launching again gets a new ticket.
The detailed boundaries are in the [HTTP header record](../log/2026-10-04-mcp-http-header-proxy.md).

Saved environment variable and header values are not shown again. Leaving the value field as it is keeps the existing value, and entering a new value replaces it.
Settings [Cancel] goes back to the last saved reference, so the value before replacement is also kept. Deleting an environment variable row or a server
stops it from applying from the next launch. When saving settings succeeds, unused values in a vault that is already open are also cleaned up.
Saved values of servers that are off, values referenced by launch tickets, and new values not yet saved to settings are kept.
A locked vault is not opened just to clean it up. Before saving, previous values are not deleted, so you can go back with [Cancel].
A canceled new value remains during this process, and it is cleaned up if you save settings with the vault open after restarting the app.
You can also delete values separately from the Security menu. HTTP servers do not
get process environment variables.

These are read along with user-global servers, so it is clearer to use a name different from existing servers. Turning off an external row stops only the app's injection
and does not turn off a global server already registered in the CLI.

Pressing expand (⌄) on the **Aynx session server row** at the top of the list shows the server's running state and endpoint URL.


---

## Instructions

<a id="instructions-list"></a>
Settings › **Instructions** manages the markdown instructions that Claude Code and Codex read, in one place.
Use **Add instruction ›** or **Edit ›** in the list to set the name, description, scope and body.
The description becomes the `##` heading inside the managed block, and the name is used if it is empty.

<a id="instructions-add"></a>
Add, save and delete, as well as the list's on switch and target chips, **save immediately** to
`<config root>/instructions/<name>.md`. They are unrelated to the settings window's [Save]·[Cancel].
Delete really removes the library file with no confirmation. Content still in agent files is removed on the next [Apply].

- **Global**: writes to the chosen agent's home file. For Claude it is `$CLAUDE_CONFIG_DIR/CLAUDE.md` (or `~/.claude/CLAUDE.md` if unset),
  and for Codex it is `$CODEX_HOME/AGENTS.md` (or `~/.codex/AGENTS.md` if unset).
- **Project**: writes an `AGENTS.md` managed block in every worktree of the chosen local or remote projects.
  All agents read the same body, so project entries do not distinguish agents.
  If `CLAUDE.md`·`.claude/CLAUDE.md`·`CLAUDE.local.md` already exist, an `@AGENTS.md` import is written in the managed block of
  `CLAUDE.md` as needed. If none of the three exist, `CLAUDE.md` is not created.
  Project entries pointing at the same worktree or subfolder are combined as a union, once each. WSL paths are skipped in the preview.

### Subfolder instructions

In a project scope's **Subfolder (optional)**, enter a path relative to the repository, such as `packages/api`.
Leave it empty for the repository root. `\` is normalized to `/`, and leading and trailing `/` are removed.
It must be 200 characters or fewer and cannot contain empty path segments, `.`, `..`, drive letters, `:` or control characters. It cannot be set for global scope.
In the library it is saved as `  subprojectPath: "packages/api"` under the rulesync-compatible `agentsmd:`.

Entries with the same subfolder are combined into `<worktree>/<subfolder>/AGENTS.md` in each worktree.
If the subfolder does not exist, it is skipped with **The subfolder does not exist** and the folder is not created. The same rule applies to local and SSH.

| Tool | When subfolder instructions are read |
| --- | --- |
| Claude Code | Read as needed when working with files in that subfolder. This holds even when run from the root. |
| Codex | Reads `AGENTS.md` from the repository root down to the launch folder (cwd). It must be launched in that subfolder or below it. When launched from the root, subfolder instructions are not read. |

For Claude, Claude instruction files higher up can shadow a subfolder `AGENTS.md`.
If any folder from the subfolder up to the worktree root has `CLAUDE.md`·`.claude/CLAUDE.md`·`CLAUDE.local.md`,
an `@AGENTS.md` managed block is ensured in that subfolder's `CLAUDE.md`. If the same import line already exists outside the block, it is not added.
If that path has no Claude files at all, `CLAUDE.md` is not created.

If you turn off or delete an instruction or change its subfolder, the next apply also removes the managed block of the old subfolder.
This does not scan the repository. It uses the project id and written subfolder set in `<data root>/instructions-written.json` (roots and bodies excluded).
If a full apply removed the blocks from all worktrees, the record is cleared. On an error or no connection, the record stays for the next apply.
A missing folder does not block cleanup. A single apply to a new worktree also includes subfolders, while removal from the record is confirmed only on a full apply.

### Remote (SSH) projects

Project instructions can also choose remote projects. **An SSH tile connection to that host must be open at preview and apply time.**
Aliases ignore case, and if there are several connections, the interactive connection with the smallest session id is borrowed.
With no connection, only that project is skipped, and a reason is shown telling you to open a tile and preview again.
No new or headless connection is created, and no password or vault access is requested.

Worktrees are listed through remote git (excluding bare), and if that fails, the one registered project path is used.
`~` is relative to the SFTP home, and reading, existence checks and writing are done over SFTP. Missing project or worktree folders are not created.
The managed block and line endings of existing files are preserved, and permissions and ownership are kept on replacement. If a file cannot be replaced, it is written in place.
New files use LF and the server's default permissions. The time limit per project is 20 seconds, and other projects keep being processed even after an error.
On a timeout or disconnect, some files may already have been applied, so check the state with another preview.
The list shows the project name and host alias, and files under home appear as `~/…` paths.
**Global means only the home files on this PC. The global files of remote hosts are not written.**

<a id="instructions-import"></a>
**Import ›** chooses global or a local project and copies candidates from existing files into the library.
Global reads the home files of Claude and Codex, and a project reads `AGENTS.md`·`CLAUDE.md`·`.claude/CLAUDE.md`·
`CLAUDE.local.md`·`.rulesync/rules/*.md`. Remote projects cannot be chosen yet.
It imports the body with release and dev managed blocks stripped out, and files with only a block do not appear as candidates.
Files with broken markers appear as rows that cannot be selected, along with the reason.
Choose checkboxes and names, expand a body to check it, then press **[Import]**. If one row fails, the other candidates keep being saved.

**Importing makes a copy.** The original file keeps its content, so applying adds the same content again inside the block.
To avoid duplicates, remove it from the original or turn off the imported instruction.

<a id="instructions-apply"></a>
**Preview · Apply ›** shows the action and reason per path. Expand a row to check the new block, then press **[Apply]**.
Unchanged files are collapsed into a count, and you can apply only when there is a file to create, change or delete.
Check the error rows in the apply results, and use **Preview again** to read the current file state.

The app manages only what is between the `aynx:begin`·`aynx:end` comments (`aynx-dev` for dev builds).
Content outside the block is preserved, and **the inside of the block is overwritten**. Files with broken markers stay as errors and are not fixed.
Instructions turned off or deleted drop out of the managed block on the next apply.
Whether to commit to the repository or exclude with `.gitignore`·`.git/info/exclude` is up to you, and the app does not operate git.
It does not apply to agent conversations already open; agents read it **from the next launch**.

For a **new local worktree**, the project's enabled instructions are applied automatically right after creation, before tiles and agents open.
Only the one new worktree is written, and the repository's main folder and global files are left alone. With no enabled project instructions, nothing is written.
A local apply failure appears as a warning notification, and the worktree still opens.
A **new remote worktree** is also applied automatically after a successful add and before the agent's first input, on that one worktree through that tile's connection.
Only enabled instructions of registered projects matching the host alias and repository path are written, and a failure leaves one log line while preparation continues.

## Auto-approval

These are the rules by which the app approves AI-made task plans in place of a person. Approval and execution always take place only inside the app, and the AI cannot reach approval.

<a id="auto-approve"></a>
### Auto-approval

When on, the app automatically approves task plans that meet **all** the conditions below. If even one does not hold, a person approves it directly, as before.

The five conditions (in addition, each target host's **AI permission must be Auto** (or YOLO); see [AI permission of a host](hosts.md#host-ai-stage)):

1. This switch is on.
2. It is not a dangerous command (`rm`, `sudo`, redirects and so on are excluded).
3. It has no pipe (`|`, unless **Allow pipes (|)** is on and every stage is allowed), redirect (`>` `<`), substitution (`$`, backtick), subshell (`(` `)`) or background (`&`).
4. It matches the **Allow patterns** below (rules and simple patterns), or the rules of a **bundle** that is on.
5. The number of targets is within the limit.

- The **session server** does the judging and approving, so this runs even with no app windows or with the app closed. The same task plan is tried only once, and a task plan whose
  review panel is open now is skipped. A refusal reason stays on that task plan's review card.
- Commands joined with `&&` · `||` · `;` must pass the conditions above **segment by segment**. For example, `df -h && free -m` is auto-approved only if both are
  allow patterns. `cd` does not pass either unless it is on the list.
- `&&` inside quotes is taken as literal text.
- Bundles delegate **reads only**. They work like an allow list, so each command matches only its allowed subcommands and arguments, and everything else goes to a person.
  Rules check **down to the arguments**. For example, 'Network' passes `ip addr` · `ip addr show` but
  hands over `ip addr del …` · `ip link set … down` · `ss -K`. 'Logs' hands over `journalctl` with `-f` (following), `--vacuum-…` or
  `--rotate` (deleting, rotating), and `dmesg` with `-C` · `-c` (clearing). `git branch -D x`, `date -s …` and
  `mount /dev/sdb1 /mnt` also need a person's approval.
- `ip` in 'Network' passes `ip addr` (also the short `ip a` and `ip address`), `ip route`, `ip link` and `ip neigh` **for viewing only**
  (when the next word is `show` or `list` or absent; `ip neigh get` sends a probe, so it needs a person's approval).
  'Git queries' includes `git ls-files`, `git blame`, `git shortlog` and **list-only** `git tag` (no arguments, or `-l` · `--list`
  with a pattern). `git tag v1` (creating), `-d`, `-a`, `-f`, `-v`, and `git blame --contents …` and
  `git ls-files --exclude-from=…`, which read arbitrary files, need a person's approval. `git config --get` and `mount -t` are not in any bundle.
- There are ten bundles (Server state · Data reads · Network & infrastructure · Development). **[Edit ›]** on the summary row opens the 'Edit bundles' screen.
  You can turn bundles on and off, expand them to turn off **commands one by one** (even in a bundle that is on, that command then needs a person's approval), and enter a command in the **Try a command** field above
  to see the real verdict and its reason (the command does not run). The dim text beside each command is its limit
  (`except -f · --follow …` · `no arguments`). `Esc` or `‹ Auto-approval` returns.
- A subcommand in a bundle rule must come **right after** the executable. `git -C /srv status` and `kubectl -n ns get pods` go to a person
  (written as `git status` and `kubectl get pods -n ns` they pass).
- If you had the old 'read-only diagnostics' or 'Git queries' on, they are migrated to the new bundles, but commands that did not exist before are migrated **turned off**.
- Auto-approval is also recorded in the audit log, as `auto`.

<a id="auto-allow"></a>
### Allow patterns

This is the auto-approval scope you set yourself, outside bundles. The summary row reads "N rules · M simple patterns", and **[Edit ›]** opens the 'Edit allow patterns'
screen (the **Try a command** field at the top is the same as in Edit bundles; its verdict reflects bundles, rules and simple patterns together).

- The list shows both kinds together, marked 'Rule' / 'Simple'. Choose a row to edit it in the form below. Add with **[+ Rule]** · **[+ Simple pattern]**
  (it goes in only when you press **[Add]**), and remove with **[Delete]**.
- **Simple pattern**: a command starting with this text (at a word boundary) becomes a candidate. `df` matches `df -h` but not `dfx`. Arguments are not checked.
- **Rule**: Command (executable name) · Subcommands (several, separated by commas or spaces) · **Subcommand is the next word** (new rules start with it on) ·
  Next word only · Argument limit (empty means no limit, `0` = no arguments) · Denied flags · Allowed flags only · Required flags. Hover a field name
  for a description. **Preview** below the form is that rule's summary (`journalctl · except -f · --vacuum-*`).
- Invalid values (an empty command, a command containing spaces or a path, denied/allowed/required flags that do not start with `-`, a denied flag with `*` not at the end,
  a subcommand starting with `-`) are reported in one line under the field and are not applied until fixed.
- A rule with neither subcommands nor argument limits can be saved, but it gets the warning "This command is auto-approved whatever its arguments."
  Dangerous commands such as `rm` and `sudo` are **always excluded**, even with a rule.
- Old hand-written rules (only `exec` and `subcommands`) are shown with their meaning unchanged: 'Subcommand is the next word' is off, and the list says
  "flags allowed before the subcommand". Only the fields you edit change.
- Like other settings, values are a preview: they are written to the file only when you press **[Save]**, and **[Cancel]** reverts them.

<a id="auto-max-targets"></a>
### Target limit

The maximum number of targets (hosts) one task plan can have. The default is 10.

- A task plan with more targets than this is **refused at approval itself**. This boundary applies not only to auto-approval but also to a person's approval.
- The app's internals (backend) enforce it at the approval stage, so a large task plan cannot run by mistake.

<a id="auto-max-concurrency"></a>
### Concurrency limit

The maximum number of targets running at once within one task plan (manual and automatic alike). The default is 4.

- A task plan first runs one target (canary), and if that succeeds, runs the rest this many at a time.
- Like the target limit, it is a boundary that the app's internals enforce.

<a id="audit-output-excerpt"></a>
### Save run output excerpts

When on, the tail of the run output for each target is left in the audit log file when a task plan run finishes. **Off by default.**

- What is kept: the last 40 lines of stdout and stderr (up to 4 KB per stream). They appear in the details under Plans › History.
- The file is written under `audit` in the data folder **without encryption**. Remote output can contain secrets such as passwords and tokens,
  and this file is outside the vault, which is why this is off by default.
- Output from targets with AI read sharing turned off is not written even when this is on.
- When turned off, it stops writing from subsequent runs. Excerpts already written disappear when that date's file is deleted after the retention period.

---

## Notifications

<a id="notify-after"></a>
### Long command complete

Notifies you when a command that took longer than the set number of seconds finishes **somewhere out of view**. The default is 10 seconds, and 0 turns it off.

- A command that finishes in the tile you are viewing does not notify (the screen already shows it).
- If it finishes in another tab, an in-window notification appears with [View].
- If the window has lost focus or is minimized, it goes to an OS notification. It asks for permission once, the first time, and falls back to in-window notifications if you refuse.
- It works only in tiles with shell integration (OSC 133). In tiles with no hook (`cmd`, tmux simple mode), the start and end of commands cannot be known.

<a id="osc-notify"></a>
### Program messages (OSC 9 · 777)

Shows notifications that programs such as builds and tests send with terminal sequences (OSC 9 · OSC 777). On by default.

- If the tile is visible and the window is in front, it appears as a toast. Otherwise it appears as an OS notification.
- The notification title is always the app and tile name, and a title given by the program goes at the start of the body.
- One tile shows only one notification every 2 seconds, and the rest are discarded.
- There is nothing to press on it (no links or actions).
- When off, sequences are silently discarded. It works the same way in tiles without shell integration.

---

## Security

<a id="vault-state"></a>
### Vault status

The app's own **vault**, which holds passwords and key passphrases. This row shows the current state (No vault · Locked · Vault open, and the number of items).

- The vault is opt-in. It is first created when you turn on [Save in this app (vault)] in a connection dialog or set a master password here.
  If you do not turn it on, a password is used once and discarded, and the next connection asks again.
- The vault is one file (`vault.bin`) in the app's config folder and is encrypted as a whole.
- Stored values are used only inside the app (Rust). They do not come out to this screen or through the AI integration (MCP). What you can see on
  screen is only the kind and target of each item.
- **It locks at the same moments as the privacy veil**: Auto-lock when idle · the veil shortcut (`Ctrl+Shift+B`) · quitting the app.
  There is no separate vault auto-lock field. With Auto-lock when idle off, it stays open until you cover the screen by hand or close the app.

<a id="vault-master"></a>
### Master password

The password that opens the vault. **It is optional.**

- **Without one**, your account on this PC is the key. Anyone signed in as this account can open the vault, and lifting the veil
  opens it with one press of Enter (this is a confirmation gate, not protection).
- **With one**, the key that opens the vault disappears from disk, and it is asked once while you use the app (and every time you lift the veil).
- **If you forget the master password, the stored values cannot be recovered.** In that case, delete everything in the vault and store it again.

<a id="security-ai-hosts"></a>
### Hosts with AI access

The list of hosts given AI permission (`~/.aynx/delegation.toml`). Each row shows **one level chip** (Off · Read · Ask · Auto · YOLO) and **two headless chips** (Headless connection · Vault passphrase).

- Here you can only view and delete them. To change them, use the **AI access** tab of the host settings ([Host settings…] opens that tab) and the permission chip in a
  remote tile's header. See [AI permission of a host](hosts.md#host-ai).
- Permission applies **to the tiles a person opens and to headless sessions together** for that host.
- A row with an alias not in `~/.ssh/config` is marked "Not in config — needs tidying". It will never connect, so delete it.

<a id="lock-idle"></a>
### Auto-lock when idle

At the end of the Security section (it used to be under General › Privacy).

Brings down the **privacy veil** when there has been no key press, click or scroll for the set time. **Off by default.**

- The veil blurs the screen so terminal output cannot be read over your shoulder while you are away. Sessions keep running behind it.
- When the veil comes down, **the vault locks with it.** Lifting the veil is what opens the vault: if you set a master password
  you type it, and if you did not, you press Enter once.
- To cover the screen right now, press the veil shortcut (default `Ctrl+Shift+B`).
- A short time covers the screen as soon as you leave, but it can also blur while you are only reading for a moment. Pick a time that fits how you step away.

<a id="remote"></a>
## Remote access

The controls for the **remote web client**, which opens this app from another PC or phone browser over Tailscale. The **status line** at the top states the current stage: Remote access off · Not connected yet · Connected · waiting to pair · Remote access in use ·
Gateway closed and so on (it counts as connected only when `tailscale serve` points at this app and the app is listening). Chips appear only when something is wrong. Four expandable cards follow, and only one is open at a time. Before connecting, the Remote access card starts expanded; otherwise all start collapsed.

- **Remote access** — Head: the address to open · [Copy] · on/off toggle. Body: **Tailscale connection** ([Connect] finds the name, starts `tailscale serve`, turns remote access on and saves, in one step · [Stop serve]) · MagicDNS name · port ([Save]).
- **Paired devices** — Head: number open · total · [Disconnect all]. Body: rename · revoke.
- **Recent activity** — Head: the latest line (and the number of failed unlocks, if any are among the 12 most recent shown). Body: the list.
- **Setup guide** — After connecting (the address to open · Funnel warning) · Security checklist (two-factor authentication, device approval, a policy example) · Set up manually (the `tailscale serve` command).

Connecting, on/off, name and port can be changed only on the main PC, while turning it off also works remotely. Without a master password,
the status line states, while it is on, that paired devices open without a password. For the setup steps and limits, see the [remote access guide](remote-web.md).
