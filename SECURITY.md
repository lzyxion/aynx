# Security policy

English · [한국어](SECURITY.ko.md)

## Supported versions

Fixes go into the latest release only. Aynx is a personal project with a single maintainer, and you get fixes through the in-app update.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting: the repository's **Security** tab → **Report a vulnerability**, or [this link](https://github.com/lzyxion/aynx/security/advisories/new).

Helpful details:

- Aynx version and Windows version
- Steps to reproduce
- What an attacker can do with it
- Logs or screenshots, with passwords, tokens and other secrets removed

## After you report

The report is confirmed and answered in the advisory. Once a fixed release is out, the advisory is published. There is no bug bounty.

## Scope

In scope is anything that breaks a guarantee in the [security notes](docs/security.md), for example:

- Vault values reach the GUI, settings files, logs or MCP, or otherwise leave the session server process.
- A command runs without your approval or outside the scope of an auto-approval policy you set.
- An AI approves its own task plan, or something merges into main without your Merge button or the auto-merge you turned on for an album.
- The MCP server runs commands, sends keys or approves anything.
- Remote web access is reachable other than through `tailscale serve` on your main PC, or from a device that was not paired at the main PC.
- Vault values, MCP tokens, webhook URLs or bot tokens are sent to a remote window.
- A paired messenger account approves task plans, changes AI access or reaches the vault.

These are documented limits, not vulnerabilities:

- Without a master password, anyone signed in to your Windows account can open the vault.
- Environment values for external stdio MCP servers are visible to processes of your account while the vault is open.
- Verification commands and orchestration artists run with your user rights and no sandbox.
- Messenger replies pass through that messenger's servers.

Problems in Claude Code, Codex, Tailscale or other programs Aynx runs belong with those projects.

[Security notes](docs/security.md) · [Back to README](README.md)
