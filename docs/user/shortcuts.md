# Shortcuts guide

Aynx's shortcut help (`Ctrl+Shift+/`) shows only keys and gestures, one per line. The circumstances and exceptions that screen leaves out are written
here. The combinations below are defaults — ones you changed in Settings › Shortcuts appear as changed on the help screen.

**Ways to open it**

- `Ctrl+Shift+/` · 'Shortcut help' in the command palette.
- A single **`?`** also opens it. But in terminal tiles, input boxes and fields being edited, it is just a character.
- `Esc`, clicking outside, or pressing the opening key once more closes it.

**What can and cannot be changed**

- The Tabs, Tiles, Open and App groups, and the top four rows of the Terminal group, are changed in Settings › Shortcuts ([Change in settings] in the help header opens
  that screen).
- The rest (`Ctrl+D` · `Enter` · paste · the selection and clipboard keys in file tiles · mouse gestures) follow convention and are fixed.

---

## Tabs

- Projects appear in every workspace. Enter on a project or worktree moves to its existing location or opens it as a tab, and Ctrl+Enter opens it as a tile in the current tab.
- Tabs are saved to the current workspace automatically. `Ctrl+Shift+G` picks a workspace. Sessions already open keep running when you switch.
- `Ctrl+PageDown` · `Ctrl+PageUp` move straight to the next and previous workspace (in the order of the workspace list in the tab bar, wrapping from the end to the start). With only one workspace, nothing happens.
- The app intercepts these two keys inside terminals too — if you need `Ctrl+PgUp/PgDn` for tab switching in terminal vim and the like, move them in Settings › Shortcuts.
- Right-click a row in the workspace list at the very front of the tab bar → **Edit…** · **Delete workspace…** (the menu key and `Shift+F10` do the same), or press `F2` on the row to change its name, icon and color (main window only).
- In that list, drag a row to reorder it at the insertion line (main window only). `Esc` cancels, and a click with only slight movement switches workspaces.
- With only one workspace, Delete in the menu and palette is disabled, and the tooltip gives the reason. For a new workspace, enter just a name in **New workspace…** at the end of the list.
- Old layouts move to workspaces on first run. The old save feature on Ctrl+Shift+S has been retired, and the browser's action on it is blocked (Ctrl+Shift+K is now the DB dock).
- **Broadcast input** (`Ctrl+Shift+I` · tab menu) sends the same input to all tiles in this tab. `Ctrl+click` (or the tile menu) takes
  tiles out and puts them back — input goes only to tiles with a border, and a tile taken out receives only its own input. With only one tile, split it or
  drag and drop a host to add more. While it is on, a banner stands above the body, and the only way to turn it off is the same toggle.

## Notifications

- `` Alt+` `` (Go to notification) does the same as [View] · [Go check] on an agent notification banner — it goes to that tab, focuses the tile and resolves the notification.
- Among remaining notifications, **permission questions come first**, and within the same kind, the most recent comes first. Going there resolves it, so pressing again goes to the next notification. Notifications set aside with × ("New" in the dock's Alerts section) are included.
- With no notifications left, nothing happens. The app intercepts it inside terminals too (`` Alt+` `` does not reach the shell). On a Japanese layout it overlaps with the IME switch key, so move it in Settings › Shortcuts.

## Dock

- The launcher dock's sections — Alerts · Hosts (`Ctrl+Shift+H`) · Projects (`Ctrl+Shift+J`) · DB (`Ctrl+Shift+K`). With focus on the section bar at the top,
  `←` · `→` (and `Home` · `End`) move between sections.

## Tiles

- **Move** detaches the tile, splits the space in that direction in two and inserts it again (the same as Hyprland dwindle's `movewindow`). If the adjoining neighbor is a single tile,
  the two swap places.
- **Resize** pushes the nearest split line on that axis in the arrow's direction (the same as `resizeactive`). Holding the key keeps it moving.
- Tiles with no session (hosts · files · settings · documents) also close with `Ctrl+D`.
- An empty tab (start screen) cannot be split — open something first.
- Splitting in a chosen direction, port forwarding and detaching to a new window are in the tile menu (the menu button in the header · right-clicking the header).

## Terminal

- `Ctrl+D` sends EOF to the shell. Pressing it once more on a tile whose shell has exited closes the tile, and `Enter`
  reconnects.
- The meaning of right-click is chosen under Settings › Terminal › **Terminal right-click**. With 'Copy and paste', selecting with a drag is the same as copying,
  and right-click pastes. `Shift+right-click` always does the opposite.
- Pasting multiple lines asks once — turn this off in Settings › Terminal › **Paste confirmation**.
- `Ctrl+click` opens both trigger links and automatically detected URLs.
- The app intercepts `Ctrl+F` · `Ctrl+Shift+F`, so they do not reach the shell's (readline · vim) `Ctrl+F`. If needed,
  move them to other combinations in Settings › Shortcuts.

<a id="find"></a>
## Find

- `Ctrl+F` finds in **this tile**, and `Ctrl+Shift+F` finds in all terminals. `Ctrl+F` in a terminal tile is the find window narrowed to that one terminal,
  with the syntax floating in one line at the bottom of the find window. Other tiles have their own find:
  - An AI tile's **conversation** face — a find bar within the conversation · a document tile — a find bar within the document (the editor's find while editing) · a diff tile — a find bar within the expanded
    patches · a query tile — a find bar within the results when the results table has focus, otherwise the name find field of the schema tree (the editor's find inside the SQL
    editor) · a file tile — the Find in folder row (the same as `Ctrl+I`).
  - Find bars all work the same way: `Enter` · `F3` next, `Shift+Enter` · `Shift+F3` previous, `Esc` close, [Aa] match case.
  - Tiles with no find (branch · orchestration · start screen) find in all terminals.
- Typing a space after `@name` makes it a **scope chip** (find only in that tile). Delete the chip with `Backspace`.
- `/re` · `/case` · `/word` — regular expression · match case · whole word. These are the only options, and any other `/…` is
  search text (type `/usr/bin` as is).
- `#command` is a **block find** — it searches command blocks (in tiles with shell integration on) instead of screen text. It can be combined with `@tile`,
  in any order.
- If the search text must start with `@` · `#` · `/`, put **one space in front** or wrap it in `"quotes"` — it is searched literally.

## File tiles

- These follow Explorer's conventions. The tree in the hosts dock (`Ctrl+Shift+H`) uses the same keys.
- `Delete` asks once before deleting.
- `Backspace` goes **back** (not to the parent folder), and `Shift+Backspace` goes forward. The mouse thumb buttons (4 · 5) also go
  back and forward. For the parent folder, click the parent segment in the path field.
- View `Ctrl+1/2/3` (icons · compact · details) · path input `Ctrl+L` · find `Ctrl+F` · `Ctrl+I` · places panel `F9` · preview panel `F11` work only while that tile
  is active, and are changed in the "File tiles" group of Settings › Shortcuts. The size in icons view is `Ctrl+wheel`.
- `Esc` clears the selection.

## Mouse

- The gestures of dragging the header (move tile · to a new tab · to a new window) work only while the tile header is visible. The header can be hidden in Settings ›
  Theme › **Tile header**, and hiding it also removes the tile menu button (those actions remain in the shortcuts and
  the command palette).
- To move a tile, grab its header and drop it toward one of the four corners (quadrants) of another tile.
- Dropping a host on a tile connects it in half of that tile.
- **File drag** — a plain drag takes its meaning from where you drag to (between servers or within your own disk is a move; between your own disk and a
  server is a copy). Holding `Ctrl` forces a copy, and holding `Shift` forces a move.
- Dropping a file on a terminal pastes its path.
- **Exporting out of the app** — drag the handle at the end of a local file row, or drag while holding `Alt`, and drop on Explorer or another app. Release `Alt`
  when dropping.
- `Ctrl+click` (tile) puts that tile in or takes it out while broadcast input is on.
- **Favorites** — drag a host, project or DB connection row in the side dock onto the bottom-center hover dock (up to 10 items).
  Right-click **Remove** takes one out, and dragging or `Alt+←/→` · `Home`/`End` reorders them.
- The default shell row (↵ mark) in an empty tab opens with `Enter`.
- The tab menu (right-clicking a tab) gathers the actions for that tab (rename, broadcast input and so on).
- **Session sheet** (`Ctrl+Shift+M` · the Sessions row in the dock's Alerts section) — click a cell to go to that tile, or drag it to move that tile.
  With the keyboard, `Tab` enters the cells, then `←→` cells · `↑↓` previous and next tab cards · `Home`/`End` · `Enter`, and `Esc` closes
  ([Sessions · task plans · usage guide](dashboard.md#chips)).
