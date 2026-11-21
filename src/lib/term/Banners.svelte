<script lang="ts" module>
  // 터미널 타일 위쪽의 막대들 — 모두 같은 `.reco` 상자다. 상태와 손잡이는 `Terminal.svelte`(세션 수명)에 있다.

  export interface Reconnect {
    /** 1부터 */
    attempt: number;
    secondsLeft: number;
    connecting: boolean;
    /** 자동 루프를 멈춘 사유. `null` 이면 루프가 돌고 있다 */
    paused: string | null;
    reason: string | null;
    /** 끊긴 사유가 아니라 직전 재시도가 **붙지 못한** 사유의 "다음에 할 일" */
    hint: string | null;
  }

  /** 배치 복원으로 뜬 SSH 타일 — 아직 한 번도 안 붙었다, 눌러야 붙는다(자동 루프 없음). */
  export interface Deferred {
    connecting: boolean;
    note: string | null;
    hint?: string | null;
  }

  /** 세션이 없고 자동으로 되살아나지 않는다 — 정상 종료 · 재연결 포기 · 첫 접속 실패 셋 다 여기다(Enter · Ctrl+D 가 걸린다). */
  export interface Ended {
    connecting: boolean;
    note: string | null;
    hint?: string | null;
    /** 첫 접속 실패 — 문구만 가른다("종료" 는 붙었던 적이 있어야 할 수 있는 말이다) */
    unopened?: boolean;
    /** tmux 타일의 정상 종료 — 떼었는지 끝냈는지 화면으로는 못 가르니 배너는 어느 쪽이든 참인 말만 한다. `unopened` 와 배타적 */
    tmuxExit?: boolean;
  }

  export type WorktreePrepBar =
    | { kind: "ask"; repo: string; branch: string; busy: boolean }
    | { kind: "failed"; message: string }
    | { kind: "identity" };
</script>

<script lang="ts">
  import { t as tr } from "$lib/i18n/i18n.svelte.js";
  import Keys from "$lib/Keys.svelte";
  import type { PaneSpec } from "$lib/session";
  import { copyGitIdentityLines, editProjectSetup, gitIdentityLines } from "$lib/app/projects.svelte.js";
  import type { WorktreePrepAnswer } from "$lib/remote-worktree";
  import CommandLines from "$lib/CommandBlock.svelte";
  import { lostNoticeText, type LostNotice } from "./lost-notice";

  let {
    reconnect,
    deferred = $bindable(),
    setupReq,
    setupFail = $bindable(),
    wtPrep = $bindable(),
    ended,
    lost,
    tryReconnect,
    stopReconnect,
    connectDeferred,
    rerunSetup,
    launchSetupAgent,
    answerPrep,
    reconnectEnded,
    onclose,
  }: {
    reconnect: Reconnect | null;
    /** [닫기] 가 배너만 감춘다(`null`) — 등록은 남아 '모두 재연결' 이 이 타일도 붙인다 */
    deferred: Deferred | null;
    setupReq: NonNullable<PaneSpec["setup"]> | null;
    /** [닫기] 가 막대만 감춘다(`null`) */
    setupFail: { code: number; busy: boolean } | null;
    /** [닫기] 가 막대만 감춘다(`null`) */
    wtPrep: WorktreePrepBar | null;
    ended: Ended | null;
    /** 걷는 것(아무 키 · 클릭 · 8초)은 `Terminal.svelte` 가 쥔다 */
    lost: LostNotice | null;
    tryReconnect: (manual: boolean) => Promise<void>;
    stopReconnect: (message: string, sgr?: string) => void;
    connectDeferred: () => Promise<void>;
    rerunSetup: () => void;
    launchSetupAgent: () => void;
    answerPrep: (answer: WorktreePrepAnswer) => void;
    reconnectEnded: () => Promise<void>;
    /** 종료됨 배너의 [닫기] — 배너가 아니라 패널을 없앤다 */
    onclose?: () => void;
  } = $props();
</script>

<!-- 막대는 터미널 위에 겹쳐(absolute) 뜬다 — 레이아웃을 밀면 cols/rows 가 흔들린다 -->
{#if reconnect}
  <div class="reco glass-raised" role="status">
    <div class="row">
      <span class="head">
        {tr("pane.banner.reconnect.head")}
        {#if reconnect.paused}
          {reconnect.paused}
        {:else if reconnect.connecting}
          {tr("pane.banner.reconnect.trying", { n: reconnect.attempt })}
        {:else}
          {tr("pane.banner.reconnect.countdown", {
            n: reconnect.attempt,
            secs: reconnect.secondsLeft,
          })}
        {/if}
      </span>
      <!-- 사유가 없어도 span 은 남긴다 — 버튼을 오른쪽으로 미는 여백이다 -->
      <span class="why">{reconnect.reason ?? ""}</span>
      <button
        type="button"
        class="act btn btn-sm btn-secondary"
        disabled={reconnect.connecting}
        onclick={() => void tryReconnect(true)}>{tr("pane.banner.reconnect.now")}</button
      >
      <button
        type="button"
        class="act btn btn-sm btn-ghost"
        onclick={() => stopReconnect(tr("pane.banner.reconnect.stopped"))}
      >
        {tr("pane.banner.reconnect.stop")}
      </button>
    </div>
    {#if reconnect.hint}<div class="hint">{reconnect.hint}</div>{/if}
  </div>
{/if}

{#if deferred}
  <div class="reco glass-raised" role="status">
    <div class="row">
      <span class="head">
        {#if deferred.connecting}
          {tr("pane.banner.deferred.connecting")}
        {:else}
          {tr("pane.banner.deferred.head")}
        {/if}
      </span>
      <span class="why">{deferred.note ?? ""}</span>
      <button
        type="button"
        class="act btn btn-sm btn-secondary"
        disabled={deferred.connecting}
        onclick={() => void connectDeferred()}>{tr("pane.banner.deferred.connect")}</button
      >
      <button type="button" class="act btn btn-sm btn-ghost" onclick={() => (deferred = null)}>
        {tr("pane.banner.deferred.close")}
      </button>
    </div>
    {#if deferred.hint}<div class="hint">{deferred.hint}</div>{/if}
  </div>
{/if}

{#if setupFail && !ended}
  <div class="reco glass-raised setup-fail" role="status" data-setup-fail={setupFail.code}>
    <div class="row">
      <span class="head">{tr("pane.setup.failed", { code: setupFail.code })}</span>
      <span class="why"></span>
      {#if setupReq}
        {@const req = setupReq}
        <button type="button" class="act btn btn-sm btn-secondary" data-setup-action="edit" onclick={() => editProjectSetup(req.projectId)}
          >{tr("pane.setup.edit")}</button
        >
        <button
          type="button"
          class="act btn btn-sm btn-secondary"
          data-setup-action="rerun"
          disabled={setupFail.busy}
          onclick={rerunSetup}>{tr("pane.setup.rerun")}</button
        >
        {#if req.agent}
          <button type="button" class="act btn btn-sm btn-ghost" data-setup-action="agent" onclick={launchSetupAgent}
            >{tr("pane.setup.launch", { agent: req.agentName ?? req.agent })}</button
          >
        {/if}
      {/if}
      <button type="button" class="act btn btn-sm btn-ghost" data-setup-action="close" onclick={() => (setupFail = null)}
        >{tr("pane.setup.close")}</button
      >
    </div>
    <div class="hint">{tr("pane.setup.hint")}</div>
  </div>
{/if}

<!-- 원격 새 워크트리 — 질문의 답은 Rust 가 기다리는 준비로 간다(`ssh_worktree_answer`). 실패 · 신원 없음은 이미 평범한 셸로 넘어간 뒤다 -->
{#if wtPrep && !ended}
  {#if wtPrep.kind === "ask"}
    {@const ask = wtPrep}
    <div class="reco glass-raised warn" role="status" data-worktree-prep="ask">
      <div class="row">
        <span class="head">{tr("pane.worktree.noCommit.head")}</span>
        <span class="why"></span>
        <button
          type="button"
          class="act btn btn-sm btn-secondary"
          data-worktree-action="commit"
          disabled={ask.busy}
          onclick={() => answerPrep("commit")}
          >{ask.busy ? tr("pane.worktree.noCommit.busy") : tr("pane.worktree.noCommit.commit")}</button
        >
        <button
          type="button"
          class="act btn btn-sm btn-ghost"
          data-worktree-action="shell"
          disabled={ask.busy}
          onclick={() => answerPrep("shell")}>{tr("pane.worktree.noCommit.shell")}</button
        >
      </div>
      <div class="hint">{tr("pane.worktree.noCommit.hint", { repo: ask.repo, branch: ask.branch })}</div>
    </div>
  {:else}
    {@const failed = wtPrep.kind === "failed" ? wtPrep.message : null}
    <div class="reco glass-raised err" role="status" data-worktree-prep={wtPrep.kind}>
      <div class="row">
        <span class="head">{tr("pane.worktree.failed.head")}</span>
        <span class="why" title={failed ?? ""}
          >{failed ?? tr("pane.worktree.failed.identity")}</span
        >
        <button type="button" class="act btn btn-sm btn-ghost" data-worktree-action="close" onclick={() => (wtPrep = null)}
          >{tr("pane.worktree.close")}</button
        >
      </div>
      {#if wtPrep.kind === "identity"}
        <div class="hint">{tr("app.projects.repo.identity.remote")}</div>
        <CommandLines
          lines={gitIdentityLines()}
          label={tr("app.projects.repo.identity.copy")}
          copy={() => copyGitIdentityLines(true)}
        />
      {/if}
      <div class="hint">{tr("pane.worktree.failed.hint")}</div>
    </div>
  {/if}
{/if}

{#if lost && !ended}
  <div class="reco glass-raised warn lost" role="status" data-lost-notice={lost.bytes}>
    <div class="row">
      <span class="head">{lostNoticeText(lost, tr)}</span>
    </div>
  </div>
{/if}

<!-- 두 버튼의 문구가 Enter · Ctrl+D 키를 그대로 말한다 — 죽은 타일에서만 도는 키라 안 적으면 아무도 못 찾는다 -->
{#if ended}
  <div class="reco glass-raised" role="status">
    <div class="row">
      <span class="head">
        {#if ended.connecting}
          {ended.tmuxExit
            ? tr("pane.banner.ended.reattaching")
            : ended.unopened
              ? tr("pane.banner.ended.connecting")
              : tr("pane.banner.ended.reconnecting")}
        {:else if ended.tmuxExit}
          {tr("pane.banner.ended.tmux.before")}<Keys combo="Ctrl+B d" size="sm" />{tr(
            "pane.banner.ended.tmux.after",
          )}
        {:else if ended.unopened}
          {tr("pane.banner.ended.unopened")}
        {:else}
          {tr("pane.banner.ended.head")}
        {/if}
      </span>
      <span class="why">{ended.note ?? ""}</span>
      <button
        type="button"
        class="act btn btn-sm btn-secondary"
        disabled={ended.connecting}
        onclick={() => void reconnectEnded()}
        >{ended.tmuxExit
          ? tr("pane.banner.ended.reattach")
          : ended.unopened
            ? tr("pane.banner.ended.retry")
            : tr("pane.banner.ended.reconnect")}</button
      >
      <button type="button" class="act btn btn-sm btn-ghost" onclick={() => onclose?.()}>
        {tr("pane.banner.ended.close")}
      </button>
    </div>
    {#if ended.hint}<div class="hint">{ended.hint}</div>{/if}
  </div>
{/if}

<style>
  /* 화면을 밀지 않는다 (fit 이 흔들리지 않게) */
  .reco {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 10px;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--fg);
    /* 불투명이어야 한다 — 반투명이면 밑의 스크롤백 글자가 배너 글자와 겹쳐 읽힌다 */
    background: var(--glass-float, var(--surface-raised-solid));
    border-bottom: 1px solid var(--line-strong);
    box-shadow: var(--shadow-modal);
  }

  .reco.warn,
  .reco.err {
    padding-left: 12px;
  }

  /* 띠는 `.row` 의 가상 요소다 — 상자 자신의 `::before` · `::after` 는 `.glass-raised` 의 흐림 판이 쓴다 */
  .reco.warn > .row::before,
  .reco.err > .row::before {
    content: "";
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 2px;
    border-radius: 2px;
    background: var(--warn);
  }

  .reco.err > .row::before {
    background: var(--err);
  }

  .reco .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .reco .head {
    white-space: nowrap;
  }

  .reco .hint {
    color: var(--fg-muted);
    font-size: 11px;
    line-height: 1.35;
  }

  /* 길면 여기서만 줄어든다 (버튼은 항상 보여야 한다) */
  .reco .why {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--fg-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reco.lost .head {
    white-space: normal;
  }

  /* `act` 는 표식이다 — 검증 도구가 `.reco .act` 로 찾는다 */
  .reco .act {
    flex: 0 0 auto;
    white-space: nowrap;
  }
</style>
