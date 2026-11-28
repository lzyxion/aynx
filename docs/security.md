# Aynx security notes

English · [한국어](security.ko.md)

- **Vault is opt-in.** Without it, passwords are used once and asked again next time. Vault values stay inside the session
  server process — the GUI, settings files, logs and MCP never see them. Private key files are never stored.
  Without a master password, anyone signed in to your Windows account can open the vault; the app says so.
- **One known exception:** environment values for external stdio MCP servers are handed to that server in plain text while the
  vault is open, so treat them as visible to processes of your account, including the agent in that tile.
- **The MCP server reads, plans and coordinates orchestration; it has no tool that runs commands, sends keys or approves.** It is not registered in your
  CLI config — tokens go only to local AI tiles and integrated local shell tiles that Aynx launches, and remote tiles get a signal-only token.
- **Execution happens only inside what you delegate:** your approval in the app, or an auto-approval policy with an explicit
  scope. An AI cannot approve its own plan. Orchestration artists run with the permission grade you set in the album, and
  merging into main happens only through your Merge button or auto-merge you turn on for an album (needs a verification command and a risk confirmation) — no AI or MCP path exists, and the app never pushes.
- **Verification commands and artists run with your user rights and no sandbox.** There is no OS isolation yet.
- **The chat form of an AI tile does not ask about folder trust.** It drives the CLI over its non-interactive channel, so the CLI's trust question is never shown, and Aynx neither checks nor records trust.
  Opening a newly downloaded repository in chat form can run that repository's project hooks and MCP configuration without the question the terminal form would ask. This is an accepted limit; the terminal form is still available for such folders.
- **A Codex conversation with an active goal keeps working on its own when its CLI starts.** Opening that conversation in chat form starts Codex's turns again
  the moment the CLI launches (sending a message, previewing a rewind or starting a review) — the same as reopening it in the terminal form. In chat form you stop it with the goal bar's Pause or Clear.
- **Claude chat tiles run with the CLI's file checkpointing on**, so Claude Code keeps the original copies of files it edits under `~/.claude/file-history` — the same place the terminal form uses. Aynx neither reads nor writes that folder.
- **Remote web access** binds to `127.0.0.1` and is reachable only through `tailscale serve` on your main PC (started by you or by **Connect** in Settings, which never enables Funnel); devices must be paired at the main PC.
  Vault values, MCP tokens, webhook URLs and bot tokens are never sent to remote windows.
- **Talking to AI tiles from a messenger is off by default.** It works with a Telegram bot, a Discord bot and a Slack bot (Discord and Slack: direct messages only). You turn it on at the main PC for each channel and pair one account per channel with a code shown there. Messages from that account are typed only into a local AI agent tile that is waiting for input — never a shell, a remote tile or an agent that has exited — and the agent's full reply goes back through that messenger's servers (Telegram's, Discord's or Slack's), along with the names that identify your tiles (with their conversation titles). That account can also allow or deny the agent's own permission prompts. It cannot approve task plans, change AI access or reach the vault, and it keeps working while the privacy veil is up.
- Port forwards bind to `127.0.0.1` only. Agent forwarding is off by default and enabled per host.
- Session logging is off by default and enabled per session.

[Back to README](../README.md)
