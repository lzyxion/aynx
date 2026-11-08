<script lang="ts">
  // 끝내기 모달 — 독의 끝내기 단추가 연다. 상태 · 실행은 `app/quit-dialog` 에 있다.
  import { untrack } from "svelte";
  import { invoke } from "$lib/ipc";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import UiIcon from "$lib/UiIcon.svelte";
  import {
    closeQuitDialog,
    closeThisWindow,
    hideToTray,
    quitAll,
    quitDialogOpen,
    quitGui,
  } from "$lib/app/quit-dialog.svelte.js";
  import { isMainWindow } from "$lib/app/window.svelte.js";
  import { detachedCount, refreshDetached } from "$lib/app/detached.svelte.js";

  let modalEl = $state<HTMLElement | null>(null);
  let firstTile = $state<HTMLButtonElement | null>(null);
  /** 세션 서버의 세션 수(앱 전체 — 이 창만이 아니다) · 못 읽었으면 `null`(줄에서 빠진다) */
  let sessions = $state<number | null>(null);
  /** 이 환경에 트레이가 있나(지금은 Windows) — 없으면 [트레이로 숨기기] 판이 서지 않는다. 프런트는 OS 를 모른다 */
  let traySupported = $state(false);
  void invoke<{ supported: boolean }>("tray_status")
    .then((s) => (traySupported = s.supported))
    .catch(() => {});

  // 뜰 때마다 수를 새로 읽고, 첫 판에 커서를 놓는다(Enter 가 닿을 자리).
  // 여는 것 하나에만 묶는다(`untrack`) — `focus()` 가 동기로 부르는 `focusin` 리스너(툴팁 층)가 말풍선 상태를 읽어 이 효과가
  // 거기에도 묶였고, 말풍선이 뜰 때마다 다시 돌아 고른 판을 [GUI 종료] 로 끌어왔다(10-29 — 호버 말풍선이 뜨자마자 졌다)
  $effect(() => {
    if (!quitDialogOpen()) return;
    untrack(() => {
      sessions = null;
      void invoke<{ connected: boolean; sessions: number | null }>("session_server_status")
        .then((s) => (sessions = s.connected ? s.sessions : null))
        .catch(() => {});
      void refreshDetached();
      firstTile?.focus();
    });
  });

  /** 판 사이 옮기는 키 — 화살표 넷은 판이 쥔다(전역 `Alt+화살표` · 뒤의 터미널로 새지 않게) */
  const MOVE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

  /** 고른 판 = 포커스된 판(로빙 포커스) — 키 · 호버가 같은 자리를 옮긴다. 화면에 강조가 둘 서지 않는다 */
  function moveSelection(key: string): void {
    if (!modalEl) return;
    const tiles = [...modalEl.querySelectorAll<HTMLButtonElement>("button.tile")];
    if (tiles.length === 0) return;
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    const last = tiles.length - 1;
    let next: number;
    if (key === "Home") next = 0;
    else if (key === "End") next = last;
    else if (key === "ArrowLeft") next = at <= 0 ? last : at - 1; // 끝에서 감싼다
    else if (key === "ArrowRight") next = at === -1 || at === last ? 0 : at + 1;
    else return; // 위 · 아래는 한 줄이라 뜻이 없다 — 삼키기만 한다
    tiles[next].focus();
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeQuitDialog();
      return;
    }
    if (MOVE_KEYS.has(ev.key)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey) moveSelection(ev.key);
      return;
    }
    if (modalEl) trapTab(ev, modalEl);
  }

  /** 호버도 고르기다 — 커서가 올라간 판으로 포커스를 옮긴다(키로 고른 판과 호버한 판이 따로 빛나지 않게) */
  function hoverSelect(ev: PointerEvent): void {
    (ev.currentTarget as HTMLButtonElement).focus({ preventScroll: true });
  }
</script>

<!--
  **끝내기 모달** (2026-10-28 — 목업 3KjFm4MbLeTPXyPLzbSjmv). 예전의 [모든 세션 종료] 확인 상자를 갈음한다.

  - 제목 · 취소 단추 · 판 안의 글자가 없다(사용자) — 판은 아이콘 상자뿐이고 이름은 툴팁(`title`) · 접근성 이름(`aria-label`)이다
    (10-28 — 이름을 판에서 걷고 툴팁의 부가 설명도 걷었다 · [모두 종료]의 빨간색도 걷어 넷이 같은 모양). 닫기는 Esc · 막 바깥 누르기.
  - 판 셋: [트레이로 숨기기](트레이가 있는 환경만 · 세션은 산다) · [GUI 종료](세션은 산다) · [모두 종료](세션 · 세션 서버 · 앱 —
    **두 번 묻지 않는다**). 판은 한 변 72px 고정 — 모달 폭이 판 수를 따라간다.
  - 판 아래 한 줄 — 지금 걸려 있는 것의 수(열린 세션 = 세션 서버 전체 · 떨어진 세션). 가림막 요약과 같은 색 점 + 옅은 글자.
  - 뒤는 흐리지 않고 옅은 막(25%)만 — 볼트 잠금 해제 모달과 같은 둘레.
  - **고르기는 하나** (10-29): 고른 판 = 포커스된 판이다(로빙 포커스). 뜰 때 [GUI 종료] 가 골라져 있고, ← → 로 옮기며(끝에서
    감싼다) Home · End 는 처음 · 끝, Enter · Space 가 누른다(네이티브 단추). Tab 도 판 사이를 돈다(`trapTab`). 화살표는 판이
    삼킨다 — 전역 `Alt+화살표` · 뒤의 터미널에 닿지 않는다. 커서를 올린 판도 포커스를 받아(스크롤 없이) 키로 고른 판과 호버한
    판이 따로 빛나지 않는다. 고른 판은 강조색(`--control-on-*`)으로 채워지고 둥근 정사각 → 원으로 바뀐다(움직임 줄이기면 즉시).
    글래스 판이라 판 · 조상에 opacity · filter 를 쓰지 않는다(흐림이 죽는다 — 10-28).
-->
{#if quitDialogOpen()}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay overlay-fade" onclick={(ev) => ev.target === ev.currentTarget && closeQuitDialog()}>
    <div
      class="quit glass-raised modal-rise"
      role="dialog"
      aria-modal="true"
      aria-label={t("app.quit.aria")}
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={onKeydown}
    >
      <!-- 말풍선은 손을 얹었을 때만(`data-tip-hover-only` — 화살표로 고를 때마다 따라다니지 않게, 10-29 사용자) -->
      <div class="tiles" data-tip-hover-only style:--tiles={(traySupported ? 3 : 2) + (isMainWindow ? 0 : 1)}>
        {#if !isMainWindow}
          <button type="button" class="tile" title={t("app.quit.window")} aria-label={t("app.quit.window")} data-quit="window" onclick={closeThisWindow} onpointerenter={hoverSelect}>
            <span class="badge" aria-hidden="true"><UiIcon name="close" size={20} /></span>
          </button>
        {/if}
        {#if traySupported}
          <button type="button" class="tile" title={t("app.quit.tray")} aria-label={t("app.quit.tray")} data-quit="tray" onclick={hideToTray} onpointerenter={hoverSelect}>
            <span class="badge" aria-hidden="true"><UiIcon name="download" size={20} /></span>
          </button>
        {/if}
        <button type="button" class="tile" title={t("app.quit.gui")} aria-label={t("app.quit.gui")} bind:this={firstTile} data-quit="gui" onclick={quitGui} onpointerenter={hoverSelect}>
          <span class="badge" aria-hidden="true"><UiIcon name="monitor" size={20} /></span>
        </button>
        <button type="button" class="tile" title={t("app.quit.all")} aria-label={t("app.quit.all")} data-quit="all" onclick={quitAll} onpointerenter={hoverSelect}>
          <span class="badge" aria-hidden="true"><UiIcon name="power" size={20} /></span>
        </button>
      </div>

      {#if sessions !== null || detachedCount() > 0}
        <div class="facts" data-quit-facts>
          {#if sessions !== null}
            <span class="fact open"><span class="dot" aria-hidden="true"></span>{t("app.quit.sessions", { n: sessions })}</span>
          {/if}
          {#if detachedCount() > 0}
            <span class="fact detached"
              ><span class="dot" aria-hidden="true"></span>{t("app.quit.detached", { n: detachedCount() })}</span
            >
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    /* 흐림 없이 옅은 막만 — 볼트 잠금 해제 모달과 같은 둘레 */
    background: color-mix(in srgb, #000 25%, transparent);
  }

  .quit {
    box-sizing: border-box;
    width: fit-content;
    max-width: 100%;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    color: var(--fg-1);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: 24px;
    box-shadow: var(--shadow-raised);
    outline: none;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(var(--tiles, 2), 72px);
    justify-content: center;
    gap: 8px;
  }

  /* 끝이 둥근 정사각 판 — 아이콘 하나(이름은 툴팁 · 10-28). 판 전체를 아이콘 상자 색으로 채운다(11-01 — 판 안에 상자가
     하나 더 보이던 겹을 걷음). 고른 판(= 포커스 — 호버도 포커스를 옮긴다)은 강조색으로 채워지며 원이 된다(10-29).
     호버만의 따로 뜨는 모양은 없다 — 강조가 둘 서지 않게 */
  .tile {
    box-sizing: border-box;
    width: 72px;
    aspect-ratio: 1 / 1;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font: inherit;
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
    border: none;
    border-radius: 18px;
    cursor: pointer;
    transition:
      background-color 180ms ease,
      color 180ms ease,
      border-radius 180ms ease;
  }

  /* 마우스로 옮긴 포커스에도 서야 해서 :focus-visible 이 아니라 :focus 다. 채움 자체가 표시라 고리는 겹쳐 보여 걷는다 */
  .tile:focus {
    color: var(--control-on-fg);
    background: var(--control-on-bg);
    border-radius: 50%;
    outline: none;
  }

  /* 고대비(강제 색) 모드는 채움이 지워진다 — 그때만 원을 따라 도는 고리로 표시한다 */
  @media (forced-colors: active) {
    .tile:focus {
      outline: 2px solid CanvasText;
      outline-offset: 2px;
    }
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    color: inherit;
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 14px;
    font-size: var(--t-xs);
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
  }

  .fact {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-3);
  }

  .fact.open .dot {
    background: var(--ok);
  }

  @media (prefers-reduced-motion: reduce) {
    .tile {
      transition: none;
    }
  }
</style>
