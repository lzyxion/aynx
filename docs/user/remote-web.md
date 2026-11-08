# Remote access guide (remote web client)

**Remote access** opens the app on your main PC (the PC running AYNX) from a **browser** on another PC or phone. **Tailscale** is the only route. The app listens
only on `127.0.0.1`, and what exposes it inside the tailnet (your Tailscale devices) is `tailscale serve` on the main PC (started by [Connect] in Settings or by you).
Tailscale also handles certificates and TLS.

**Common rules**

- **Browsers inside the tailnet only.** It does not open to the public internet (`tailscale funnel`) — if this port shows up in Funnel, the app closes the gateway.
- **A person at the main PC lets devices in.** A browser opening it for the first time shows a 6-digit code, and only after you see the same code on the main PC screen and press [Allow]
  is that device paired.
- **A remote window is almost the same as a main PC window** (permission level B) — settings, hosts, files, source control, DB and terminal tiles included. These work only on the main PC:
  changing the vault master password · deleting the whole vault · allowing device pairing · the auto-approval policy · the Tailscale connection (starting and stopping serve) · turning remote access on · its name · its port. Approving a task plan,
  raising AI permissions, starting an album, widening album permissions and deleting an archived album forever **ask for the master password again** at that moment (no prompt if there is no master password).
- Vault values, MCP tokens and webhook URLs do not leave for the remote side either.

---

## Turning it on

In **Settings › Remote access**, expand the **Remote access** card and press [Connect] on the **Tailscale connection** row. That is all: it finds the name, starts `tailscale serve`, turns remote access on and saves, in one step
(it does not wait for [Save], and other fields with unsaved edits stay as they are). You are ready when the row shows the address to open.

- If something else is using 443, the row shows that target, and you have to press [Replace and connect] to overwrite it. If Funnel is exposing 443 or this port, it does not connect.
- If serve or HTTPS must be turned on in the tailnet first, the reason appears with [Admin console ↗] and [Try again].
- [Stop serve] removes only serve (remote access on/off and the name stay as they are). The remote access toggle does not touch serve.

**Setting it up manually** (the **Setup guide** card on the same screen):

1. In **Settings › Remote access**, turn on [Remote access] and, in the **Remote access** card, enter the **MagicDNS name** (`<this PC>.<tailnet>.ts.net`). [Detect] fills in `Self.DNSName` from
   `tailscale status --json`. If **Port** is left blank, the default applies (47821 for the installed app). Press [Save].
2. Once on the main PC (PowerShell, not as administrator):

   ```
   tailscale serve --bg --https=443 http://127.0.0.1:47821
   ```

   This opens `https://<name>/` (443) inside the tailnet only and passes it to the app's gateway. Because of `--bg`, it stays until you turn it off (also after a reboot).
   - Turn off: `tailscale serve --https=443 off` · show the current setup: `tailscale serve status`
   - If you changed the port, change `47821` in the command too (the command field on the settings screen fills in the current port).
3. You are ready when the status line at the top shows **Connected · waiting to pair**.

**Without a master password, paired devices open without a password** — a warning chip on the status line at the top says so for as long as it is on. To set one, go to Settings › Security ›
master password.

## Pairing · opening

1. On another device (a PC or phone signed in to the same tailnet), open `https://<name>/` in a browser.
2. [Request connection] → a 6-digit code on screen. The main PC shows an OS notification and a confirmation dialog — press [Allow] **only if the two codes match**.
3. Remote lock screen: open it with the master password (or one button if there is none). Lifting the remote lock screen also opens the vault.

The default device name is **the device name known to Tailscale · browser** (`My Phone · Chrome`). If the Tailscale name cannot be found, it is browser · OS (`Chrome · Android`).
The name is only for display and is not used to establish identity (what counts is the [Allow] of the person who compared the two codes). You can change it later.

The status bar of a remote window always shows **Remote · <device name>** — clicking it locks this remote window (to the unlock side; the main PC is unaffected).
It locks by itself after the idle auto-lock time (Settings › General › Privacy, 15 minutes if unset) or the 12-hour upper limit.

## What the main PC shows

- An **OS notification** when a remote device lifts its remote lock screen (cannot be turned off).
- **Remote access (N)** in the status bar during remote use (cannot be turned off). Clicking it shows the devices in use, window counts, recent activity, **[Disconnect all]** and
  [Remote access settings…].
- **Paired devices** in Settings › Remote access — rename · **Revoke** (that device's remote windows close right away) · currently unlocked · window count.
  **Recent activity** keeps pairing, unlocking, failed unlocks, locking, windows connecting and disconnecting, and revoking in memory only (cleared when the app restarts).

## Security checklist

- **Two-factor authentication** on the account you sign in to Tailscale with (Google, GitHub …).
- **Device approval** or **tailnet lock** in the Tailscale admin console — even if the account is compromised, a new device cannot get in right away.
- Use the **policy file (Access controls)** to open 443 to your own devices only. To narrow it, you must delete the "allow all" rule in the default policy:

  ```
  {
    "tagOwners": { "tag:server": ["autogroup:admin"] },
    "grants": [
      // Remote access to the main PC (https 443) only between your own devices
      { "src": ["autogroup:member"], "dst": ["autogroup:self"], "ip": ["tcp:443"] },
      // Servers (dev-01 etc.) get tag:server and SSH only — there is no route from a server to the main PC
      { "src": ["autogroup:member"], "dst": ["tag:server"], "ip": ["tcp:22"] },
    ],
  }
  ```

- **Do not use Funnel.**
- If you lose a device, **Revoke** it — this works from the main PC or any other remote device. **Turning off** remote access also works remotely (turning it on works only on the main PC).

## What a remote window shows — the main PC screen as is

A remote window draws **the workspace the main PC's main window is showing right now** as is — tab bar, tile layout and focused tile. When the main PC splits,
switches tabs or closes a tile, the remote window follows right away.

- **Terminal tiles are viewed together** — the main PC and the remote side see the same shell, and both can type. Closing the remote window leaves the shell as it is (the remote side only
  stops viewing).
- **The side that typed last sets the size** (the same as tmux's `latest`). When you start typing remotely, the shell takes the remote window's size, and typing on the main PC again
  returns it to the main PC's size. The side that did not set the size draws at the other side's size in the top left (empty space stays as margin; overflow scrolls), wraps the drawn
  area in a **dashed border** and adds a tag on the top edge — "Remote device 120×30" in a main PC window, "Main PC 120×30" in a remote window
  ("Other window 120×30" if another remote device set it).
- **Restoring the size** — you do not have to type. A focused tile shows a card in the empty space ("Showing the remote device's size"), and [Fit this window] returns that tile
  to this window's size right away (no characters go to the shell; only the size changes). If this window has two or more shrunken tiles, the card offers [This tile only] and
  [Restore all] (all shrunken tiles in this window's current workspace; other windows and workspaces stay as they are). If the size difference leaves no room for the card,
  clicking the tag shows the same buttons. The card follows the focus to another shrunken tile. Typing in this window also takes the size back, as before.
- For programs that ask the terminal for the cursor position or colors, such as vim and Claude Code, **only the side that set the size** answers — answers do not arrive twice even when two windows
  are viewing together.
- A slow remote side (a phone, a weak network) does not freeze the main PC screen. If the remote side falls too far behind, only that remote side is resynced (some output may be skipped
  in the meantime, with a "some output was lost" notice).
- **Picking a tab remotely is up to the remote window** — picking another tab remotely leaves the main PC screen as it is (when the main PC switches tabs, the remote side follows).
- **Workspaces can also be picked separately on the remote side** — a remote window first shows the workspace the main PC is showing. Picking another workspace remotely
  (in the workspace list, or the chips on the phone's picker screen) does not move the main PC screen. When the main PC switches workspaces, the remote side follows.
  A workspace the main PC has not opened yet in this run shows only its name and tab count and cannot be picked (it has no sessions to attach to yet — once the main PC
  opens it, it can be picked remotely too).
- If the main PC's main window is closed (tray), the saved layout is shown — it follows that screen once a main PC window opens again.
- File, document, branch and diff tiles and the orchestration tab also stay open remotely, and things like moving to another folder remotely change only inside the remote window.
- **Query tiles are not viewed together** — the main PC tile holds the DB connection and transaction. In its place stands [Open separately here], which opens a new query tile on the same connection
  (a new connection) in the remote window only.

## Changing the layout remotely

A remote window can also do **new tab · split · new terminal · open file and host tiles · close tile · close tab · move (drag and drop · Alt+Shift+arrow) ·
resize (Ctrl+Alt+arrow) · tab order · rename**. The remote side only **asks** the main PC, and the main PC window makes the actual change — the changed screen
comes back to the remote side as is. So:

- The shell of a new terminal opened remotely is also **opened by the main PC** (the remote side views it together). The main PC screen moves to that tab and tile too, and the remote side follows.
- If the remote side is viewing a **workspace the main PC is not showing**: a new tab is created in that workspace and the main PC screen stays as it is (it shows up when the main PC later goes to that
  workspace). Closing tiles, closing tabs and renaming also work. Actions aimed at the main PC's current tab or tile, such as split, move, resize and tab order, work only while the main PC is showing that workspace
  (with the notice "This only works in the workspace the main PC screen is showing" — so that the main PC screen is not moved
  behind your back).
- **Closing something that ends a session** (a tile or tab with a terminal) asks once on the remote side. On the main PC it closes with no confirmation, and a brief notice appears: "Remote <device> closed a tile".
  If the main PC has an unsaved document or an open DB transaction, it does not close, and the remote side is told why (sort it out on the main PC).
- **If the main PC window is closed (tray), the layout cannot be changed** — "The layout can only be changed while a main PC window is open" appears (the remote side does not open a main PC window
  behind your back).
- A query tile opened with [Open separately here] belongs to the remote window, so closing it does nothing on the main PC.
- Pressing too quickly in a row (over 10 times a second) is briefly refused.

## Approving remotely

A remote window also shows the **task plan review card** (at the bottom of the screen), the count badge on the status bar's notification bell, the approval line in the dock's Alerts section, and task plan run result notifications — you can see and approve or reject
task plans raised by the AI without being at the main PC.

- **Approving and changing AI permissions asks once more at that moment.** Approving a task plan, changing a task plan's targets, a host's AI permission, a DB connection's AI permission,
  starting an album, widening album permissions, running an orchestration verification, Accept despite failure, deleting an archived album forever, and turning on a local tile's Allow AI to read all show an app modal when pressed remotely.
  - **If the main PC's vault has a master password**, you type it again. After five wrong attempts you are blocked for a while (1 minute), during which even the right password is not accepted —
    the modal tells you "Too many attempts — try again in N s".
  - **If there is no master password**, it does not ask and takes only [Confirm] (the modal says so). That means anyone with a paired device can approve,
    so if you plan to approve remotely, it is better to set a master password in Settings › Security on the main PC.
  - A confirmation is used for **that one action only** (within 60 seconds, that one command). Pressing again asks again.
- **Rejecting and cancelling a run do not ask** (they reduce work).
- Even after approval, the session server always makes the final judgment — it rechecks expiry, run limits, delegation scope and permissions, exactly as for a press on the main PC.
- Actions sent remotely after reconfirmation stay in the main PC's remote access record (the status bar's remote chip · Settings › Remote access) as, for example, "Confirmed and sent — Approve a task plan", with
  the device name (the values of what was approved are not kept). A task plan's audit record does not have the device name yet.
- Changing the auto-approval policy and changing the vault master password still work **only on the main PC**.

Other confirmations in a remote window (such as closing a tile or tab that ends a session) also appear as **app modals**, not the browser's default dialog. In warning confirmations, [Cancel] has the
initial focus, so one Enter does not close a session.

## Using it from a phone

Phones and tablets open the same address too, and **they can do the same as a PC remote** (permission level B). Only the screen fits the phone — when a remote window is narrower than 720px, it becomes the
**mobile screen**.

- **You view one tile at a time.** Clicking the pill in the top strip (the current tile's name and location) shows the tab and tile picker screen — one group per tab, with tile
  rows inside (including agent status). Picking belongs to this phone's screen, so the main PC screen stays as it is (when the main PC switches tabs, the phone follows). The main PC's split
  layout stays as it is, and one tile is shown large on screen — tiles fill to the screen edge with no gaps or rounded corners, and there is no tile header (name, chip row;
  the top strip's pill gives the name). The **×** (close tab) on a group's header asks the main PC (it asks once if the tab has a session).
  **New tab** at the bottom of that screen opens the "Open in a new tab" sheet below. The **gear** in the head is the phone settings screen.
- **Tile menu**: the **⋯** to the right of the top strip's pill opens the same menu as the ⋯ in a PC tile header (Server › Forwarding · remote files · tmux sessions · AI permissions ·
  output · close …). Buttons that exist only in the header also appear at the top of this menu — **Switch to conversation / Switch to terminal** on AI tiles,
  **Open folder** on local terminals, **Open branch tile**. A phone is always one tile in one window, so **Split left and right · Split top and bottom · Detach to a new window** are not in this
  menu or the long-press menu (PCs and wide remote windows still have them). The menu you get by long-pressing the terminal (copy, paste …) is unchanged.
- **Open in a new tab**: pressing **+** in the top strip (or New tab on the picker screen) brings up a sheet from the bottom — New tile (default shell · each enabled AI agent ·
  local files), recent hosts (a green dot if connected), **All hosts · projects · DB**, past conversations, task plans (with the number awaiting review), and at the bottom [Alerts] and
  [Settings]. What you pick always opens as **a new tab holding only that**, and the phone goes to that tab (a phone views one tile at a time, so it does not insert a split). A new tab
  lands in the workspace the phone is viewing if opened from the top strip, or in the workspace that screen was showing if opened from the picker screen. Closing with nothing picked (clicking
  outside · Esc · ×) creates nothing.
- **All hosts · projects · DB**: pick hosts, projects or DB with tabs, and below "Recent" stands the same folder tree as the desktop dock. Click a folder row to expand or collapse it.
  Clicking an item row only selects it, and a button appears on the right — hosts [Connect] · projects [Open] · DB [Open query]. Double-click, drag and drop, and
  folder editing are not on the phone (use the main PC or a PC remote).
- **Workspace chips**: with two or more workspaces, a pill per workspace (`name tab-count`) stands below the picker screen's head — the selected one has an accent surface, and
  a small dot shows if that workspace has an agent waiting for you (waiting for permission; otherwise the most urgent state, in the order finished then running). Swipe sideways if there are many.
  Clicking a chip shows that workspace **on the picker screen only** (its head title becomes that name too), and you must click a tile row for the phone to go to that workspace, tab and tile
  — the main PC screen does not move. Pressing **New tab** in that state creates it in that workspace. A chip for a workspace the main PC has not opened yet
  shows only the notice "Not opened on the main PC yet", and New tab is off.
- **AI tiles first appear on the conversation face.** When you first view an AI tile on a phone, the conversation face shows (change it to Terminal in phone settings › This device › AI tile opens to).
  On the conversation face, the key strip and input box at the bottom are hidden.
- **Side chat**: the speech bubble in the top strip opens the phone side chat.
- **Bottom key strip**: (input mode) · **Ctrl** · Esc · Tab · arrows · ^C (Ctrl+C) · ⏎ (Enter) — the order and hiding after the leftmost input mode button are set under the key strip in phone
  settings. **Ctrl** stays on after one press and applies to **the next key** (Ctrl then `c` = Ctrl+C; an arrow = Ctrl+arrow). Pressing it again turns it off.
- **Input goes through the input box by default.** A phone's on-screen keyboard (word suggestions, Hangul composition) tends to drop or double characters when typing directly in a terminal, so a one-line input box always stands above the key
  strip. Clicking the terminal also brings the keyboard up in that box (drag to scroll and long-press for the menu still work).
  - **Send** (or the keyboard's send / Enter) = text + Enter. If the box is empty, just Enter.
  - **Insert** = text only, with no Enter — before Tab completion, or when continuing a vim `:` command.
  - Pressing the keyboard's delete (⌫) with an empty box deletes one character in the shell (a character already sent).
  - With Ctrl on in the strip, typing one character in an empty box sends Ctrl+that character right away (the box is cleared).
- **Switching to direct typing**: the **leftmost button** on the key strip (**가** in input box mode, a keyboard icon in direct typing) toggles between them — direct typing has no box, and you tap the
  terminal and type straight into it with the on-screen keyboard (the old way). This is the same value as phone settings › This device › Input and is remembered **in that browser only**.
- **A phone does not set the shell size.** Typing on a phone leaves the shell size of the main PC window as it is, and the phone draws at the main PC's size (swipe sideways if it overflows;
  the phone layout has no border or card). To fit the phone's screen size, turn on **⤢** in the top strip (Fit to this device; a wide-screen tablet uses [Fit this device] on the tag or
  card) — after that, as with a PC remote, **the side that typed last** sets the size. This choice is remembered in that browser.
- **Phone settings** ([Settings] in the sheet · the gear on the picker screen): **This device** — terminal font size (8–24; when it matches the main PC's value, it follows the main PC again) ·
  Fit to this device (the same value as ⤢) · Input (Input box (default) · Direct — the same value as the key strip's leftmost button) · AI tile opens to (Chat (default) · Terminal) · Key strip (turn each key on or off, reorder) · Theme (**Main PC** (default — the main PC's theme settings as they are) · System = the phone's brightness · Light · Dark). These values are saved **in that
  browser only**, and the main PC's settings do not change (they apply only to the phone screen). **Main PC** — auto-approval can be changed only on the main PC, so only its current
  state shows · notification settings. **Manage this device** — Lock now (same as the status bar lock — the vault locks too) · Disconnect (closes this remote session —
  opening it again shows the unlock screen) · Unpair this device (to use it again, allow it anew on the main PC). [Open all settings] at the very bottom is the same settings screen as on a PC.
- **Scroll · copy**: drag the terminal up and down to see past output. **Long-press** to show a menu (Paste · Select all · Copy …).
- **Data · battery**: terminal tiles not on screen, and terminals while the phone browser is in the background, stop receiving after a short while. When you return, the output from that gap
  is received and drawn (if too much piled up, there is a "some output was lost" notice). If you return after a long time in the background and the connection is cut, the page reloads and
  reattaches (right away, unless the remote lock screen is up).
- The task plan review card, approval confirmation dialog and tile menu also fit the phone's width, and buttons are finger-sized.
- On touch devices, terminals draw with the default renderer rather than the GPU (WebGL) (to avoid phone GPU memory problems and a broken screen when returning from the background).

## Current limits

- **Layout actions that do not work remotely**: dragging and dropping several hosts (a folder) at once to open them in a grid · dragging a split line to change the ratio (only the remote screen changes briefly, and the
  main PC screen overwrites it) · creating a new worktree for a project · opening with a setup script attached (do these on the main PC).
- A remote terminal tile only attaches to sessions the main PC opened — an SSH tile the main PC has not connected yet shows "This tile's session is not open on the main PC yet",
  and follows soon after the main PC connects. [Reconnect] on an ended session is also done on the main PC.
- The main PC's auxiliary windows (detached windows) do not show remotely — only the main window's workspaces.
- A file picker dialog, opening the main PC's Explorer, dragging out to Explorer, detaching a tile to a new window and opening in the main PC's editor do not work remotely.
- A phone has no **split line dragging or drag and drop** (it is a screen that views one tile at a time). To change the layout, use + (new tab) in the top strip and close in the tile ⋯ menu (splitting is done on the main PC or a PC remote).
- There is no finger selection of part of the text inside a terminal — long-press for **Select all · Copy**, or use block copy.
- There is no pinch zoom that enlarges only the terminal text (the browser's own zoom works).
- The gateway screens (pairing · unlock) use the language set on the main PC.
