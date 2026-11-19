# Messenger guide (Discord · Slack · Telegram)

Aynx can send its notifications (an agent finished, a permission prompt, a long command, task plan results …) to **Discord, Slack or Telegram**, so they reach
your phone while you are away from the PC. With a **bot**, you can also **talk back**: send a message to a local AI tile, get its full answer in the chat, and
allow or deny its permission prompts.

Everything is set up in **Settings › Notifications › Messenger › Channels** on the main PC (the PC running Aynx). The channels are listed in the same order as
below. What each row shows is described in the [Settings guide](settings.md#messenger).

| Channel | Bot | Webhook |
| --- | --- | --- |
| Discord | Notifications + talk to AI tiles (direct messages with the bot) | Notifications only, to a server channel |
| Slack | Notifications + talk to AI tiles (the app's Messages tab) | Notifications only, to a workspace channel |
| Telegram | Notifications + talk to AI tiles | — (Telegram has no incoming webhooks) |

**Which one to pick**

- To talk to AI tiles from your phone, use a **bot**. To only receive notifications in a channel other people may also read, a **webhook** is enough.
- Discord and Slack use **one method at a time** — the first line of the expanded row, **Connect with** (**Bot** · **Webhook**), picks it. Telegram has only the bot.
- All three channels can be connected at the same time. Each bot channel links **one account** of its own.

---

<a id="discord"></a>
## Discord

**Webhook**

1. In Discord, open the channel's settings › **Integrations** › **Webhooks**, create a webhook and copy its URL.
2. In the Discord row, choose **Webhook** under **Connect with**, paste the URL into **Discord webhook URL** and press **Connect**.
3. Press **Send test** to check that it arrives.

**Bot**

1. In the [Developer Portal](https://discord.com/developers/applications), press **Create App**, enter a name and press **Create**.
2. On the **Bot** page, under **Token**, press **Reset Token** and copy the token (Discord shows it only once). Leave the privileged gateway intents off — Aynx reads
   only direct messages to the bot, which do not need them.
3. You can send the bot a direct message only if it shares a server with you. On the **Installation** page, add the `bot` scope under **Default Install
   Settings** › **Guild Install** (no permissions are needed), open the **Install Link** in a browser and choose **Add to server**.
4. In the Discord row, choose **Bot** under **Connect with**, paste the token into **Bot token** and press **Connect**.
5. [Link your account](#link-account) by sending the bot a direct message.

The bot answers only direct messages; messages in servers are ignored.

<a id="slack"></a>
## Slack

**Webhook**

1. In your Slack app, open **Incoming Webhooks**, add a webhook for a channel and copy its URL.
2. In the Slack row, choose **Webhook** under **Connect with**, paste the URL into **Slack webhook URL** and press **Connect**.
3. Press **Send test** to check that it arrives.

**Bot** — needs two tokens.

1. In the Slack row, choose **Bot** under **Connect with** and press **Copy manifest**. At [api.slack.com/apps](https://api.slack.com/apps), choose
   **Create New App** › **From a manifest** and paste it. The app gets two permissions: `chat:write` (send messages) and `im:history` (read direct messages
   with the bot). It receives messages over **Socket Mode**, so the PC needs no public address.
2. Install the app to your workspace under **Install App**. The **Bot User OAuth Token** it shows (`xoxb-…`) is the bot token.
3. Under **Basic Information** › **App-Level Tokens**, create a token with the `connections:write` scope. That token (`xapp-…`) is the app token.
4. Paste both into the Slack row (**Bot token** · **App token**) and press **Connect**.
5. [Link your account](#link-account): open the app from your app list in Slack and send any message in its **Messages** tab.

The bot answers only direct messages (the app's Messages tab). Slack shows the linked account as a member ID (for example `U024BE7LH`) instead of a name.
Where Discord and Telegram use a reply, Slack uses a **thread**: post in the thread of the bot's message to reach the tile it came from.

<a id="telegram"></a>
## Telegram

Telegram has no incoming webhooks, so it always uses a bot.

1. In Telegram, send `/newbot` to `@BotFather` and copy the token it gives you.
2. Paste the token into **Bot token** in the Telegram row and press **Connect**. From then on the row header shows a **Bot** chip, like the Discord and Slack rows.
3. [Link your account](#link-account) by sending your bot any message from your phone.

<a id="link-account"></a>
## Linking your account

The last step is the same for every bot. Once the token is accepted, the row shows **Connect account** and waits.

1. Send the bot a message from the account you want to use (a direct message on Discord, the Messages tab on Slack, any message on Telegram).
2. The bot replies with a 6-digit code, and the row shows **… asked to connect** with the same **Connection code**.
3. Press **Allow** only if the two codes match (**Deny** refuses). Only that one account is accepted from then on.

A code is valid for 10 minutes; after that, send the bot another message for a new one.
To link a different account later, press **Reconnect** on the **Connected account** row and send the bot a message again.

<a id="talk"></a>
## Talking to AI tiles

With a bot linked, the expanded row has **Talk to AI tiles from the messenger** — **off by default**, and it can be turned on only at the main PC.

- **Reply** to a message from the bot (on Slack, post in its **thread**) to send your message to the tile it came from. A message that is not a reply goes to the only tile waiting for input; if several are waiting, the bot asks you to pick one.
- The full answer comes back when the turn ends, and permission prompts arrive with **Allow** and **Deny** buttons.
- Only local Claude Code and Codex tiles that have finished a turn and are waiting for input receive messages. Task plan approvals are never answered from the messenger.

The full rules (how tiles are named, message limits, when a message is refused) are in [Talk to AI tiles from the messenger](settings.md#messenger-chat).

<a id="good-to-know"></a>
## Good to know

- **The token or URL is not shown again** once you press **Connect**. To change it, disconnect and connect again.
- **Bot tokens, linked accounts and switching methods are main-PC only** — a remote window cannot set, change or remove them.
- **One bot, one program.** Give each Aynx install (for example a development build and the release) its own bot, and do not share it with other tools.
  - Telegram: if another program is receiving the bot's messages, the row shows **Not receiving** · **Another program is using this bot**.
  - Discord gives no such signal: two programs on the same bot both receive every message.
  - Slack gives no signal either: two programs on the same Slack app each get only some of the messages.
- **Messages sent while the PC or the app was off are not delivered later.**
- Discord resets the token of a bot that logs in too many times in a day. When Discord refuses the connection this way, Aynx stops reconnecting until you
  register the token again or the session server restarts.
- **Disconnect** on the **Disconnect bot** row removes the token (both tokens on Slack) and the linked account together.

## Security

Webhook URLs, bot tokens and linked accounts are stored only on this PC, each channel in its own file outside the settings file. Only the session server reads
a bot token, and it sends it only to that messenger's own API. They never go to the settings screen, the AI integration (MCP), logs, remote windows or
[Move settings](settings.md#settings-export). Mentions are always blocked in what Aynx posts.

What does leave the PC: the notification text you chose under **Rules**, and — with talking to AI tiles on — the full answers, a one-line summary of each
permission prompt, and the names that identify your tiles, all passing through that messenger's servers. A linked account can allow or deny an agent's own
permission prompts, but cannot approve task plans, change AI access or reach the vault. See the [security notes](../security.md).
