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
- **Remote web access** binds to `127.0.0.1` and is reachable only through `tailscale serve` on your main PC (started by you or by **Connect** in Settings, which never enables Funnel); devices must be paired at the main PC.
  Vault values, MCP tokens and webhook URLs are never sent to remote windows.
- Port forwards bind to `127.0.0.1` only. Agent forwarding is off by default and enabled per host.
- Session logging is off by default and enabled per session.

[Back to README](../README.md)
