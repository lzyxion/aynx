# Host settings guide

This guide explains each item of the **host form**, which opens from [Add host…] and [Edit…] in the host list. The ⓘ in the form shows only a short description. The background, exceptions and interactions with other features are written here. The order follows the form's tabs (Connection · Appearance · Session · Agents · AI access) and the order of the fields inside them.

**Common rules**

- The form's values are written to **three files**. The tabs mark the boundaries between the files.
  - **Connection** tab → `~/.ssh/config` (the standard OpenSSH file — `ssh`, `scp`, `git` and VS Code read the same file)
  - **Appearance** · **Session** · **Agents** tabs → `~/.ssh/sessions.toml` (app only — other programs do not know this file)
  - **AI access** tab → `~/.aynx/delegation.toml` (app only)
  - **Stored credentials** at the bottom of the Connection tab is not a file. It only shows what is in the vault (`vault.bin`).
- **DB connections** that go through this host are created in the **DB** section of the dock, not in the host form (pick this host in the Via field — [query-tile.md](query-tile.md)). If you rename the host, the Via value of those connections follows the new name. If you delete the host, those connections are deleted with it.
- No file changes until you click [Save]. If saving fails, one line below the form tells you why. If the field to fix is on another tab, the form takes you to that tab.
- **Emptying** a `sessions.toml` field does not mean "no value". It **deletes that key**, and the value falls back to the file's `[defaults]` or preset value. If a value is inherited, it appears as dimmed text in the field (placeholder) or as "Inherited: on/off". `[defaults]` and `[presets.*]` cannot be edited in the form. Edit the file directly. (Merge priority: `[hosts.<alias>]` > `[presets.<name>]` > `[defaults]`)

---

## Connection — `~/.ssh/config`

<a id="host-lead"></a>
### What this form edits

- **Add**: The form **only appends a new `Host` block to the end** of the file. It does not change a single character of the existing content.
- **Edit**: The form edits **only the inside of this host's `Host` block**. It leaves everything outside the block (other blocks, comments, `Include`) alone, as well as comments inside the block and options the form does not show (`ServerAliveInterval` and so on). The form edits seven kinds of lines: the alias, `HostName`, `User`, `Port`, `IdentityFile`, `IdentitiesOnly` and `ProxyJump`.
- The values shown in the edit form are **the result currently in effect**. They include values inherited from shared blocks such as `Host *`. When you save, those values are written directly into this host's block.
- You **remove** a host from the host list, not from the form: use the right-click menu [Remove…] or `Delete`. The `Host` block and this host's settings in `sessions.toml` are deleted together.

<a id="host-alias"></a>
### Alias *

The name you use in `ssh <alias>`, and the value of the `Host` line. Required.

- Spaces, `*` `?` `!` (wildcards and negation) and `=` are not allowed.
- **If you rename it**, the places that recorded the alias follow along: favorites, snippet scopes, the saved trees of all workspaces, `sessions.toml`, AI access, and the `ProxyJump` of other hosts.

<a id="host-hostname"></a>
### Host address *

`HostName` — an IP address or a domain. Required. Spaces are not allowed.

<a id="host-user"></a>
### User

`User` — the account to log in with. If empty, the line is not written (by OpenSSH rules, the value from `Host *` or this PC's user name applies).

<a id="host-port"></a>
### Port

`Port` — 1–65535. If empty, 22.

<a id="host-identity"></a>
### IdentityFile

The path of the private key file used to connect. It may be empty.

- The app **does not store** the private key. It reads the key at the moment of connecting, signs and discards it. Authentication tries the keys in ssh-agent first, and then this file.
- If the key has a passphrase, you are asked for it when connecting. If you have turned on the vault, you can choose to save it in that dialog so you are not asked again.
- **[Browse…]** — picks a file.
- **[New key…]** — creates a new key pair in `~/.ssh` and fills in this field. The types are ed25519 (recommended) and RSA 4096 (for older servers). `ssh-keygen` does the work, and the app receives only the paths and the public key line. The passphrase entered during creation is not stored. Installing the public key on a server is a separate step ([Install public key…] in the host's right-click menu).

<a id="host-identities-only"></a>
### Use only this key

`IdentitiesOnly yes` — does not offer ssh-agent keys or the default `~/.ssh/id_*` keys, and tries **only the IdentityFile above**.

- When to use it: when the agent has so many keys that the server's limit on authentication attempts (`MaxAuthTries`) is reached before the right key, and the connection drops with "Too many authentication failures".
- It cannot be turned on while IdentityFile is empty. This option only excludes agent keys, so if you turn it on without a key file, OpenSSH still uses the keys with default names, and what you expected does not happen.
- Turning it off deletes that line. If it is on in `Host *`, "Inherited: on" is shown.

<a id="host-forward-agent"></a>
### Agent forwarding

`ssh -A` — lets programs run on this server (`git`, `ssh` and so on) **sign with this PC's ssh-agent**. Use it to hop from the server to another server, or to `git pull` a private repository. **Off by default.**

- **Risk**: While you are connected, that server's administrator (root) can sign with your keys in the same way. Turn it on only for servers you trust.
- This switch is written to `sessions.toml`, not `~/.ssh/config` (for this host only — it is not inherited). If `~/.ssh/config` has `ForwardAgent yes`, that fact is shown next to the switch, and the switch starts with that value. If you save the same value as the config, the app's override is deleted.
- Agent forwarding is not applied to AI access headless connections.

<a id="host-proxyjump"></a>
### Jump host

`ProxyJump` — connects to this host first and then enters the target from inside it (a bastion or jump server).

- You can choose among other hosts you have already added. A value written by hand in the file (`user@bastion:2222` and so on) also appears as one row in the list and is saved as it is.
- **Only one hop** is supported (several hops joined with commas are rejected).
- If the jump host is renamed, this line follows the new name.

<a id="host-vault"></a>
### Stored credentials (when editing only)

Shows **what the vault holds** for this host (password, key passphrase). The only action here is [Clear].

- Values are saved not here but through the save option in the **password or passphrase dialog that appears when you connect** (that is the only place that knows the value). The vault is turned on in Settings › Security.
- [Clear] deletes from the vault immediately (independent of [Save]).
- If the vault is locked, it may show as "None".

---

## Appearance — `~/.ssh/sessions.toml`

The values in this tab are used only on screen and do not affect the connection. If all are empty, inherited or default values apply.

If the icon or color field is empty and a value is inherited, the dimmed text in the field says **where it came from and what it is** — "From preset prod · Ubuntu", "From defaults · #8a8a8a" (`[defaults]`). The preview and color swatch also draw that value dimmed (the color with hatching), which marks it as not written on this host. The tooltip of [↺] says what the field follows after clearing.

<a id="host-icon"></a>
### Icon

A built-in logo or basic icon (find by name), or an emoji. If empty, the value is inherited. If nothing is inherited, the **default server icon** applies. It is drawn in the same theme color as the default folder of the host dock, and takes on the [color](#host-color) if you set one (host dock, palette, start page, tile header). Nothing is written to the file.

The two segments **[Basic / Logos]** at the top of the picker choose which set to look at.

- **Basic** — single-color line icons of **general objects** such as servers, databases, routers and houses (about 1,900, no internet needed). If you set a [color](#host-color) below, they are drawn in that color (list, tabs, session sheet, palette). Otherwise they use the text color. When the field is empty, 24 commonly useful icons are shown.
- **Logos** — brand color logos (Ubuntu, Docker, AWS…). They are drawn in their original colors.

Search looks only in the selected segment. If the other segment has matches, a line such as "N in Basic" appears, and clicking it moves to that segment. The last selected segment is remembered while the app is running (a host that already has an icon opens on that icon's segment).

When the **Logos** field is empty, 34 frequently used logos are shown. When you type, the search covers those 34 plus the **entire logo set (about 2,100, no internet needed)**. Parts of names also match (`postgres`, `tux`, `cloud run`). Results show up to 200 at a time, and if there are more, "N more" appears, so type more to narrow it down. When the same brand has both a wordmark and a symbol, the symbol, which stays recognizable at a small size, comes first.

<a id="host-color"></a>
### Color

The color that distinguishes this host in the host list and on tiles. `#rrggbb`. Clearing it with [↺] returns to the inherited value (no color if there is none).

<a id="host-group"></a>
### Group

The folder path in the host list. Nest with `/` (for example `prod/web`). Paths already in use are autocompleted, and a new path is created when you type it.

<a id="host-tags"></a>
### Tags

Labels for searching. Type and press Enter to make each one a chip. If written in the host table, they replace the inherited value **entirely** (they are not merged).

---

## Session — `~/.ssh/sessions.toml`

<a id="host-scrollback"></a>
### Scrollback

The number of lines this host's tiles remember. 100–200,000. If empty, the value is inherited. If nothing is inherited, 5,000. It is read once **when a tile is newly opened** (it does not apply to tiles already open).

<a id="host-onconnect"></a>
### Command after connecting

A command sent **once as the first input** right after the shell comes up (for example `cd /srv/app`). If empty, the value is inherited.

- **It does not run when Connect with tmux is on**, because the tmux command uses that first input line.

<a id="host-tmux"></a>
### Connect with tmux

**Attaches to a tmux session on this host** instead of a shell (creating one if there is none). **Off by default.**

- If SSH drops, remote work keeps running inside tmux, and reattaching brings you back to where you were. Each tile attaches to a different tmux session.
- In exchange, that tile becomes a **screen-only session** (simple mode), because shell integration cannot reach inside tmux. What turns off: command history (jump), last output copy, block search (`#`), failure marks, status badges, and the AI's command reading (reading the screen still works). What stays: screen search, scrollback, automatic reconnect, port forwarding, and remote files.
- If the server has no tmux, the screen prints one line, `[AYNX] tmux is missing — keeping a plain shell`, and you stay in a plain shell (the tile remains in simple mode).
- Clicking the **tmux chip** in the header shows that server's list of tmux sessions. Clicking a row switches in this tile, and the buttons at the end of a row open it in a new tile or **Kill** it (🗑 — `tmux kill-session`). Kill asks for confirmation first. If this tile is attached to that session, it says this tile's connection ends too, and if other clients are attached, it also says how many. The list is read again after killing. Names containing characters such as quotes, `$`, `:`, `.` or `*` cannot be killed from the app (kill them in a shell).
- Turning it off deletes that key. If it is on by inheritance, "Inherited: on" is shown.

<a id="host-shellint"></a>
### Shell integration

On connecting, a small script (`~/.aynx/integration.sh` · `~/.aynx/rc`) is uploaded to the server so the shell tells the app when a command starts and ends and what its exit code is (OSC 133). It works in remote bash and zsh.

- Features this turns on: failure marks, command jump, output copy, status badges, block history, the AI's command reading, and following the current folder.
- The server's rc files (`~/.bashrc` and so on) are not touched. Commands you run are also recorded, one line each, in `~/.aynx/history` on the server.
- **Default (on · inherited)** — follows the upper level (`[defaults]`, preset). If nothing is set anywhere, it is on.
- **Off** — nothing is uploaded to this server (the upload, creating `~/.aynx` and entering commands are all skipped). If it is off at an upper level, "Inherited: off" is shown.
- Even when it is off, **the app does not delete files already uploaded**. Delete them on the server with `rm -rf ~/.aynx`.

<a id="host-log"></a>
### Session logging

When you connect to this host, the output the remote sends is saved to a file **as it is**. **Off by default.**

- Secrets shown on screen are recorded too: echoed passwords, tokens, environment variables. The file is **not encrypted.**
- Files accumulate in the log folder shown below ([Open folder]).
- Turning it off deletes that key. So to turn off logging for just this host when it is on in `[defaults]`, edit the file directly (`log = false`). If it is on by inheritance, "Inherited: on" is shown.

<a id="host-forwards"></a>
### Port forwarding

The list of tunnels opened automatically on connect. Choose the type on each row.

- **Local (-L)** — `127.0.0.1:localport` on this PC → `host:port` as seen from the server. For example, `15432 → localhost:5432` connects to a database on the server.
- **Remote (-R)** — `127.0.0.1:remoteport` on the server → `127.0.0.1:localport` on this PC.
- **Dynamic · SOCKS (-D)** — `127.0.0.1:localport` on this PC becomes a SOCKS5 proxy.
- Both ends are loopback (127.0.0.1), so nothing is open to the outside.
- If one tunnel fails, the connection continues and only a notification appears.
- This field is **not inherited**. A local port belongs to one server, so if several hosts shared it, the port would collide from the second connection on.
- Invalid rows are all pointed out at once when you save.
- Tunnels you want only briefly during a connection are opened separately from Port forwarding in the tile menu, described below.

<a id="tile-forwards"></a>
#### Port forwarding in the tile menu

The window opened from an SSH tile's ⋯ menu (or right-click) › Port forwarding…. It opens a tunnel directly over that session.

- Both ends open only on loopback (127.0.0.1). When the session closes or reconnects, the forward goes away with it.
- **Local (-L)** — For example, set local `15432` → `localhost:5432` and connect a database tool on your PC to `127.0.0.1:15432` to reach PostgreSQL on the remote server. **The remote host is the name as the server sees it** (`localhost` for the server itself).
- **Remote (-R)** — For example, with server `18080` → this PC's `8080`, running `curl 127.0.0.1:18080` on the server reaches the program running at `127.0.0.1:8080` on your PC. It opens only on the server's loopback, so it cannot be reached from outside the server.
- **Dynamic · SOCKS (-D)** — For example, use local `1080` as a browser's SOCKS5 proxy or with `curl --socks5-hostname 127.0.0.1:1080`, and traffic leaves through this server. The destination is chosen per connection, and the server also resolves names.
- The dot at the start of a row — **green** means a program is connected through this forward right now ("In use"). A dim dot means the tunnel is open but nothing is using it yet ("Idle"). Hovering over the dot shows the same words, and the "N active" / "Idle" next to it means the same thing.
- Agent-signal forwards managed by the app (for AI tiles the app started and for tiles of agent-enabled hosts) do not appear in this list or the chip count, because a person cannot stop them. The app removes them when the tile closes.
- Local forwards get an [Open in browser] button, which opens that port in the system default browser.

---

<a id="host-agent"></a>
## Agents — `~/.ssh/sessions.toml`

On a remote server, a person ends up starting an agent by typing `claude` or `codex` in a shell. This tab makes **commands typed by hand work the same as ones the app starts**.

<a id="host-agent-enable"></a>
### Enable agents

**Off** by default (turn on with `agent = true` — it is inherited from `[defaults]` and presets, and the old key `remote_hooks` is read with the same meaning). While on, connecting to this host (except quick connect and headless) puts the following on the server. This is separate from shell integration, and this switch is your consent.

- **Status-signal hooks** — our entries in `~/.claude/settings.json` and `~/.codex/hooks.json`, and the scripts in `~/.config/aynx/hooks/`. They are installed even when the tile is not an AI tile the app started. Codex hooks must be approved once with `/hooks` inside Codex before they run.
- **PATH shims** — `~/.config/aynx/bin/claude` · `codex` (small sh scripts). This folder is placed at the front of the connected shell's `PATH`, and the shim starts the next real `claude` · `codex` on the PATH with this host's extra arguments. In a shell connected from outside the app, it adds nothing and starts the command as it is.
- **Tile file** — `~/.config/aynx/signal/<stream>.env` (0600). The extra arguments and the status-signal address and token are written here for each tile. While on, **every tile** of this host (plain shells, reconnects, tmux) receives status-dot signals. That token changes only that tile's status dot and cannot be used for MCP or commands. This has nothing to do with the AI access level (when off, only tiles where the app started an AI receive signals).

When off, nothing is put on the server. **What is already there is not deleted.** The **Remove {agent} server hooks** item in the project menu deletes the hooks and that agent's shim together.

- **Agent rc** — `~/.config/aynx/agent-rc`. The bash in a tmux session without shell integration starts with this (see below).

Even if a setting puts a folder at the front of `PATH` when the shell starts, such as `export PATH="$HOME/.local/bin:$PATH"` in `~/.bashrc` (the line the Claude Code installer adds), a bash opened by the app puts the shim folder back at the very front after reading all of the user's profile. The shell integration rc (`~/.aynx/rc`) does this if there is one, and the agent rc does it if a tmux session has no shell integration rc. This happens only when the app put the shim folder into that tile, so turning off the switch leaves things untouched.

Known limits: With zsh or fish login shells, the tmux session's shell still starts with `-l` as before, so if an rc puts a folder at the front of `PATH`, the shim can be hidden. The same applies when attaching to an existing tmux session (reconnecting) and to a `bash` started again inside a shell. Check with `type -a claude`.

<a id="host-agent-args"></a>
### Extra arguments

One line of arguments to add to Claude Code and Codex. The rules (quotes, rejected characters) are the same as the extra arguments in Settings › AI agents, but **local settings do not spread to remote hosts**. They are inherited key by key in the order `[defaults.agent_args]` → `[presets.<name>.agent_args]` → host. If the field is empty, the upper layer's value appears as dimmed text with a source chip. If you write something and then erase it, the field overrides the upper layer with **None**, and ↺ returns it to inheriting. Flags that skip permission checks (`--dangerously-skip-permissions`, `--yolo` …) are not blocked, but a warning chip points them out.

The position is the same as in commands the app starts: for Claude, at the end of the line. For Codex, right after the executable (after `resume` or `fork` if present). If Codex `--no-daemon` is on in Settings › AI agents, it is added too. **Command that actually runs** shows the result.

---

<a id="host-ai"></a>
## AI access — `~/.aynx/delegation.toml`

Sets what the AI can do on this host. It applies **the same way to tiles a person opened and headless sessions the AI opened**. If a host has three tiles, all three follow the same permission. Clicking the permission chip in the tile header (or **AI access…** in the tile menu) changes the same value. The default is **Off**, and only what you choose is written to the file (at Off, this host's line disappears). See the whole list of hosts with permissions in Settings › Security.

- Only this form and the tile header (a person) can change the permission. The AI has no way to widen its own permission.
- **Local tiles** have only **Off · Read**, per tile. Choose them with the same permission chip in the header or **AI access…** in the tile menu. Ask, Auto and YOLO are locked. They have no permission to run anything (they cannot be task plan targets). **AI tiles** (local tiles running a Claude or Codex that the app started or that you ran from a shell) have no AI access at all: there is no chip or menu row, and it is always **Off** (another AI does not read that conversation through MCP). A tile restored with it on is turned off.
- **Remote tiles not in the host list** (quick connect) are always **Off** (a dim **Off** chip in the header that cannot be clicked). Save the target as a host to give it permission.
- The permission chip in the header **stays visible even at Off** (an empty gauge + **Off** — except on AI tiles). To hide it, turn off the **AI permission** chip in Settings › Terminal › [Tile header chips](settings.md#header-chips).
- Headless runs have no terminal (PTY), so `sudo` password prompts and interactive commands simply fail.

<a id="host-ai-stage"></a>
### Levels

There are five levels, **Off · Read · Ask · Auto · YOLO** (off · read · run after approval · run automatically from the allow list · run anything automatically), and each higher level includes everything below it. The level names are always these English words regardless of the display language, and the description line under the gauge says what they mean. The picker is a **gauge**: the ring on the left is Off, and the four segments on the right are Read, Ask, Auto and YOLO. Segments fill up to the selected level (click a segment or a name below it, or use ←→). YOLO has an orange marking, and choosing it requires ticking the "I understand…" checkbox in a confirmation dialog. The chip in the tile header also shows a small gauge of four bars.

| Level | What the AI does |
| --- | --- |
| **Off** | The AI cannot see this host's sessions |
| **Read** | Reads commands and output and answers |
| **Ask** | Read + proposes commands to run (the host can be a task plan target). They run only after a person approves in the app |
| **Auto** | Ask + runs without waiting for a person **if all conditions in Settings › Auto-approval pass** |
| **YOLO** | Auto + runs commands the AI proposes **without any filtering** (no allow list, risk check, or pipe and redirect limits — including `rm -rf`, restarts and `sudo`) and without waiting for a person. Choosing it shows a confirmation dialog first |

- Lowering the level to **Off** immediately deletes the shared data of this host's tiles (the same as setting a local tile to Off).
- If auto-approval is off or the conditions are not met, even **Auto** waits for a person's approval.
- **YOLO** also waits for a person if the global switch in Settings › Auto-approval is off. Limits on target count and concurrent runs, and the run record, still apply. Commands go unfiltered only if **all targets** of the task plan are YOLO. If even one is not, the rules of Auto apply again.
- A task plan with several targets is auto-approved only if **all targets** are Auto or higher. If a local tile or a quick-connect tile is mixed in, a person approves.
- If the level is lowered (below Ask) between approval and running, that target does not run.
- Automatic runs are also recorded in the audit log.

<a id="host-delegation-connect"></a>
### Headless connection

When a task plan is approved, the app connects to this host **without a tile** and runs it. This can be turned on only at **Ask or higher**, and turns off when the level is lowered below that. Task plans that target a tile a person opened are not affected by this switch. They run over that tile's connection.

- Authentication uses ssh-agent and IdentityFile, not passwords. Agent forwarding is not applied.

<a id="host-delegation-vault"></a>
### Use the key passphrase from the vault

In headless connections, the IdentityFile's passphrase is **taken from the vault** (for this host only). Headless connection must be on before this can be turned on.

- It cannot be turned on without a vault (turn the vault on first in Settings › Security). If the vault is locked, that connection does not start.
- Passwords are still not used. This covers key passphrases only.

---

## Host dock

The **Hosts section** of the launcher dock (`Ctrl+Shift+H`) is the list of hosts in `~/.ssh/config`. The right-click menu of a row opens the actions below.

<a id="folder-icon"></a>
### Edit folder — name · icon · color

Right-click a folder row → **Edit…** (or select the folder row and press `F2`) opens the **Edit folder** dialog. One page has name → icon → color, and icon → color are the same two fields as in the host form's [Appearance] tab. When it opens, the cursor is in the name field. Enter saves and Esc closes.

- If you change the **name**, the hosts and subfolders inside follow the new name, and the folder's icon and color move with it. `/` is not allowed, and a folder with the same name on the same level is refused.
- Emptying the icon gives the default folder, and emptying the color gives the default color. A folder with no hosts does not disappear even if its icon is emptied.
- New folders are created with **Add folder…** and **Add subfolder…** (these ask only for a name).

The color applies to **basic (single-color) icons and default folders**. Logos and emoji keep their own colors. They are shown on folder rows and on group rows in the command palette. A folder's icon and color are **not passed on to the hosts inside**. Hosts inherit only from presets and defaults. They are written as `icon` and `color` under `[groups."<path>"]` in `~/.ssh/sessions.toml`.

<a id="dock-sort"></a>
### Sort

The sort button next to the find row switches between two orders. The button's tooltip shows the **current** order. The Projects section uses the same button and the same setting.

- **Name** — the default order (folders first, hosts in the order written in `~/.ssh/config`). In the Projects section, this is alphabetical order of the names.
- **Recent** — most recent **successful connection** first. Hosts that have never connected (only failed) come at the end in name order. Folder rows stay in place, and only host rows are reordered. In the Projects section, a remote project follows its host's last success, and local projects come at the end in name order.

<a id="dock-quick"></a>
### Quick connect

Connects on the spot to a target that is not in `~/.ssh/config`. If you type something like `user@host`, `user@host:2222` or `ssh -p 2222 user@host` in the find row and no host matches, a [Quick connect —] button appears (the command palette accepts the same syntax).

- Clicking [Save as host] in the notification after connecting keeps it as a `Host` block.
- Text outside the syntax (shell metacharacters, other flags such as `-i` and `-J`) is not accepted. If you need settings such as a jump host, save it as a host and change them in the form.
- It is not recorded in the connection history.

<a id="dock-installkey"></a>
### Install public key…

Connects **once** with a password and installs a public key in the server's `~/.ssh/authorized_keys`. After that, you connect with the key and no password.

- Pick the key from a list (keys in ssh-agent, key files in `~/.ssh`, or create a new one on the spot). Whichever row you pick, only the **one public key line** goes into the server. The private key never leaves for the server.
- If there is no usable key, the new key dialog opens right away. ssh-agent does not need to be running. The connection tries agent → key files in `~/.ssh` → password, in that order.

<a id="dock-forgetkey"></a>
### Forget host key…

Deletes this server's host key record from `~/.ssh/known_hosts`. The next connection confirms the fingerprint again. Use this when the key has changed because the server was reinstalled.
