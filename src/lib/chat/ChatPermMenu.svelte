<script lang="ts">
  /**
   * **권한 모드 메뉴**(2026-11-20 — 모드 칩이 연다 · 권한 모드 목업). 라디오 둘(`Manual` — 카드로 묻기 /
   * `Auto` — 묻지 않기) + 허용 목록이 비지 않았으면 "이 채팅에서 허용한 것" 머리와 항목 칩들(각 × = 그 종류 다시 묻기). 모양은 전역 메뉴 한 벌
   * (`.menu-*`), 몸짓은 `ToolbarMenu` 와 같다: 뜨면 지금 모드 줄에 포커스 · ↑↓ Home End 로 돌고 · Esc 는 칩으로 포커스를 돌려주고 · 바깥 누르기 ·
   * Tab · 창 크기 바뀜은 그냥 닫는다. 고르기의 몸은 `SideChatControls`(메뉴 통로 `runOnMenu` — 모드는 닫고 실행 · × 는 닫지 않고 실행)이고 이 상자는
   * 누름만 넘긴다. 자리는 칩을 담은 **입력 칸 상자의 오른쪽 끝**에 맞추고 폭은 `min(320px, 상자 폭)`(2026-11-20 실기 — 칩 끝에 맞추면 독 왼쪽
   * 밖으로 나갔다 · 상자를 못 찾으면 칩 오른쪽 끝 · 내용 폭) · 아래로 넘치면 위로(입력 칸은 독 아래쪽이라 대개 위) · 창 안으로 당긴다. 폰(`touch`)은 줄 44px.
   */
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { nextMenuIndex } from "$lib/browser/toolbar-tools";
  import { PERM_AUTO_ICON, PERM_MANUAL_ICON, PERM_MODE_WORD, PERM_MODES, allowKeyLabel } from "$lib/chat/perm-mode";
  import type { SideChatControls } from "$lib/chat/side-chat-controls.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let { ctl, trigger, touch = false }: { ctl: SideChatControls; trigger: HTMLElement; touch?: boolean } = $props();

  const EDGE = 8;
  let el = $state<HTMLElement | null>(null);
  let left = $state(0);
  let top = $state(0);
  /** 입력 칸 상자에 맞춘 폭(px) — 상자를 못 찾으면 null(내용 폭 · 칩 오른쪽 끝 정렬) */
  let width = $state<number | null>(null);
  /** 메뉴 폭 상한 — 상자가 더 넓어도 이만큼 */
  const MAX_W = 320;

  function place(): void {
    const node = el;
    if (!node) return;
    const r = trigger.getBoundingClientRect();
    // 칩을 담은 입력 칸 상자(`FlipComposer` 의 `.wrap`) — 오른쪽 끝을 그 상자에 맞추고 폭은 상자 안쪽(2026-11-20 실기 — 칩 끝 정렬이면 독 왼쪽 밖으로 나갔다)
    const box = trigger.closest("[data-flip-composer] .wrap")?.getBoundingClientRect() ?? null;
    if (box) width = Math.min(MAX_W, box.width, window.innerWidth - 2 * EDGE);
    const w = box && width !== null ? width : node.offsetWidth;
    const h = node.offsetHeight;
    const right = box ? box.right : r.right;
    left = Math.max(EDGE, Math.min(right - w, window.innerWidth - EDGE - w));
    const below = r.bottom + 4;
    top = below + h > window.innerHeight - EDGE ? Math.max(EDGE, r.top - 4 - h) : below;
  }

  $effect(() => {
    const node = el;
    if (!node) return;
    return untrack(() => {
      place();
      const ro = new ResizeObserver(place);
      ro.observe(node);
      const cur = node.querySelector<HTMLElement>('[data-perm-mode][aria-checked="true"]');
      (cur ?? node.querySelector<HTMLElement>("button") ?? node).focus({ preventScroll: true });
      return () => ro.disconnect();
    });
  });

  $effect(() => {
    const onDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (el?.contains(target) || trigger.contains(target)) return;
      ctl.closePerm(false);
    };
    const onResize = () => ctl.closePerm(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onResize);
    };
  });

  function onKey(ev: KeyboardEvent): void {
    const node = el;
    if (!node) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      ctl.closePerm(true);
      return;
    }
    if (ev.key === "Tab") {
      ctl.closePerm(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) {
      if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) ev.stopPropagation();
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>("button"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = nextMenuIndex(
      ev.key,
      at,
      buttons.map((b) => b.disabled),
    );
    if (next >= 0) buttons[next]?.focus();
  }

  /** × 로 지운 뒤 포커스가 사라진 단추에 남지 않게 — 남은 첫 항목(없으면 지금 모드 줄)으로 */
  function forget(kind: string): void {
    ctl.forgetAllow(kind);
    requestAnimationFrame(() => {
      const node = el;
      if (!node || node.contains(document.activeElement)) return;
      (node.querySelector<HTMLElement>("[data-perm-forget]") ?? node.querySelector<HTMLElement>('[data-perm-mode][aria-checked="true"]'))?.focus({
        preventScroll: true,
      });
    });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="pmm menu-surface"
  class:touch
  role="menu"
  aria-label={t("app.chatDock.permMode.menu")}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{top}px{width !== null ? `;width:${width}px;min-width:0;max-width:none` : ''}"
  onkeydown={onKey}
  data-chat-perm-menu
>
  {#each PERM_MODES as m (m)}
    <button
      type="button"
      class="menu-row pmm-mode"
      role="menuitemradio"
      aria-checked={ctl.permMode === m}
      data-perm-mode={m}
      onclick={() => ctl.pickPermMode(m)}
    >
      <span class="pmm-icon" class:auto={m === "auto"} aria-hidden="true"><UiIcon name={m === "auto" ? PERM_AUTO_ICON : PERM_MANUAL_ICON} size={14} /></span>
      <span class="pmm-text">
        <span class="pmm-word">{PERM_MODE_WORD[m]}</span>
        <span class="pmm-desc">{t(m === "auto" ? "app.chatDock.permMode.auto.desc" : "app.chatDock.permMode.manual.desc")}</span>
      </span>
      <span class="pmm-check" aria-hidden="true">{#if ctl.permMode === m}<UiIcon name="check" size={14} />{/if}</span>
    </button>
  {/each}
  {#if ctl.permAllow.length > 0}
    <hr class="menu-sep" />
    <div class="menu-title pmm-head" data-perm-allowed-head>{t("app.chatDock.permMode.allowed")}</div>
    <div class="pmm-chips" data-perm-allowed>
      {#each ctl.permAllow as kind (kind)}
        {@const name = allowKeyLabel(kind, t)}
        <span class="pmm-chip" data-perm-allow={kind}>
          <span class="pmm-chip-name">{name}</span>
          <button
            type="button"
            class="pmm-x"
            data-perm-forget={kind}
            title={t("app.chatDock.permMode.forget", { name })}
            aria-label={t("app.chatDock.permMode.forget", { name })}
            onclick={() => forget(kind)}><UiIcon name="close" size={12} /></button
          >
        </span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .pmm {
    position: fixed;
    z-index: 41;
    /* 인라인 `width`(입력 칸 상자에 맞춘 폭)가 테두리 · 패딩까지 든 폭이게 — content-box 면 그만큼(10px) 상자 오른쪽 밖으로 나간다(2026-11-20 실기) */
    box-sizing: border-box;
    width: max-content;
    min-width: 240px;
    max-width: min(340px, calc(100vw - 16px));
  }

  /* 두 줄 라디오(낱말 + 설명) — 전역 줄 한 벌의 28px 를 풀어 준다 */
  .pmm-mode {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: auto;
    min-height: 40px;
    padding-top: 5px;
    padding-bottom: 5px;
    white-space: normal;
  }

  .pmm.touch .pmm-mode {
    min-height: 48px;
  }

  .pmm-icon {
    flex: none;
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-2);
    background: var(--control-tile-bg);
    border-radius: 50%;
  }

  .pmm-icon.auto {
    color: var(--on-accent);
    background: var(--accent);
  }

  .pmm-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }

  .pmm-word {
    font-weight: var(--fw-semibold);
  }

  .pmm-desc {
    font-size: var(--t-xs);
    color: var(--fg-2);
    white-space: normal;
    /* 한국어는 낱말 가운데서 끊지 않는다(끝 글자 하나만 다음 줄로 넘어가지 않게) */
    word-break: keep-all;
  }

  .pmm-check {
    flex: none;
    width: 16px;
    display: inline-flex;
    justify-content: center;
    color: var(--fg-2);
  }

  .pmm-head {
    padding-top: var(--space-1);
  }

  .pmm-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: var(--space-1) var(--space-2) var(--space-2);
  }

  .pmm-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    height: 24px;
    padding: 0 2px 0 10px;
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--control-tile-bg);
    border-radius: 999px;
  }

  .pmm-chip-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pmm-x {
    position: relative;
    flex: none;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .pmm-x:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .pmm-x:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 0;
  }

  .pmm.touch .pmm-chip {
    height: 32px;
  }

  .pmm.touch .pmm-x {
    width: 28px;
    height: 28px;
  }
</style>
