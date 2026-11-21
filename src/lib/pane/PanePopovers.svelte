<script lang="ts">
  /**
   * 타일 상자 밖의 메뉴 · 호버 카드 층 — 상자마다 `isolation: isolate` 라 안에서 그리면 이웃 타일 · 분할선 층에 덮인다.
   * 새 상태는 없다 — 컨트롤러와 카드 값은 `PaneHost` 가 만들어 넘긴다.
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
    cm: ChipMoreMenuController;
    /** "+N" 메뉴의 줄 하나 — 그 칩을 누른 것과 같은 일(`PaneHost`) */
    pickChipMore: (item: ChipMoreItem) => void;
    infoCard: (SessionCardView & { paneId: string }) | null;
    tmuxCard: (TmuxCardView & { paneId: string }) | null;
    forwardsCard: (ForwardsCardView & { paneId: string }) | null;
  } = $props();
</script>

<!-- 제목은 `paneName` 이 아니라 `displayName` — 머리줄 · 폰 위 띠와 같은 이름이다(아래 tmux · 포워딩도) -->
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

{#if tmuxCard}
  <TmuxSessionsCard sessions={tmuxCard.sessions} current={tmuxCard.current} anchor={tmuxCard.anchor} />
{/if}

{#if forwardsCard}
  <ForwardsCard forwards={forwardsCard.forwards} anchor={forwardsCard.anchor} />
{/if}
