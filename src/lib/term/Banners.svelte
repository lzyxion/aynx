<script lang="ts" module>
  // 터미널 타일 위쪽의 막대들 — 재연결 · 복원(연결 대기) · 설정 스크립트 실패 · 원격 새 워크트리 · 종료됨. 모두 같은 `.reco` 상자다.
  // 상태와 손잡이는 `Terminal.svelte`(세션 수명)에 있고 여기는 **그림과 그 모양(타입)뿐**이다. 감싸개 없이 조각으로 그린다.

  /**
   * 자동 재연결 상태 (`null` = 재연결 중이 아님). 배너가 이 값을 그린다.
   * docs/log/2026-09-01-reconnect.md
   */
  export interface Reconnect {
    /** 몇 번째 재시도인가 (1부터) */
    attempt: number;
    /** 다음 시도까지 남은 초 (대기 중일 때만 의미가 있다) */
    secondsLeft: number;
    /** 지금 접속을 시도하는 중인가 */
    connecting: boolean;
    /** 자동 루프를 멈춘 사유. `null` 이면 루프가 돌고 있다 */
    paused: string | null;
    /** 끊긴 사유 (Rust 가 준 한 줄) */
    reason: string | null;
    /**
     * **다음에 할 일** 한 줄 — 직전 재시도가 실패한 사유에서 나온다
     * (docs/log/2026-09-17-connect-diagnostics.md). 끊긴 사유가 아니라 **붙지 못한 사유**의
     * 힌트다: 30초마다 같은 문구가 도는 자리에서 사람이 실제로 필요한 것은 그쪽이다.
     */
    hint: string | null;
  }

  /**
   * **연결 대기 상태** (`null` = 아님) — 배치 복원으로 뜬 SSH 타일
   * (docs/log/2026-09-03-workspace-restore.md · [`PaneSpec.deferred`]).
   *
   * 재연결 배너와 **같은 상자**를 쓰되 뜻이 반대다: 저쪽은 "붙어 있었는데 끊겼다, 곧 다시
   * 붙는다" 이고 이쪽은 "아직 한 번도 붙지 않았다, 눌러야 붙는다" 다. 그래서 자동 루프도
   * 카운트다운도 없고 버튼이 [연결]·[닫기] 다.
   */
  export interface Deferred {
    /** 지금 접속을 시도하는 중인가 */
    connecting: boolean;
    /** 직전 시도가 실패한 사유 (한 줄). 아직 눌러 본 적이 없으면 `null` */
    note: string | null;
    /** 그 사유의 "다음에 할 일" 한 줄 (docs/log/2026-09-17-connect-diagnostics.md) */
    hint?: string | null;
  }

  /**
   * **종료됨 상태** (`null` = 아님) — 세션이 없고 자동으로 되살아나지 않는다
   * (docs/log/2026-09-03-keys-ended-focus.md · docs/log/2026-09-04-default-shell-close-tile.md).
   *
   * 들어오는 길은 셋이다: ①정상 종료(`kind:"exit"` — 사용자가 `exit` 를 쳤거나 셸에서
   * Ctrl+D 를 눌렀다. 로컬 셸도 SSH 도 같다 — 로컬은 `local-exit` 이벤트가 알려 준다)
   * ②SSH 자동 재연결 루프가 끝났을 때 ([중단] 을 눌렀거나 호스트 키가 바뀌어 되살릴 수
   * 없을 때) ③**첫 접속 자체가 실패**했을 때 (인증 실패·호스트 불가·TOFU 거부…).
   *
   * ③이 늦게 합류했다. 예전에는 그때 안내 한 줄만 찍고 상태를 남기지 않아, 붙지 못한
   * 타일이 **배너도 키도 없는 죽은 화면**으로 남았다 — Enter 로 다시 시도할 수도, Ctrl+D 로
   * 닫을 수도 없었다. 셋 다 "살아 있는 세션이 없다" 는 같은 사실이므로 상태를 하나로 모은다
   * ([`deadState`]).
   *
   * 세 배너(`reconnect`·`deferred`·`ended`)는 **같은 `.reco` 상자**를 쓰지만 뜻이 다르다:
   *   · reconnect — 붙어 있었는데 끊겼다, 알아서 다시 붙는다 (카운트다운)
   *   · deferred  — 아직 한 번도 안 붙었다, 눌러야 붙는다
   *   · ended     — **끝났다**. 스크롤백은 읽을 수 있고, Enter 로 새로 붙거나 Ctrl+D 로 닫는다.
   *
   * 나가는 길도 둘이다: 재접속 성공(`null` 로) 또는 패널 닫힘(언마운트).
   */
  export interface Ended {
    /** 지금 다시 접속을 시도하는 중인가 */
    connecting: boolean;
    /** 직전 재접속 시도가 실패한 사유 (한 줄). 아직 눌러 본 적이 없으면 `null` */
    note: string | null;
    /** 그 사유의 "다음에 할 일" 한 줄 (docs/log/2026-09-17-connect-diagnostics.md) */
    hint?: string | null;
    /**
     * 이 타일이 **한 번도 붙지 못했는가** (첫 접속 실패 = 위 ③). 배너 문구만 가른다 —
     * "세션이 종료되었습니다" 는 붙었던 적이 있어야 할 수 있는 말이다. 동작(Enter·Ctrl+D·
     * 두 버튼)은 완전히 같다.
     */
    unopened?: boolean;
    /**
     * **tmux 에서 깨끗이 나왔다** (docs/log/2026-09-16-tmux-toggle.md).
     *
     * tmux 타일(`pane.tmux`)의 세션이 **정상 종료**(코드 0 · 정돈된 채널 닫힘)로 끝났다는
     * 뜻이다. 그 타일에서는 그것이 사고가 아니라 **사람이 나간 것**이다 — `Ctrl+B` `d` 로
     * 떼었거나(서버의 세션은 그대로 산다) 마지막 셸에서 `exit` 를 쳤거나(세션이 없어졌다).
     * 두 경우가 화면에서는 같아 보이므로, 배너는 **어느 쪽이든 참인 말**만 한다.
     *
     * 끊김(전송 오류)은 여기 들어오지 않는다 — 그쪽은 여느 SSH 타일과 똑같이 재연결 배너다.
     * `unopened` 와 배타적이다(붙은 적 없는 타일은 나올 tmux 도 없다). 동작은 같은 둘이고
     * (다시 붙기·닫기) **문구만** 다르다.
     */
    tmuxExit?: boolean;
  }

  /** 원격 새 워크트리 막대 — 첫 커밋 질문 · 실패 · git 신원 없음 */
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
    /** 재부착 유실 안내 — 걷는 것(아무 키 · 클릭 · 8초)은 `Terminal.svelte` 가 쥔다 */
    lost: LostNotice | null;
    tryReconnect: (manual: boolean) => Promise<void>;
    stopReconnect: (message: string, sgr?: string) => void;
    connectDeferred: () => Promise<void>;
    rerunSetup: () => void;
    launchSetupAgent: () => void;
    answerPrep: (answer: WorktreePrepAnswer) => void;
    reconnectEnded: () => Promise<void>;
    /** 이 패널을 닫아 달라 (종료됨 배너의 [닫기]) */
    onclose?: () => void;
  } = $props();
</script>

<!--
  연결 끊김 배너 — 터미널 **위에 겹쳐** 뜬다 (absolute). 레이아웃을 밀지 않으므로
  cols/rows 가 흔들리지 않고, 뒤의 스크롤백도 그대로 보인다.
-->
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
      <!-- 사유는 없을 수도 있다. 그래도 span 은 남겨 둔다 — 버튼을 오른쪽으로 미는 여백이다 -->
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
    <!--
      **다음에 할 일** — 사유 아래 흐린 한 줄 (docs/log/2026-09-17-connect-diagnostics.md).
      윗줄이 "무슨 일이 있었나" 라면 이 줄은 "그래서 어디를 보라" 다. 톤이 다르므로 한
      문장으로 잇지 않고, 사유 칸(`.why`)이 한 줄로 잘리는 자리라 물리적으로도 자리가 없다.
    -->
    {#if reconnect.hint}<div class="hint">{reconnect.hint}</div>{/if}
  </div>
{/if}

<!--
  복원 배너 — 지난 배치에서 되살아났지만 **아직 붙지 않은** SSH 타일
  (docs/log/2026-09-03-workspace-restore.md). 재연결 배너와 같은 상자를 쓰지만 자동
  루프가 없다: 접속은 [연결] 또는 Ctrl+Shift+R(모두 재연결)이 시작한다.
  [닫기] 는 배너만 감춘다 — 등록은 남아 있어 '모두 재연결' 은 이 타일도 붙인다.
-->
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

<!--
  설정 스크립트 실패 막대 (docs/log/2026-09-28-project-agent-setup-script.md) — 재연결·복원 배너와 **같은 상자**다.
  스크립트는 셸에서 멈췄고 에이전트는 뜨지 않았다. 다음 행동 셋: 폼을 열어 고친다 · 이 자리에서 다시 돌린다(성공하면
  에이전트) · 그냥 에이전트를 띄운다. [닫기] 는 막대만 감춘다(셸은 그대로 쓸 수 있다). 세션이 끝나 종료 배너가 서면
  그쪽이 먼저다.
-->
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

<!--
  원격 새 워크트리 막대 (2026-09-29 B안 · docs/log/2026-09-29-remote-worktree-after-connect.md) — 복원 · 설정 스크립트
  실패 막대와 **같은 상자**(`.reco`)다. 첫 커밋 질문은 주의(앰버 띠), 실패는 오류(붉은 띠). 질문의 답은 Rust 가 기다리는
  그 준비로 간다(`ssh_worktree_answer`) — [셸로 열기]는 워크트리 없이 평범한 셸(홈). 실패 · 신원 없음은 이미 평범한 셸로
  넘어간 뒤라 [닫기] 하나다. 세션이 끝나 종료 배너가 서면 그쪽이 먼저다.
-->
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

<!--
  재부착 유실 안내 (세션 서버 ④ · 설치본 실기 10-10) — 떨어진 세션에 다시 붙었는데 링을 넘긴 출력이 있었다. 예전엔
  버퍼에 한 줄을 썼다가 재생·실시간 출력·재그림에 묻혀 보이지 않았다 — 그래서 같은 상자(`.reco`, 주의 띠)로 띄운다.
  알리기만 하는 막대라 단추가 없다: 타일의 아무 클릭 · 아무 키 · 8초 뒤에 걷힌다(`Terminal.svelte` 가 쥔다 — `term/lost-notice.ts`).
  종료 배너가 서면 그쪽이 먼저다.
-->
{#if lost && !ended}
  <div class="reco glass-raised warn lost" role="status" data-lost-notice={lost.bytes}>
    <div class="row">
      <span class="head">{lostNoticeText(lost, tr)}</span>
    </div>
  </div>
{/if}

<!--
  종료됨 배너 — 세션이 정상적으로 끝났거나(로컬 셸의 `exit` 포함), 자동 재연결이 멈췄거나,
  **첫 접속 자체가 실패**했다 (docs/log/2026-09-03-keys-ended-focus.md ·
  docs/log/2026-09-04-default-shell-close-tile.md). 마지막 경우만 문구가 다르다
  (`unopened` — 붙은 적이 없으니 "종료" 가 아니다). 앞의 두 배너와 **같은 상자**를 쓰되 문구가
  다르다: 여기서는 스크롤백을 계속 읽을 수 있고, 다음 행동이 [다시 접속]/[닫기] 둘뿐이다.
  두 버튼에는 각각 Enter·Ctrl+D 라는 키가 있고 **문구가 그 키를 그대로 말해 준다** —
  죽은 타일에서만 도는 키라 어디에도 안 적어 두면 아무도 못 찾는다.
  [닫기] 는 배너만 감추는 것이 아니라 **패널을 없앤다** (deferred 의 [닫기] 와 다른 점이다:
  저쪽은 나중에 붙일 수 있는 타일이라 감추기만 한다).
-->
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
          <!--
            tmux 타일의 **깨끗한 종료** (docs/log/2026-09-16-tmux-toggle.md). 화면만으로는
            떼어 낸 것(세션이 산다)과 마지막 셸을 끝낸 것(세션이 없다)을 가를 수 없으므로,
            **어느 쪽이든 참인 말**만 한다 — 그 키를 쓰면 살아 있다는 조건문이다.
          -->
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
  /* 터미널 상단에 겹치는 오버레이 한 줄. 화면을 밀지 않는다 (fit 이 흔들리지 않게) */
  .reco {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 4;
    /* 상자는 세로다 — 첫 줄이 사실(사유 + 버튼), 둘째 줄이 제안(힌트)이다. 힌트가 없으면
       둘째 줄 자체가 없으므로 예전과 픽셀이 같다. */
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 10px;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--fg);
    /* 터미널 글자 위에 뜨는 중 층 면(10-29 — 토스트 · 메뉴와 같은 등급): 평면은 불투명(`--surface-raised-solid`), 글래스는
       `--glass-float` 판 + `.glass-raised` 의 흐림 · 흰 선(있는 아랫선의 색만)(theme.css 재질 절). 예전 `--bg-panel` 은
       슬라이더를 타 밑의 스크롤백 글자가 배너 글자와 겹쳐 읽혔다 */
    background: var(--glass-float, var(--surface-raised-solid));
    /* 아랫선은 머리카락 선 — 끊김은 강조색 셋 밖이다. 뜬 면이라는 것은 그림자가 말한다 */
    border-bottom: 1px solid var(--line-strong);
    box-shadow: var(--shadow-modal);
  }

  /* 성격 띠 — 왼쪽 2px (원격 새 워크트리 막대 · docs/log/2026-09-29-remote-worktree-after-connect.md). 첫 커밋 질문은
     주의(앰버 `--warn`), 만들지 못함은 오류(`--err`). 띠가 없는 예전 배너는 픽셀이 그대로다. */
  .reco.warn,
  .reco.err {
    padding-left: 12px;
  }

  /* 띠는 사실 줄(`.row`)의 가상 요소다 — 상자 자신의 `::before` · `::after` 는 글래스의 흐림 판(`.glass-raised`)가
     쓴다(10-29). `.row` 는 자리를 잡지 않아(`position` 없음) 이 절대 위치 상자는 `.reco` 기준이고, flex 줄에서도 빠진다 */
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

  /* 사실 줄 — 예전의 `.reco` 그 자체 (머리말 + 사유 + 버튼들) */
  .reco .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .reco .head {
    white-space: nowrap;
  }

  /* 다음에 할 일 — 흐리고 작게. 길면 접힌다 (버튼과 자리를 다투지 않는 아랫줄이다) */
  .reco .hint {
    color: var(--fg-muted);
    font-size: 11px;
    line-height: 1.35;
  }

  /* 끊긴 사유 — 길면 여기서만 줄어든다 (버튼은 항상 보여야 한다) */
  .reco .why {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--fg-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /*
    배너 단추 — 전역 `.btn .btn-sm` (docs/log/2026-09-25-leftovers-menus-dots.md). 앞의 것(지금
    재연결 · 연결 · 다시 접속)이 보조(회색 판), 뒤의 것(그만 · 닫기)이 고스트다. 옛 선 두른 규칙과
    강조색 호버 선은 지웠다 — 스코프 규칙이 전역 클래스를 이기므로 남기면 안 먹는다. `act` 는
    표식으로만 남는다(검증 도구가 `.reco .act` 로 찾는다). 줄어들지 않게만 붙든다.
  */
  /* 유실 안내 — 단추가 없는 알림 막대라 문구가 길면 접힌다 */
  .reco.lost .head {
    white-space: normal;
  }

  .reco .act {
    flex: 0 0 auto;
    white-space: nowrap;
  }
</style>
