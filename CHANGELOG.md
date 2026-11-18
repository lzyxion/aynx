# Changelog

All notable changes to Aynx are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Each version's section is used as-is when that version is released:

- Text **before** `### What's new` appears only on the GitHub release page (for example, "uninstall the old version first").
- The `### What's new` list appears on the release page **and** in the in-app update card.

Write the next version's section before tagging it — the release workflow stops if the tagged version has no section here.

## [Unreleased]

### What's new

- **Claude Code and Codex tiles can let the AI read them too**, per tile and off by default — the same **Allow AI to read** as a shell tile.
- **Local tiles show AI reading more simply**: **Allow AI to read** is now a check row in the tile ⋯ menu (and the terminal right-click menu) instead of the **AI access…** popover. While it is on, an eye chip shows in the tile header; press it to turn reading off. When it is off, there is no chip. Remote and query tiles are unchanged.
- **The side chat can link several tiles at once** — up to 8. Check them in **+** › **Link a tile** (the menu stays open while you pick), and each linked tile gets its own chip above the message box; its × unlinks just that tile. The list shows each tile's icon — the same logo as its tab and header (shell, Claude/Codex or avatar, host) — with the tile code dimmed after the name.
- **AI access chips are readable on any terminal theme**: with a light app theme and a dark terminal (or the other way round), the **Ask**, **Auto** and **YOLO** chips in terminal and AI tile headers — and in the header chip preview in **Settings › Terminal** — blended into the background. Their colors now follow the terminal background instead of the app theme.

## [0.1.4] - 2026-11-18

### What's new

- **Tab templates**: right-click a tab and choose **Save template** to keep its layout and what each tile connects to — shell, AI agent, host, database. Opening a template builds the same tab again with new sessions, so you don't have to reconnect the same hosts and databases for every task.
  - A template saved with a project shows on that project's start page (pick one with a click or the number keys 1–9) and in the command palette.
  - AI tiles always start a new conversation. Folders are kept relative to the project, so a template follows whichever worktree you open it in.
  - Saving under a name that already exists asks before replacing it. Deleting a project deletes its templates too.
- **Settings › Templates** lists every tab template, including ones without a project, newest first, each with its layout preview. Open a template to rename it, move it to another project (or to none) or delete it — folders inside the project are re-based on the new project's folder; **Manage templates…** in the command palette opens it. Template layout previews (here, on the project start page and in the save dialog) show each tile's logo — shell, Claude/Codex, host, database engine. On the project start page, clicking a template that has an AI tile selects it first, so you can **Resume** a past conversation or pick Claude · Codex for a new one in that layout's first AI tile (click the card again to deselect it; the CLI the template already uses opens it as saved).
- **Move settings to another PC**: **Settings › General › Move settings** exports your settings to one .zip and imports them on another PC.
  - Hosts, AI permissions, database connections, projects, templates, themes, shortcuts, agent instructions, MCP servers, artists and other settings can be picked by category. The vault, tokens, webhook URLs, remote devices, sessions, conversations and album records are never included, and neither are key files or database passwords.
  - Importing shows a preview first: what each category adds or changes, a list of the changed items, and what to do with values that differ. AI permissions come in as they are in the file by default, or you can bring them in Off.
  - `~/.ssh/config` is never overwritten — only new hosts are added at the end. Projects whose folder isn't on this PC are listed with a button to choose the folder here.
  - Your current settings are backed up before anything is changed.
- **Discord and Slack notifications** are easier to act on from a phone.
  - Each message starts with its grade: 🟡 **Needs action** (a permission request, a task plan waiting for approval, an album that needs you), 🟢 **Done**, or ❌ **Failed**. The app name is no longer repeated on the first line.
  - Messages are named by project / worktree, also for long commands, instead of the tile name.
  - **Include conversation text** is now on by default. A finished turn carries up to 500 characters of the last reply with its line breaks kept (the first and last paragraphs when it is longer), and a permission request names the command being asked about.
  - Album notices follow **Send when** even while the app window is open, and only the ones that need you, finish or fail are sent.
  - Not sent anymore: program notifications from AI tiles (they repeat the turn-end alert), turns shorter than a minute, and the same alert from the same tile twice within 30 seconds.

## [0.1.3] - 2026-11-15

If you install this version by hand instead of updating from inside the app, use **End all sessions** from the tray once afterwards. The session server changed, and file upload stays blocked until it restarts.

### What's new

- **Side chat composer**: one row with **[+]** (upload file · link a tile · MCP) and a model menu: switch between Claude Code and Codex, pick a model, and set effort on a slider. The remote web client and the phone have the same menu.
  - **[+] › MCP** lists the MCP servers the chat will load, even before your first message.
  - On a phone, and in a chat dock dragged very narrow, the model button shows only the logo, leaving more room to type. Its tooltip and menu still show the model and effort.
  - Seeing a side chat alert in one window clears it in the others.
- **Upload file**: the **[+]** menu in the side chat and in AI tiles now says **Upload file** (with a paperclip icon) and takes any file, not just images.
  - Up to 8 files per message, 10 MB each. The AI reads them without asking for permission.
  - Side chat copies are kept in that chat's own folder and are removed when you delete the chat. A chat continued from a tile doesn't write anything into the tile's folder.
  - In the chat history, an attached file shows as a file chip, and an image you just sent shows as the image itself.
- **Model and effort in AI tiles**: the chat view of an AI tile shows the current model and effort and updates as soon as you change them. Changing them from the menu asks first with a **Switch model** or **Change effort** card.
- **Copy**: messages in the side chat and in the chat view of AI tiles have **[Copy]** (tool output is left out).
- **Model names** are written the same way everywhere: the chat list, past conversations, the session board's usage and the orchestration player show `Opus 5.5` or `GPT-6.1-Sol` instead of the raw id, and effort shows as `High`.
- **Alert banners** show only the tile or chat name in the title. The logo already says which agent it is.
- **Image tile**: double-click an image in a file tile (local or SFTP) to open it inside Aynx. Image paths in the terminal, in documents and in the side chat open there too.
  - Fit or 1:1, zoom with the wheel around the pointer, drag to pan, and double-click to switch between fit and 1:1.
  - **←** and **→** step through the other images in the same folder. The image reloads when the file changes.
  - A minimap shows where you are when zoomed in. Turn it on or off from the zoom menu or with **M**.
  - Large images download with a progress bar and **[Cancel]**. Above 500 MB, Aynx asks first.
  - **Open with default app** and **Edit externally** moved to the right-click menu.
- **Phone**
  - Reopening the remote web client brings back the tab and tile you were viewing, even if the main PC moved to another tab meanwhile. If that tile was closed, it follows the main PC. A remote window on a PC does the same when it reloads.
  - The **+** sheet can open a tile in the tab you are viewing: pick **This tab** or **New tab** at the top. **+** in the top strip starts on **This tab**, and **New tab** on the picker screen starts on **New tab**.
  - Each tile row on the picker screen has a small **×** to close that tile without picking it first. A tile with a session asks first, as before.
- **Remote window**
  - Closing a tile or tab with a document you edited in the remote window itself now asks to save or discard it first. It used to close without asking.
  - Task plans open in the remote window's chat dock, the same as on the main PC, instead of covering the tiles.
- **Task plans**
  - **Review card [Later]**: move the review card out of the way to check your tiles first. Waiting plans stay in the chat dock's task plans branch, and a new plan brings the card back.
  - **Clearing**: the bottom row has **[Clear finished runs]** (Active) and **[Clear history]** (History). In History, **×** on a row clears one run, and with a filter set the button clears only the rows you see. History is cleared from the screen only — the audit log is kept.
- **New shortcuts for the chat dock**: the chat dock now opens with **Ctrl+Shift+[** (it was Ctrl+Shift+'), and the task plans branch with **Ctrl+Shift+]** (it had no default). Both work inside the document and SQL editors too, and Ctrl+[ still goes to the shell as Esc. If you set your own key in **Settings › Shortcuts**, it stays as it was.
- **Search in the terminal**: the match you are on is now filled with the accent color and the other matches are tinted, so the current one stands out. Jumping from **Search all** lands on the exact line you picked and keeps it highlighted. Closing the search no longer leaves a selection behind.
- **Maximized tiles**: opening a file, jumping from search, clicking an alert or picking a tile in the session board now un-maximizes the tab when the target tile was hidden behind it.
- **Keyboard focus**: closing the session board, the shortcut sheet, settings or the chat dock returns the keys to the tile you were in, including terminal tiles. Switching between the chat and task plans branches keeps focus in the dock.
- **Document tile**: in a narrow tile the title shortens first, so **Save** and the other buttons stay visible.

## [0.1.2] - 2026-11-12

**Install this version by hand once.** 0.1.1 can't update itself. From 0.1.2 on, Aynx tells you when a new version is out and updates from inside the app.

### What's new

- **In-app updates**
  - Aynx checks for a new version on start and every 6 hours. It only tells you: a chip in the status bar and one notice. Nothing downloads or installs until you choose.
  - The update card shows what changed and which sessions would end. **Update** downloads it, and **Restart now** installs it. You can also skip a version.
  - Every update is checked against Aynx's update signing key before it runs. An MSI install updates through the MSI, and a per-user install through the setup.exe.
  - Turn the automatic check off in **Settings › General › Updates**.
- **Tiles come back where you left them**: after Aynx or its session server restarts, a shell tile opens in the last folder you were in, and a local AI tile resumes its last conversation (Claude Code and Codex). Splitting an AI tile now starts a new conversation instead of opening the same one twice.
- **Settings › General** is grouped into Display, Startup & connections, File tiles, Session server and Updates. **Auto-lock when idle** moved to **Settings › Security**, next to the vault it locks.
- Builds and releases now go through Windows CI.

## [0.1.1] - 2026-11-11

The app was renamed from **AYNX** to **Aynx**. Uninstall the previous version before installing this one.

### What's new

- **Document tile**
  - Clicking `file.ts:12`, `file.ts:12-20` or `file.ts#L12` in a terminal or in an AI tile's conversation view opens the file at that line.
  - Code blocks have **Copy** and **Insert into terminal**. Comment lines are left out, and nothing runs until you press Enter.
  - New document, compare with the version on disk, and move an unsaved document to a new window.
  - The editor highlights math and footnotes.
- **Query tile**: a data tab, filtering the result grid, following foreign keys in both directions, export, SQL autocomplete, and opening and saving `.sql` files.
- **AI database access**: AI now reaches a database the same way it reaches an SSH host. While your query tile is connected, AI uses that connection's password from memory. Opening a database with no tile is a separate per-connection switch.
- **Claude models**: `fable` is in the model suggestions for side chat and orchestration.
- **Docs**: a [Getting started](https://github.com/lzyxion/aynx/blob/main/docs/user/getting-started.md) guide.
- Smaller fixes in remote access, the tab bar menu, and orchestration cleanup.

## [0.1.0] - 2026-11-08

### What's new

- First public release.

[Unreleased]: https://github.com/lzyxion/aynx/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/lzyxion/aynx/releases/tag/v0.1.3
[0.1.2]: https://github.com/lzyxion/aynx/releases/tag/v0.1.2
[0.1.1]: https://github.com/lzyxion/aynx/releases/tag/v0.1.1
[0.1.0]: https://github.com/lzyxion/aynx/tree/v0.1.0
