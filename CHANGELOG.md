# Changelog

All notable changes to Aynx are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Each version's section is used as-is when that version is released:

- Text **before** `### What's new` appears only on the GitHub release page (for example, "uninstall the old version first").
- The `### What's new` list appears on the release page **and** in the in-app update card.

Write the next version's section before tagging it — the release workflow stops if the tagged version has no section here.

## [Unreleased]

### What's new

- **Review card [Later]**: move the review card out of the way to check your tiles first. Waiting plans stay in the chat dock's task plans branch, and a new plan brings the card back.
- **Task plans in a remote window** open in the remote window's chat dock, the same as on the main PC, instead of covering the tiles.
- **Clearing task plans**: the bottom row of task plans has **[Clear finished runs]** (Active) and **[Clear history]** (History). In History, **×** on a row clears one run, and with a filter set
  the button clears only the rows you see. Cleared rows slide out like alerts. History is cleared from the screen only — the audit log is kept.

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

[Unreleased]: https://github.com/lzyxion/aynx/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/lzyxion/aynx/releases/tag/v0.1.2
[0.1.1]: https://github.com/lzyxion/aynx/releases/tag/v0.1.1
[0.1.0]: https://github.com/lzyxion/aynx/tree/v0.1.0
