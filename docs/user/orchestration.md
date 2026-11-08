# Orchestration guide

**A person sets the scope and opens an album. A producer AI splits the work into tracks and hands them to artist AIs.** Artists run without a screen (headless), and
the app combines their results into one branch. You watch from the orchestration tab, can pause or cut things off at any time, and at the end merge into main with **Merge** (or let an album you opted in merge itself).

| Screen term | Meaning |
|---|---|
| **Album** | One orchestration. It runs in **one local git repository** |
| **Track** | One task inside an album |
| **Artist** | A profile for an AI that does the work (Worker or Reviewer). It holds no permissions — permissions are set per album |
| **Producer** | The AI chat that coordinates the album. It is read-only and does not edit files itself |

You do three things.

1. **Open an album** — in [New album], set the repository, the artists and their permissions, acceptance rules, verification and limits, then send the first message.
2. **Step in when needed** — widen a blocked artist's permissions, confirm verification runs, accept or reject, pause or cut things off.
3. **Merge into main** — press **Merge** on the album, or turn on **Auto-merge when complete** for that album. Nothing is pushed.

The producer and artist CLIs are Claude Code and Codex. For each track, an artist works in a **git worktree** of the repository (a separate working folder and branch).
Remote (SSH) artists do not exist yet.

---

<a id="screen"></a>
## 1. Screens — library › studio › album › track

The Orchestration cell in the launcher dock (headphones) or **Orchestration** in the command palette opens the orchestration tab. If the current workspace already has such a tab, the app navigates
inside it; otherwise it creates one. Albums do not get a tab each — use **Open in new tab** only when you want to view the same album separately. ← and `Esc` go up one level.

- **Library** — artists on the left. On the right: **New album**, the view chips (All · In progress · Ended · **Archive · n**), **Studios** (a square card for each repository, counting only albums that match the view chip, with a playing mark if one of them is in progress — click a card to open that studio), **Recent** (albums in progress first, then the most recently updated, up to five) and the album list. The two buttons beside the **Albums** title switch albums and the archive between square cards (the default) and rows; the choice is remembered on that device.
- **Studio** — one repository's albums. The head shows its name, full path and album counts, with **New album** (that repository already selected). Below it are the same view chips, limited to this studio, then **Recent** and the album list. An album opened from here returns here with ← and `Esc`.
- **Album** — the producer chat on the left. On the right: the album head, the track table, the remaining limits and the timeline.
- **Track** — the selected artist's run timeline in the middle. On the right: status (an amber card if a person needs to confirm something), attempts, reviews, changed files and work resources.

The **playback bar** at the bottom of the tab shows: the current song (click to go to that track) · ■ Stop album · ⏸ Pause / ▶ Resume · ✕ interrupt the producer's reply · coordination time · running artists · reviews used ·
🔔 things that need you (when a count shows, click it to go to that track).

<a id="artists"></a>
## 2. Artists — who does the work

The artists panel in the library leads to the **Artists** screen. This is the only thing you prepare ahead of time. Two artists exist at first: **Builder** (Claude · Worker) and
**Reviewer** (Codex · Reviewer).

| Field | Meaning |
|---|---|
| Name · icon | Names are 1–40 characters and must be unique in the list |
| CLI | Claude Code · Codex |
| Kind | **Worker** (edits in a worktree, commits and reports) · **Reviewer** (only reads the reported commit and gives a verdict). It cannot be changed after creation |
| Model · effort | Blank uses that CLI's default |
| Instructions | Text for this artist (up to 4 KiB). Do not put secrets here — it is written as is to a file in the settings folder |

- **Permissions and allowed commands are not here** — they are set per album. An artist only says "who does the work".
- Changes reach the in-progress albums it participates in **from the next turn**. If you change the CLI, a running attempt cannot continue, and the producer must start a new one.
- An artist participating in an active album (Running · Paused · Stopping) cannot be deleted.

<a id="album-start"></a>
## 3. New album — the only way to open an album

**An album comes into being only at the moment a person sends the first message in [New album].** AI and MCP have no way to open an album or widen its configuration. The producer chat is tied to that album
from the start and receives the first message.

You can get there through **New album** in the library; **New album in this repository** in the command palette, the project right-click menu and the status bar item (if a project is targeted, the draft is locked to its repository); and
[Continue in orchestration](#fork) in the AI tile menu.

- The draft exists **only in the window's memory** — if you leave without sending, it is gone. There are no empty albums.
- Sending creates the album, fixes the configuration, and the producer receives the first message. If the start fails, the draft stays and the reason shows in one line. If the album was created but only the first message
  could not be delivered, you move to the album and the text is put back in the input box.
- At most **two** albums can be active.

Pick the **producer CLI** in the left column. Clicking the selected card again opens the model and effort fields. The name can stay blank — it is taken from the first message. The right side has four cards.

### Studio

A studio is the git repository where the artists work. Local git repositories in the project dock appear as chips, and **Other project…** lets you type a full path. It must be a **main repository** with an initial commit (linked worktrees and
junctions cannot be used). Artist worktrees are created in the `<repository name>-wt` folder next to the repository.

### Artists · Permissions

**The last album configuration for the same repository fills in as the default** (if there is none: one Worker on Auto edit, and one Reviewer needing 1 pass). Defaults are only a draft — the configuration applies only after a person reviews it and sends.
Add artists with **+ Artist** (up to 8 per album) and remove them with ✕. **At least one Worker with Auto edit or higher is required** to start.

| Permission | Claude Code | Codex |
|---|---|---|
| **Read** | The artist is in the album but cannot be given work — if the producer tries to start it, the request is refused, and the producer asks a person to raise it | Same |
| **Auto edit** (medium risk) | Edits inside the worktree without asking · runs only **allowed commands** · refuses everything else | Does not ask inside the sandbox · refuses writes outside the worktree · **allowed commands do not apply** |
| **Full auto** (high risk) | Runs everything without asking · no sandbox | Runs everything without asking · no sandbox |

A Reviewer is always read-only — instead of a permission field it has an acceptance rule field.

- **An allowed command also entrusts the scripts that command calls.** `npm run` and the like call the `package.json` scripts, and the artist can change those.
- Artists have **no permission prompts.** The CLI refuses anything outside the delegated scope without asking, and the artist reports **Blocked** ([Blocked](#blocked)).
- Artists do not inherit allow rules, hooks or plugins from user or project settings (the app controls this through arguments). Claude artists do not read the global
  `~/.claude/CLAUDE.md` on their own, so the app includes it along with the artist's instructions. Codex artists always load `~/.codex/AGENTS.md`.
- Network access is always on for Codex artists.

**Acceptance rules** — "Needs N pass(es) to accept" on a Reviewer row (0–3; 0 means no required review). For the producer to accept a track, the current configuration's pass count must be met. If it is not,
the acceptance is refused and the producer is told what is missing. **A person's acceptance overrides the rule and records the skipped rule as a waiver.** Verification → integration cannot be removed by a rule.

### Verification

A one-line command (e.g. `npm ci && npm test` — blank means no verification) and a mode (**Ask a person** · **Run automatically**). With a command, you can also set the time limit, kept folders, cache key files and extra environment
variable names. **Only a person sets the verification text, and only here** — it is fixed when the album starts and does not change midway. See [Verify before accepting](#verify) for details.

Under it is **Auto-merge when complete** (off by default, never carried over from an earlier album). It needs a verification command. See [Merge into main](#merge).

### Limits · Other

| Field | Default | Range | After the album starts |
|---|---|---|---|
| Concurrent artists | 3 | 1–3 | **Fixed** |
| Total artists | 8 | 1–8 | **Fixed** |
| Coordination time (min) | 120 | 1–120 | **Fixed** |
| Turn timeout (min) — the longest one artist turn can run; past it, the app ends the turn | 60 | 1–240 | **Fixed** |
| Total verdicts | 6 | 1–20 | **Fixed** |
| Rework limit — how many times the same track can be sent back to work after a rejection; past it, the producer cannot start it again | 3 | 0–10 | [Album permissions] |
| Wake-ups between human messages ([AYNX woke the producer](#wake)) | 30 | 0–200 (0 = off) | [Album permissions] |
| Allow producer plan tools | Off | On · Off | [Album permissions] |

If you turn on any of **Full auto · Run automatically (verification) · producer plan tools · auto-merge**, a risk box appears, and you must check **I understand the risks and delegate this scope for this repository** before you can send.
With plan tools on, the producer can create and change task plans.

Starting an album from a remote web window asks for the master password again.

<a id="fork"></a>
### Continue in orchestration

**Continue in orchestration** in the AI tile menu forks that tile's conversation into a **new album draft with the repository and CLI locked**. The original tile stays as it is. The app determines the repository from the conversation's
folder (it does not open unless that is a main repository). The album comes into being only after a person sets the configuration and first message and sends them — the tile does not open the album. This item appears only on local AI tiles that
know their conversation (after the AI has answered once).

<a id="producer"></a>
## 4. Producer — the chat that coordinates the album

The producer is **not a tile but the chat on the left of the album**. It splits the work into tracks (so that edit scopes do not overlap) and starts artists chosen from those in the album. It cannot choose a CLI, model or permissions, only
a name — the app adds the rest from the album configuration and the artist list.

- **It is read-only.** A Claude producer has read tools only, and a Codex producer has a read-only sandbox only. File changes, wider command scope, external MCP and web search cannot be allowed
  even through a permission card — they are refused with no card, and one line appears: "The producer cannot change files or widen its command scope — hand that to a worker".
- **Only two kinds of card can be [Allow]ed by a person**, and only for a Claude producer: reading files outside the album's repository, and AYNX DB reads. A Codex producer has no cards, and its DB query is allowed in advance — in either case, the connection's AI permission decides whether rows can be read.
- **Its lifetime is the album.** Going back to the library or closing the tab does not cut it off, and it carries on when you return. One chat belongs to only one album.
- It ends with: **End producer** in the head (after confirmation — the album pauses coordination and artists keep running · [Take over](#adopt)) · the end of the album (it closes the moment it is idle, and is cut off and closed within 10 minutes at the latest) · a session server restart.
- Messages sent during a reply wait in a **queue** (up to 3) and are delivered when the turn ends. **Stop reply** (✕) stops only the reply and holds the queue · **Interrupt and deliver** interrupts and sends the queued messages right away.
- Click the model and effort in the head to change them during the conversation (from the next turn).

<a id="wake"></a>
### AYNX woke the producer

When something happens in the album while the producer is idle (a report, a block, a verdict, an integration, a conflict, a verification failure, a person's acceptance, rejection or resume, a change to album permissions, and so on), **the app wakes the producer.** This appears in the middle of the chat
as a dashed pill: "AYNX woke the producer · #1 reported".

- The app writes the wake-up text in a fixed form — it carries **only IDs, numbers and kind words**, with no free text such as titles, reports, conversations or commands. Kind words can be influenced by an AI's report, so they are not a person's instruction or approval.
- The app wakes the producer only when the album is running, there is no hold and the producer is idle. It does not wake on pause, on hold or at the coordination limit.
- Limits: **wake-ups between human messages** (default 30 · back to 0 when a person speaks) · **200 total per album** (fixed, never reset) · at least 20 seconds apart · stops after 3 consecutive wake-ups with no response · a woken turn has a 30-minute time limit.
- When waking stops, a band appears in the chat and you get a notification. **Message the chat to continue.**

<a id="permissions"></a>
## 5. Album permissions — changing the configuration midway

**Album permissions** in the album head (only when Running or Paused) is the only place to change the configuration. **Only a person can change it.** AI and MCP have no way to write it.

- What can change: adding and removing artists · permissions · allowed commands · acceptance rules · rework limit · verification mode (Ask a person ↔ Run automatically) · auto-merge · plan tools · wake-up limit.
- What cannot change: **the verification command, its time limit and advanced fields, and the five limits** ("Fixed" in the table above). They are fixed when the album starts. To change them, open a new album.
- **Widening and narrowing both apply from the next turn.** A running turn finishes as it is. The app wakes the producer with "Album permissions changed" to tell it.
- An attempt by an artist removed from the album cannot continue to its next turn.

At the bottom of the panel, you can see whether this change will **Widen execution scope** or **Keep or narrow scope**. The server judges this again.

| Widens | Does not widen |
|---|---|
| Raising a permission · adding a Worker above Read | Lowering a permission · removing an artist |
| Adding an allowed command | Removing an allowed command |
| Verification Ask a person → Run automatically | Run automatically → Ask a person |
| Turning plan tools on | Turning plan tools off |
| Turning auto-merge on | Turning auto-merge off |
| Raising the wake-up limit · raising the rework limit | Lowering the wake-up limit · lowering the rework limit |
| Removing a required review · lowering the pass count | Adding a required review · raising the pass count · adding a Reviewer · adding an artist at Read |

Widening from a remote web window asks for the master password again (changes with no widening do not ask). If another window changed it first, the latest configuration is reloaded and you are asked to review it again.

<a id="album"></a>
## 6. Watching from the album board

The album head shows the repository, track count, accepted count, integration head and participating artists. Once exported, a line shows the branch and **Merge**. The **⋯** menu holds Pause, Resume, Complete album, Copy merge command, Album info, Clean up worktrees, Archive album and Stop album, each shown only when it applies. **Album info** adds a line under the head with the producer, elapsed time,
verification command, remaining reviews and producer generation. Below the track table (or on the right if there is room) are the **Remaining** limits and the **Timeline**.

### Album states

| State | Meaning |
|---|---|
| Running | The producer can use coordination tools |
| Paused | **Coordination paused — artists keep running.** Coordination tools are refused. The band under the board shows why: [Pause](#brakes) · the producer exited · coordination time limit · on hold |
| Stopping · Stopped | [Stop](#brakes) was pressed — it becomes "Stopped" only after all artist processes, verification and integration in progress have ended |
| Done | The producer completed it, or a person used [Complete album](#done) |
| Read-only | The session server restarted — see [Known limits](#limits) |

While the **hold bar** is up, the album stays paused, and new tracks, new artists, acceptance and **Resume** are blocked.

| Hold | Meaning · how to release it |
|---|---|
| The integration ref is not the head the app knows | Someone moved the integration ref outside the app (or the commit result is unknown) — **Reconcile**: **Revert** (back to the head the app knows — the head a person moved it to is kept in `diverged/<n>`), or **Accept** (check in the table that the accepted tracks' results are in the current head, and tick the box). Revert commits are not caught by this table |
| The repository is not the one the album started with | It was cloned again at the same path or replaced with a link — restore the repository and use **Release hold**. An album's repository identity is fixed at start, so it cannot move to a new repository (in that case, stop the album and open a new one) |
| The integration intent could not be saved | The album file could not be written to disk, so nothing was committed — check the disk and use **Release hold** |
| Unexpected changes in a server temp folder | See [Clean up](#cleanup) below |

Releasing a hold leaves the album paused. To continue, use **Resume**.

<a id="track"></a>
### Tracks

A track is one task: **To do → Active → Reported → Integrating → Accepted / Rejected** (or Cancelled · Conflict). A track that depends on another shows that track's name with `↳`. Click a track to go to the track screen.

- **Report** — when an artist finishes (even in failure), it reports: outcome (Success · Failure · Blocked), summary, reported commit and number of changed files. **A report is not an acceptance.** **Files** shows the same list the producer sees
  (pinned to the reported commit). **View diff** opens base … reported commit in a diff tile (the repository must be in the project dock).
- **Roles · Judgments** — shows each artist and Reviewer that worked on the track, with pass or changes requested. A reported track shows **Acceptance rules met** (or what is missing) and rework as `used/max`.
- **Acceptance = integration** — when the producer (or a person) asks to accept, the app stacks the report on the album's [integration ref](#integration) as **one squash commit**. Meanwhile the track is **Integrating** (with its phase and **Cancel integration**, available up to the moment of the commit).
  It becomes **Accepted** at the moment it lands. A conflict makes it **Conflict**, and a failed verification returns it to **Reported**.
- **A person's acceptance and rejection** — the producer does this, but a person can too from the track screen. A person's acceptance overrides the acceptance rules and records a **waiver** on the track. Overriding a failed verification is not a waiver, but a separate action: [Accept despite failure](#verify).
- A report with uncommitted changes cannot be accepted (the artist must commit and report again). If the worktree was not on that attempt's branch, or HEAD does not descend from the base commit,
  it shows **Other branch · Off base** and also cannot be accepted. With no new commit and no changes, it shows **No changes**.
- **Flip to rejected** — an acceptance already on the integration ref is not flipped. To undo it, run `git revert <integration commit>` on the integration ref yourself, then mark that track as rejected in the hold bar's **Reconcile › Accept** —
  **and re-verify the tracks that depend on it.**
- **Cancel track** and **Reopen track** are in the ⋯ at the bottom of the track screen.

### Artists

An artist's attempt **has no tile** — one CLI run with no shell (= one turn) runs and ends. A follow-up instruction is a **new turn** that continues the same conversation.

| State | Meaning |
|---|---|
| Starting up · Running a turn | Creating the worktree and running the turn |
| **Idle** | The turn ended and there is no report yet — the worktree and conversation stay, and the producer can send it back to work with the next instruction (it does not take a concurrency slot) |
| Reported · Exited · Stopped | It reported · a Reviewer ended without a verdict · it was stopped |
| Stop unconfirmed | Whether the whole process tree of a stopped turn has ended is not confirmed yet — the app checks again |

Click an **Attempts · Reviews** card on the track screen to switch the middle timeline to that attempt. The **Work resources** card shows the turn number, tools, denial count, the permission arguments actually loaded, the turn history and the worktree location.
**Full conversation** opens that attempt's conversation read-only. ■ **Stop the artist** ends that one attempt (the worktree stays).

- **The app makes the commits.** An artist only decides what to commit (everything or a file list, plus the message). The session server does the git writes, only on that attempt's worktree and branch (no hooks; the message ends with `Aynx-Task` and
  `Aynx-Attempt` lines). If the repository has no git identity (`user.name` · `user.email`) or the selected files use a git filter (e.g. Git LFS), the app cannot commit — in that case a person commits in that worktree directly.
- **Commit refusals are kept** — as a **Commit refused** line in the timeline and as **Last commit refused** in the attempt panel. Reasons a person must resolve (filters · no git identity · worktree mismatch · git failure) also arrive as [notifications](#notices).

<a id="blocked"></a>
### Blocked — widening album permissions

If an artist needs something outside the delegated scope (a command that is not allowed, the network, a folder outside the worktree), the CLI refuses and the artist reports **Blocked**.

1. A **Blocked** band appears on the track with what the artist says it needs, and you get a notification. The 🔔 count goes up too.
2. A person widens the scope through **Album permissions** in the band (e.g. adding `npm test` to that artist's allowed commands, or raising its permission).
3. The producer gives the **same artist** its next turn — the work in progress is still in the worktree. If app wake-ups are off, tell the chat something like "I widened it, carry on".

Blocked is not the end — the attempt stays **Idle** and can be sent back to work. If you will not widen the scope, tell the producer another way, or stop the attempt.

### Timeline

One line each for who (Person · Producer · Artist · Server · Reviewer) did what and when. Only metadata is kept, not the instruction text.

<a id="integration"></a>
## 7. Integration — combining the results

When an album is created, the app makes an **integration ref** `refs/aynx/orch/<run16>/int` (`<run16>` = the first 16 hex characters of the album ID) at the repository's current HEAD. This is the album's "combined result". If you are on a feature branch, that branch is the base.

- **Each acceptance adds one track = one commit** (squash), in a straight line on top of the integration ref. Small commits on artist branches do not go in. The app writes the commit message (track title, report summary, and `Aynx-Run` · `-Task` · `-Attempt` ·
  `-Report` · `-Report-Commit` · `-Base` lines). The identity is the repository's git identity — without one, integration fails.
- Merging uses **git objects only, with no working folder** (`merge-tree`). The repository's working folder and artist worktrees are not touched.
- An accepted reported commit is held by a **preservation ref** `…/accepted/<task>` (so that deleting the artist branch does not let gc remove it). A landing proof `…/done/<job>` is created along with it.
- **New artists branch from the integration head** — the results of tracks they depend on are already in it. The producer cannot choose the base.
- The integration ref is not a branch, so it does not show in `git branch` during the album. **Export as branch** in the album head makes the branch `orch-<run8>-int`, meant for people, point at the integration head (if that branch is checked out in a worktree or was changed outside the app, it is refused rather than overwritten).
- If someone moves the integration ref outside the app, the app does not accept that head as is and puts the album on **hold** (the [hold bar](#album) above).

<a id="conflict"></a>
### Conflicts

If the track overlaps with the integration head, no commit is made and the track shows **Conflict**, with the number, kinds and paths of the conflicts.

- Only for **plain text content conflicts** (same file, same lines) can the producer start a **resolution attempt** with a Worker artist. A resolution attempt receives the files with conflict markers on top of the integration head, resolves all the markers and commits, and then reports how it resolved each path (if markers remain, the commit and report are refused). Accepting that report integrates again.
- Other conflicts (rename/delete · modify/delete · binary · file mode · symlink · submodule) show **needs a person** — reject it (the producer starts a new artist from the integration head) or cancel.

<a id="verify"></a>
## 8. Verify before accepting

If you set a **verification** command in [New album], that command runs for every integration candidate (the commit that would land on the integration ref if accepted), and the candidate lands **only if it passes**.

- **Only a person sets the command** — only in [New album]. It is fixed when the album starts, and neither the producer, the artists nor [Album permissions] can change it.
- The app moves its dedicated verify folder (`<repository name>-wt/orch-<run8>-verify`, detached HEAD) to the candidate, **cleans it completely** (`clean -ffdx`), then runs one `cmd.exe /d /s /v:off /c "<command>"`. If something must be installed, put it in the command (`npm ci && npm test`).
  **Kept folders** (e.g. `node_modules`) are not removed and are reused, but they are removed when a **cache key file** (e.g. `package-lock.json`) changes.
- **Pass** = exit code 0 **and** no tracked files changed. Running past the time limit (default 10 minutes, up to 60), cancelling and failing to start all count as failure.
- Only an **allow list** of environment variables is passed (`PATH` · `SystemRoot` · `USERPROFILE` · `APPDATA` · `LOCALAPPDATA` · `TEMP` (album-specific) · `CI=1` …), plus **extra environment variable names** (values come from the app's environment). API keys, cloud credentials, `GIT_*` and app tokens are not passed.
- Only the last 16 KiB of output is kept in memory, and the last 8 KiB is shown on screen and to the producer (files and audit records keep only length and hash).

| Mode | When it runs | Display |
|---|---|---|
| **Run automatically** (one risk confirmation) | Right away for each candidate, without asking | **Same risk level as 'Full auto'** — a risk box, and an **Auto verify** chip in the album head |
| **Ask a person** | Runs only when you press **Run verification** on the track screen for each candidate. The confirmation is tied to that candidate, that command and the integration head at that time. If not pressed within 30 minutes, it expires → Reported | Confirmation box: short candidate hash · number of changed files · View diff · command |
| No command | Integrates with no verification | — |

Permission to run automatically is **judged again just before running, against the current album configuration** — if [Album permissions] switched to Ask a person or the repository identity changed, it does not run automatically. If it could not run automatically because the configuration changed, it goes back to Ask a person and you get a notification.

<a id="verify-risk"></a>
> **The risk of unattended verification — what you accept.** Even if the artist is on 'Auto edit', the app runs the tests, build scripts and dependency install scripts the artist changed **with your permissions and no sandbox** — effectively the same as running AI-written code on this PC.
> The artist's permission level gives no protection on this path. **A person doing the merge into main is a gate that guards main, not a boundary that guards this PC** — file changes and data sent outside can already have happened before the merge. Turning on a Reviewer does not remove this risk.
> A prompt injection in external input (remote scrollback, DB rows, web documents) can ride the chain 'artist changes a test → automatic verification'. Verification isolation (an OS sandbox) does not exist yet. For repositories you are worried about, keep **Ask a person**, and look at the diff before confirming.
> Do not put secrets in the command (they are visible to the producer AI and in the album file, and the output tail goes to the producer AI's model provider).

- **If verification fails**, the track is not accepted and returns to Reported (with a notification). When the producer asks to accept again, it verifies anew — up to 3 times per report and 50 times per album.
- **Accept despite failure** (people only; asks for reconfirmation in a remote web window) — lands **that exact failed candidate** as is (invalid if the integration head has changed in the meantime). The failure record stays a failure.
- If a tracked symlink points outside the verify folder, the candidate is refused without verifying (`symlink-outside`, with a notification).

<a id="reviewer"></a>
### Reviewer artists

The producer can start a **read-only reviewer** (a Reviewer artist in the album) for one report. The reviewer reads the track diff of that reported commit (base … reported commit) and reports **pass** or **changes requested**, with its findings (up to 20). It does not review the integration candidate.

- **This is a role-based supplementary review — not an independent guarantee.** A reviewer runs with the same user permissions, and its token is only a label within the same account.
- A reviewer runs one turn with **fixed read-only arguments** (read tools and review tools only · an empty working folder made by the app · a read-only folder of the reported commit, `orch-<task8>-<att8>-rv`). If it ends with no verdict, you get the notification "A reviewer exited without a verdict", and that report can be reviewed again.
- One active review per report · one at a time per album · a total of **Total verdicts** — counted separately from the artist limits. A new report, rejection, cancellation or acceptance invalidates the active review.
- When Total verdicts is used up, a person accepts (recorded as a waiver) or opens a new album. To require a review before acceptance, set **Needs N pass(es) to accept** in [New album] or [Album permissions].

<a id="done"></a>
## 9. Completion · the exported branch

An album can be completed once all tracks are finished (Accepted · Rejected · Cancelled) and there is no integration in progress, active review, running verification, running turn or hold.

- The producer completes it, or a person presses **Complete album** in the album's **⋯** menu (if it cannot be completed yet, the reason shows). This cannot be undone.
- Completion closes any remaining idle attempts, revokes the producer's coordination rights, **automatically exports** the integration branch `orch-<run8>-int` and cleans up the **server temp folders** (verification and review locations). If the export fails, the album still completes, and the producer asks you to press **Export as branch**.
- **Completion does not delete artist worktrees or branches** — a person's [Clean up](#cleanup) does.

The head of an ended album has **Producer conversation** and a ⋯ menu (Open in new tab · Copy merge command · Album info · Clean up worktrees · Archive album). The chat is closed, and the board shows the producer's last message in a **Producer wrap-up** card. [Producer conversation] opens the conversation read-only on the left —
only conversations seen on this device can be opened.

<a id="merge"></a>
## 10. Merge into main

**Merge** on the album puts the exported branch into the branch the album started from (`git merge --no-ff`, one merge commit, no squash). **The app never pushes.** Producers and artists cannot merge, and no MCP tool can.

The dialog checks first, without changing the repository: no uncommitted changes (tracked files, plus untracked or ignored files the merge would overwrite), the main working folder is on the target branch, no expected conflict. A merge or rebase in progress, a moved or outdated exported branch, and repository settings outside integration support also block it. The server checks again right before merging. If the merge fails, it is aborted and you see why.

When **Merge** cannot run, **Copy merge command** in the dialog and the ⋯ menu gives you `git merge --no-ff orch-<run8>-int` for a terminal. An album that started on a detached HEAD has no target branch, so only copying works. If you merge from a terminal, the album still shows **Merged into main** once that commit is in the branch.

The app's merge turns Git hooks off, as it does for artist worktrees, so hooks such as `pre-merge-commit` and `post-merge` do not run. If you need them, merge from a terminal. From a remote web window, **Merge** asks for the master password again.

**A clean integration can still break meaning** (changes to different files can be wrong when combined) — without a verification command, nothing catches that. A person's check before merging into main is the last gate. **View changes** in the dialog opens the album's whole diff.

### Auto-merge when complete

Turn it on per album in [New album] or [Album permissions]. It needs a verification command and the risk confirmation, because it puts AI code no person has read into main. Verification and reviewer verdicts are not independent guarantees. Turning it on counts as widening.

Right after the album completes and exports, once, the app merges only if all of these hold: every accepted track passed verification (no person overrode a failure or waived a rule), the integration head is a verified candidate, the current acceptance rules are met, and the same checks as the dialog pass. A stopped album never auto-merges.

Otherwise it does not merge: the album shows **Merge waiting** and the reason, and you get a notification. **The app does not try again** — clear the cause and press **Merge**. After an auto-merge, the album shows the commit and how to undo it (`git revert -m 1 <commit>`).

<a id="cleanup"></a>
## 11. Clean up

### Server temp folders — the app handles them

The **verify folders** (`orch-<run8>-verify` · `orch-<run8>-tmp`) and **review folders** (`orch-<task8>-<att8>-rv` · a reviewer's empty working folder) the app created are deleted by the app when the album ends (completed · stopped · read-only after a session server restart). But only if all of the following hold:

1. It is a folder the app created for that album.
2. Its real location (following links) is inside the album's worktree folder.
3. No process is using the folder.
4. **It is exactly as the app last left it** — otherwise it counts as "unexpected changes".

If there are unexpected changes or a process is still using it, the folder is **kept rather than deleted** — you get a notification, and the album board shows the **Kept server temp folders** list with [Open] and [Remove anyway]. An ended album with kept folders refuses **archiving** — look at them and remove them, then archive.

<a id="cleanup-note"></a>
### Artist worktrees · refs — a person chooses

**Clean up** on an ended album (completed · stopped · read-only — Clean up worktrees in the ⋯ menu) opens a window over the album and deletes only what you select. On the left you pick work folders, grouped as **Safe to delete**, **Check before picking** and **Can't delete**. On the right, a read-only graph in the same style as the branch tile shows main and this album's branches. Lines of the work folders you pick turn dashed and struck through, and **Open full graph** opens the branch tile if the repository is a project. If the graph can't be read, picking and deleting still work. Recovery records (refs) are collapsed under their own heading, unless a leftover temporary ref is already selected.

| What | Default | Rule |
|---|---|---|
| Artist worktrees of integrated tracks | Checked | Not deleted if they have uncommitted changes · not deleted while the artist is running |
| Worktrees of tracks that were rejected, cancelled, left with an unresolved conflict or still open at the end | Unchecked | Same |
| Artist branches | Kept | With **Also delete track branches** on, only those whose tip is an integrated reported commit or is confirmed merged. For the rest, only the worktree is deleted and the branch stays ("{n} branch(es) kept") |
| Completion proof (`done/`) · preserved accepted commit (`accepted/`) · reverted head (`diverged/`) refs | Kept | Deleting them can make those commits subject to git gc |
| Leftover temporary candidate and conflict refs (`candidate` · `conflict/`) | Checked | The app already removes them — if any remain |
| Integration record (`int`) | Kept | Selectable only when the exported branch contains its head, or when nothing was integrated (it is still the start commit, so there are no commits to lose) |
| Exported integration branch | — | Not deleted (a person does this with git after merging into main) |

- **Remove worktree** in the attempt panel deletes one worktree created by that album — if there are uncommitted changes or unmerged commits, **nothing is deleted**.
- When deleting, **junctions and symbolic links inside are removed first, as links only** (so that a link pointing elsewhere, like pnpm's `node_modules`, is not followed and its target deleted).
- **A worktree is a compartment for dividing work, not a security sandbox.** Artists run with the same user permissions and, if their permissions allow it, also read outside the worktree.

<a id="archive"></a>
### Archive — archive · restore · delete forever

Ended albums (completed · stopped · read-only) leave the library through the icon-only archive button on their library row (tooltip "Move to archive") or **Archive album** in the album's **⋯** menu. Running albums do not have these. There is no "close" any more — archiving is how finished albums leave the library.

- **Archive** — the album record and refs stay as they are. It is refused if artist worktrees remain or there are kept server temp folders — it works after [Clean up](#cleanup-note) and [Remove anyway]. While worktrees remain, the library row shows a `worktree n` chip, and the archive button's tooltip reads "Clean up worktrees first".
- **Restore** — pick it from the **Archive** chip in the library. The album **returns only as a finished record and does not run again** (no artists, producer or tokens). An album that was read-only stays read-only.
- **Delete forever** — only from the archive. It removes the album record and all of this album's refs. **This cannot be undone** (a remote window asks for the master password again). Exported branches and commits already merged remain.
  If there is an integrated result that was never exported, a warning appears, and **Export first** can save it (this restores the album and opens its screen, where you use **Export as branch**). A read-only album cannot be exported from the app, so only the warning appears.

<a id="brakes"></a>
## Brakes — pause · stop · limits

- **Pause / Resume** (playback bar · ⋯ menu) — blocks the producer's coordination tools. Artists keep running, and the app does not wake the producer either. Other tools, such as session and DB reads, are not blocked — if you don't trust the producer, use **End producer**. Resume works only with a producer attached — if there is none, do a [take over](#adopt) first.
- **Stop reply** (✕) — stops only the producer's current reply. The album state does not change.
- **End producer** — closes the producer chat and stops coordination. Artists keep running. This is how a person cuts off only the coordination, without ending the album, when they don't trust the producer.
- **Stop** (playback bar ■ · **Stop album** in the ⋯ menu) — ends the album: blocks new artists and new turns, ends the processes of running turns and verification, withdraws any integration not yet committed (waits for the end if it is committing), and revokes the producer's coordination rights and the worker tokens. The producer chat and worktrees remain.
  **This is also how a person cuts things off when the producer no longer listens (runaway behavior, prompt injection).**
- **Limits** — on top of the [album limits](#album-start), there are fixed limits: 50 tracks · 60 coordination calls per minute · 200 follow-up turns · verification (50 per album, 3 per report) · wake-ups ([AYNX woke the producer](#wake)). Reaching one refuses that request, and it shows in **Remaining**.
  When coordination time runs out, the album pauses, and 30 minutes after that, the app stops the album.

<a id="adopt"></a>
## Taking over — when there is no producer

When the producer CLI ends (`/exit` · an error) or you press [End producer], the album becomes **Paused** ("the producer exited").

- **With the same chat** (when the CLI ended on its own) — message the ended chat or press [Restart], then tell it to take over the album. It comes back with the same conversation. A chat closed with [End producer] continues with a new producer.
- **With a new producer** — **Take over with a new producer** on the library card or the pause band (or **Open producer** in the playback bar) creates a new chat for that album and **only fills** the take-over sentence into the input box. A person checks it and sends it. The app has no way to send text you cannot see.
  You can change the CLI, model and effort before sending.

When a producer takes over, the producer generation goes up by one, and an album paused because its producer ended runs again right away. You get the notification "Another producer took over the paused album".

| Album | Take over |
|---|---|
| Paused because the producer ended | Works — back to Running right away |
| Paused by a person with no producer | **Reattach producer** — only attaches a producer, and **it stays paused**. A person must press [Resume] for it to run |
| Paused at the coordination time limit | Does not work — stop it or open a new album |
| On hold | Does not work — release the hold first |
| Read-only or ended album | Does not work |

- One chat belongs to only one album, and the only album it can take over is that one. Telling the AI about another album is refused. Restarting the process or changing the model does not change this.
- Up to 8 producers can take over one album.
- An old producer loses its coordination rights and cannot use coordination tools ("Old producer — no coordination rights" in the album head).

<a id="notices"></a>
## Notifications

The **session server creates one notification each** for things you should know about (an artist blocked · a turn ending with no report · a turn timeout · a reviewer ending with no verdict · a time limit · the producer ending · a take-over · an album ending · commit refusals a person must resolve · **auto-merge stopped** · **verification awaiting confirmation** · automatic verification going back to Ask a person · verification failure · integration conflict · outside integration support · integration ref divergence ·
repository identity change · intent save failure · a reviewer's changes requested · **kept server temp folders** · **wake-ups stopped**). If an app window is open, the main window shows it once (with a line in the dock's Alerts section too). **If there are no windows**, it is sent through messengers (when enabled in Settings › Notifications) and queued to show when a window opens again.
The same notification does not arrive twice.

<a id="remote"></a>
## In a remote web window

A remote window can also view albums, talk to the producer and decide permission cards. If you set a master password, these ask for it again: **Start album · widening album permissions · Run verification · Accept despite failure · Delete forever (archive).** Pause, stop, clean up, archive, restore and album permission changes with no widening do not ask.
**Open in new tab** and the Artists screen must be opened from a main PC window.

<a id="support"></a>
## Support scope

| Item | Now |
|---|---|
| OS | **Windows** only. Verify before accepting does not run on other OSes yet |
| git | **2.42 or later** (integration uses `merge-tree --merge-base` and `--attr-source`). With an older version, albums cannot start |
| Merge drivers · `merge.default` · `merge.<name>.driver` | Refused — automatic integration would run arbitrary commands. A person merges by hand |
| Filter attributes (`filter=`, including **Git LFS**) · `merge.renormalize` | Refused (integration) · the app does not make artist commits either |
| Changed submodules (gitlink) | Refused (an unchanged submodule is fine) |
| Symlinks | If a tracked symlink points outside the worktree, verification of that candidate and review of that report are refused (`symlink-outside`) |
| Remote (SSH) artists · automatic album resume | None |

<a id="limits"></a>
## Known limits

- **Role tokens, tile tokens and chat tokens are not a security boundary within one account.** Producer (chat token + role in the server table), worker and reviewer tokens are partitions that prevent mistakes and mix-ups — artists run with the same user permissions, so one that sets out to can read other files in the same account. The line of defense is the album configuration's permissions and human supervision.
- **Codex 'Auto edit' has no command allow list.** Everything inside the sandbox runs without asking and everything outside is refused — the allowed commands field does not apply to Codex. Node builds and tests (`npm test`, esbuild, etc.) may not run in this sandbox and fail with `spawn EPERM` — use the verification step or 'Full auto' for builds and tests.
- **Once an album is open, the producer starts artists without asking a person.** A prompt injection in external input read by the producer or artists can trigger turns within that album's scope. The safety net is the album configuration, limits, album board, notifications, [Stop], and a person merging into main — plus [the risk of unattended verification](#verify-risk).
- **The track screen is the only view into an artist** — turns, tool names, denial counts, timeline and [Full conversation]. There is no tile to type to an artist directly (tell the producer what to fix).
- **Albums do not continue automatically after the session server restarts.** Earlier albums appear **read-only** (no tokens), the producer chat shows only its record, and the album board shows leftover resources. Resuming the conversation does not bring back permissions. An integration that was landing is judged from its landing proof ref as landed or not landed, and written to the ledger. To continue, open a new album. **Archiving** takes finished albums out of the library ([Archive](#archive)).
- **Verify before accepting is not a sandbox** — see [the risk](#verify-risk). **A reviewer is not an independent guarantee** — see [Reviewer artists](#reviewer).

<a id="update"></a>
## When updating

**Finish running albums before updating** — an app update replaces the session server, so running albums do not continue and remain only as **read-only**. Old album files the app cannot read are skipped (the files are not deleted).
