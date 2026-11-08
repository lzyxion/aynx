<script lang="ts">
  /**
   * **타일 상자 밖의 메뉴 · 호버 카드 층** — `PaneHost.svelte` 에서 뗀 표시 조립(2026-10-26 분할 3차): 타일 ⋯ 메뉴 · tmux 세션 ·
   * 포워딩 목록 · AI 권한(원격 · 쿼리 · 로컬) · "+N" 칩 메뉴 · 이름 카드 · tmux 카드 · 포워딩 카드. 새 상태는 없다 — 열림 · 자리 · 줄 실행은
   * `PaneHost` 가 만든 컨트롤러(`tmc` · `tm` · `fm` · `ai` · `dbm` · `lam` · `cm`)를 그대로 받아 읽고, 카드 값은 부모의 `$state` 를 프롭으로 받는다.
   * 감싸개 없음 — `PaneHost` 의 `.host` 안, 분할선 층 뒤에 그대로 선다(바깥 누름 · Esc 는 각 그림의 몫).
   */
  import PaneMenu from "$lib/pane/PaneMenu.svelte";
  import TmuxMenu from "$lib/pane/TmuxMenu.svelte";
  import AiPermMenu from "$lib/pane/AiPermMenu.svelte";
  import SessionInfoCard from "$lib/pane/SessionInfoCard.svelte";
  import TmuxSessionsCard from "$lib/pane/TmuxSessionsCard.svelte";
  import ForwardMenu from "$lib/pane/ForwardMenu.svelte";
  import ForwardsCard from "$lib/pane/ForwardsCard.svelte";
  import ChipMoreMenu from "$lib/pane/ChipMoreMenu.svelte";
  import type { ChipMoreItem, ChipMoreMenuController } from "$lib/pane/chip-more-menu.svelte.js";
  import type { TmuxCardView } from "$lib/pane/tmux-sessions.svelte.js";
  import type { SessionCardView } from "$lib/session-info";
  import type { TileMenuController } from "$lib/pane/tile-menu-controller.svelte.js";
  import type { TmuxMenuController } from "$lib/pane/tmux-menu.svelte.js";
  import { HOST_STAGE_ROWS, type AiPermMenuController } from "$lib/pane/ai-perm-menu.svelte.js";
  import { DB_STAGE_ROWS, dbAiMenuNotes, queryAiOf, type DbAiMenuController } from "$lib/pane/db-ai-menu.svelte.js";
  import type { LocalAiMenuController } from "$lib/pane/local-ai-menu.svelte.js";
  import { LOCAL_LOCKED_FROM, LOCAL_STAGE_ROWS, localAiStage } from "$lib/pane/local-ai";
  import type { ForwardMenuController, ForwardsCardView } from "$lib/pane/forward-menu.svelte.js";
  import { openForwardUrl, stopPaneForward } from "$lib/app/forwards.svelte.js";
  import { delegationGrantsOf, paneAiStage } from "$lib/app/delegation.svelte.js";
  import { stageAtLeast } from "$lib/delegation";
  import { currentWindowLabel, tileCode } from "$lib/context";
  import type { PaneHostProps } from "$lib/pane/props";
  import { t as tr } from "$lib/i18n/i18n.svelte.js";
  import { displayName } from "$lib/app/titles.svelte.js";

  let {
    tmc,
    tm,
    fm,
    ai,
    dbm,
    lam,
    cm,
    sessionOf,
    forwardsOf,
    onopentmux,
    onforwardpane,
    pickChipMore,
    infoCard,
    tmuxCard,
    forwardsCard,
  }: Pick<PaneHostProps, "sessionOf" | "forwardsOf" | "onopentmux" | "onforwardpane"> & {
    tmc: TileMenuController;
    tm: TmuxMenuController;
    fm: ForwardMenuController;
    ai: AiPermMenuController;
    dbm: DbAiMenuController;
    lam: LocalAiMenuController;
    cm: ChipMoreMenuController;
    /** "+N" 메뉴의 줄 하나 — 그 칩을 누른 것과 같은 일(`PaneHost`) */
    pickChipMore: (item: ChipMoreItem) => void;
    infoCard: (SessionCardView & { paneId: string }) | null;
    tmuxCard: (TmuxCardView & { paneId: string }) | null;
    forwardsCard: (ForwardsCardView & { paneId: string }) | null;
  } = $props();
</script>

<!--
  타일 ⋯ 메뉴 — **타일 상자 밖**에 그린다 (상자마다 `isolation: isolate` 라 안에서는
  `position: fixed` 여도 이웃 타일·분할선 층에 덮인다). 한 번에 하나만 열리므로 목록이
  하나뿐이어도 된다. 제목(아래 tmux · 포워딩 팝오버도)은 `paneName`(안정된 정체성)이 아니라
  `displayName` — 머리줄 · 폰 위 띠와 같은 이름이다(2026-10-20: 로컬 AI 타일의 머리줄은
  "Claude Code" 인데 메뉴 제목은 셸 라벨 "PowerShell 7" 이라고 말했다).
-->
{#if tmc.tileMenu && tmc.menuBox}
  <PaneMenu
    title={displayName(tmc.menuBox.pane)}
    items={tmc.menuItems}
    left={tmc.tileMenu.left}
    top={tmc.tileMenu.top}
    onrun={tmc.runMenuAction}
    onclose={tmc.closeTileMenu}
  />
{/if}

<!--
  tmux 세션 팝오버 — ⋯ 메뉴와 **같은 자리, 같은 이유**로 타일 상자 밖에 그린다.
  둘은 동시에 뜨지 않는다 (메뉴 항목이 메뉴를 닫고 이것을 연다).
-->
{#if tm.tmuxMenu && tm.tmuxBox}
  <TmuxMenu
    title={displayName(tm.tmuxBox.pane)}
    sessionId={sessionOf?.(tm.tmuxBox.pane.id) ?? null}
    current={tm.tmuxBox.pane.tmux ?? null}
    left={tm.tmuxMenu.left}
    top={tm.tmuxMenu.top}
    onswitch={(name) => tm.runTmuxMenu((m) => void tm.switchTmuxIn(m, name))}
    onopen={(name) => tm.runTmuxMenu((m) => onopentmux?.(m.tab.id, m.pane.id, name))}
    onkill={tm.killTmuxFromMenu}
    onclose={tm.closeTmuxMenu}
  />
{/if}

<!--
  포워딩 목록 메뉴 — ⋯ 메뉴·tmux 팝오버와 **같은 자리, 같은 이유**로 타일 상자 밖에 그린다. 줄의 값(포워드 · 주소)은
  마크업이 인자로 올리고, 대상 타일의 스냅샷 → 닫기 → 실행은 `fm.runForwardMenu`(`runOnMenu`)가 든다.
-->
{#if fm.forwardMenu && fm.forwardBox}
  <ForwardMenu
    title={displayName(fm.forwardBox.pane)}
    forwards={forwardsOf?.(fm.forwardBox.pane.id) ?? []}
    left={fm.forwardMenu.left}
    top={fm.forwardMenu.top}
    onstop={(f) => fm.runForwardMenu((m) => void stopPaneForward(m.pane.id, f.id))}
    onbrowse={(url) => fm.runForwardMenu(() => openForwardUrl(url))}
    onadd={() => fm.runForwardMenu((m) => onforwardpane?.(m.tab.id, m.pane.id))}
    onclose={fm.closeForwardMenu}
  />
{/if}

<!--
  AI 권한 팝오버 — ⋯ 메뉴·tmux 팝오버와 **같은 자리, 같은 이유**로 타일 상자 밖에 그린다. 단계·헤드리스
  값은 앱의 권한 표(`delegation-changed` 로 다시 읽는다)에서 온다 — 고르면 저장 → 표 → 이 상자 순으로 맞는다.
-->
{#if ai.aiMenu && ai.aiBox && ai.aiAlias}
  {@const aiAlias = ai.aiAlias}
  {@const aiStageNow = paneAiStage(ai.aiBox.pane) ?? "off"}
  <AiPermMenu
    title={tr("pane.aiperm.title", { alias: aiAlias })}
    sub={tr("pane.aiperm.sub", { n: ai.tileCount(aiAlias) })}
    code={tileCode(currentWindowLabel(), ai.aiBox.pane.id)}
    stages={HOST_STAGE_ROWS}
    stage={aiStageNow}
    headless={{
      on: delegationGrantsOf(aiAlias)?.connect ?? false,
      allowed: stageAtLeast(aiStageNow, "approve"),
      onchange: (on) => void ai.setHeadless(aiAlias, on),
    }}
    settingsLabel={tr("pane.aiperm.settings")}
    left={ai.aiMenu.left}
    top={ai.aiMenu.top}
    onpick={(stage) => void ai.pickStage(aiAlias, stage)}
    onsettings={ai.openHostSettings}
    onclose={ai.closeAiMenu}
  />
{/if}

<!--
  쿼리 타일의 AI 권한 팝오버 (10-14) — 위와 **같은 상자**. 단계는 앱의 DB 권한 사본(`app/db-ai`)에서 온다 — 고르면 저장 → 사본 →
  이 상자 · 머리줄 칩 · 독 · 폼 · 설정 › 보안 표가 함께 맞는다. 풀린 권한(대상이 바뀜)은 어느 줄도 고른 표시 없이 안내 줄로 말한다.
-->
{#if dbm.at && dbm.box && dbm.conn}
  {@const dbConn = dbm.conn}
  {@const dbNow = queryAiOf(dbm.box.pane)}
  <AiPermMenu
    title={tr("pane.aiperm.title", { alias: dbConn.name })}
    sub={tr("pane.dbaiperm.sub")}
    code={tileCode(currentWindowLabel(), dbm.box.pane.id)}
    stages={DB_STAGE_ROWS}
    stage={dbNow === null || dbNow.broken ? null : dbNow.level}
    notes={dbAiMenuNotes(dbNow?.broken ?? false, dbNow?.level ?? "off")}
    settingsLabel={tr("pane.dbaiperm.settings")}
    left={dbm.at.left}
    top={dbm.at.top}
    onpick={(level) => void dbm.pick(dbConn, level)}
    onsettings={dbm.openConnSettings}
    onclose={dbm.close}
  />
{/if}

<!--
  로컬 타일의 AI 권한 팝오버 (10-23) — 위와 **같은 상자**. 단계는 원격과 같은 다섯이되 Ask 부터 잠기고(로컬 타일은 AI 실행 대상이
  아니다) 아래 각주가 그 이유를 말한다. 고르면 타일별 읽기 허용이 바뀐다 → 칩 · 이 상자가 함께 맞는다.
-->
{#if lam.at && lam.box}
  {@const localPaneId = lam.box.pane.id}
  <AiPermMenu
    title={tr("pane.localaiperm.title")}
    sub={tr("pane.localaiperm.sub")}
    code={tileCode(currentWindowLabel(), localPaneId)}
    stages={LOCAL_STAGE_ROWS}
    stage={localAiStage(localPaneId)}
    lockedFrom={LOCAL_LOCKED_FROM}
    footnote={tr("pane.localaiperm.foot")}
    left={lam.at.left}
    top={lam.at.top}
    onpick={(stage) => lam.pick(localPaneId, stage)}
    onclose={lam.close}
  />
{/if}

<!--
  "+N" 칩 메뉴 (2026-10-23) — 넘쳐서 숨은 칩들. ⋯ 메뉴 · tmux 팝오버와 **같은 자리, 같은 이유**로 타일 상자 밖에 그린다. 고른 줄은
  마크업이 인자로 올리고, 대상 타일의 스냅샷 → 닫기 → 실행은 `cm.run`(`runOnMenu`)이 든다.
-->
{#if cm.at && cm.box}
  <ChipMoreMenu
    title={displayName(cm.box.pane)}
    items={cm.items}
    left={cm.at.left}
    top={cm.at.top}
    onpick={pickChipMore}
    onclose={cm.close}
  />
{/if}

<!-- SSH 이름 카드 — 같은 자리·같은 이유(상자 밖). 커서를 먹지 않는 시각 층이다 -->
{#if infoCard}
  <SessionInfoCard
    name={infoCard.name}
    code={infoCard.code}
    address={infoCard.address}
    color={infoCard.color}
    icon={infoCard.icon ?? null}
    card={infoCard.card}
    anchor={infoCard.anchor}
  />
{/if}

<!-- tmux 칩 호버 카드 — 같은 자리·같은 이유(상자 밖). 커서를 먹지 않는 시각 층이다 -->
{#if tmuxCard}
  <TmuxSessionsCard sessions={tmuxCard.sessions} current={tmuxCard.current} anchor={tmuxCard.anchor} />
{/if}

<!-- 포워딩 칩 호버 카드 — 같은 자리·같은 이유(상자 밖). 커서를 먹지 않는 시각 층이다 -->
{#if forwardsCard}
  <ForwardsCard forwards={forwardsCard.forwards} anchor={forwardsCard.anchor} />
{/if}
