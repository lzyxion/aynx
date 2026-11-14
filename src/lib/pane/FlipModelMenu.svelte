<script lang="ts" module>
  /** 모델 줄 하나 — 값(보낼 줄의 재료 — 부르는 쪽이 허용 목록으로 거른다) · 글자 · ✓ */
  export interface FlipModelRow {
    value: string;
    label: string;
    checked: boolean;
  }
</script>

<script lang="ts">
  /**
   * **AI 타일 대화 면의 모델 메뉴**(2026-11-13 — 목업 E3 · 2026-11-14 넓힘 · 입력 칸 모델 키워드가 연다). 상자 · 줄 · 자리 셈은 사이드 채팅의
   * 모델 메뉴(`chat/ChatModelPopover`)와 같은 손이고 Effort 칸은 같은 게이지(`chat/ChatEffortGauge`). CLI 스위치 · 직접 입력은 없다(그 타일의
   * CLI 는 이미 떠 있다). 줄 · 단계 · 고리 · 안내는 부르는 쪽(`AiFlip`)이 CLI 마다 정한다:
   *
   * - **Claude Code**: 모델 = Default + 별칭 넷(`/model default` · `/model <별칭>`), 게이지 = Default 고리 + Low … Max(`/effort auto` ·
   *   `/effort <단계>`), 안내 "새 Claude 세션의 기본값도 함께 바뀝니다".
   * - **Codex**: 모델 = 그 PC 의 Codex 모델 목록(`codex_models`), 게이지 = 그 모델이 받는 단계(고리 없음 — 한 줄로 되돌리는 명령이 없다),
   *   안내 "이 세션에만 적용됩니다". 목록을 모르면(원격 SSH 타일 · 캐시 없음) 모델 줄 없이 게이지만.
   *
   * 고른 것을 보내는 줄은 부르는 쪽이 `pane/flip-model.ts` 의 허용 목록으로 짓는다(불변식 4). 고르면 닫는다(부르는 쪽이 메뉴 통로 `runOnMenu`
   * 로 — 스냅샷 → 닫기 → 실행). 닫기는 Esc(연 단추로 포커스) · 바깥 누르기 · 창 크기 바뀜. 이 상자는 누름만 올린다.
   *
   * **`document.body` 로 옮겨 그린다**(`portal` — `ImageMenu` 와 같은 까닭): 부르는 곳이 카드 뒤집기(`transform`) 상자 안이라 그 안에서는
   * `position: fixed` 의 기준이 창이 아니다. 그리고 대화 면 상자의 캡처 단계 키(`AiFlip` — Esc = 터미널로 · ↑↓ = 기록 굴리기)가 메뉴의 키를
   * 먼저 가로채지 않는다.
   */
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import ChatEffortGauge from "$lib/chat/ChatEffortGauge.svelte";
  import { effortName } from "$lib/chat/side-chat-controls.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    cli,
    models,
    levels,
    effort,
    ring,
    note,
    trigger,
    touch = false,
    onmodel,
    oneffort,
    onclose,
  }: {
    /** 그 타일의 CLI(표식만) */
    cli: string;
    /** 모델 줄 — 비면 모델 묶음이 없다(게이지만) */
    models: readonly FlipModelRow[];
    /** 게이지 칸(낮은 것부터) */
    levels: readonly string[];
    /** 지금 강도 — `""` = Default 고리(ring 일 때) · 칸 밖이면 고른 칸 없음 */
    effort: string;
    /** 왼쪽 Default 고리 */
    ring: boolean;
    /** 맨 아래 작은 회색 안내 한 줄 */
    note: string;
    /** 연 단추(모델 키워드) */
    trigger: HTMLElement;
    /** 폰 — 줄 44px */
    touch?: boolean;
    onmodel: (value: string) => void;
    oneffort: (level: string) => void;
    /** 닫는다 — 참이면 연 단추로 포커스 */
    onclose: (back: boolean) => void;
  } = $props();

  const EDGE = 8;
  const labelId = `flip-models-${Math.random().toString(36).slice(2, 8)}`;
  const anyChecked = $derived(models.some((m) => m.checked));

  let el = $state<HTMLElement | null>(null);

  /** 이 노드를 `body` 끝으로 옮긴다(머리말의 까닭) — 사라질 때 함께 걷는다 */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
  let left = $state(0);
  let top = $state(0);

  /** 자리 — 연 단추의 오른쪽 끝에 맞추고 위(입력 칸은 아래쪽이다 — 넘치면 아래)에. `ChatModelPopover` 와 같은 셈의 위아래만 뒤집었다 */
  function place(): void {
    const node = el;
    if (!node) return;
    const r = trigger.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    left = Math.max(EDGE, Math.min(r.right - w, window.innerWidth - EDGE - w));
    const above = r.top - 4 - h;
    top = above < EDGE ? Math.min(r.bottom + 4, window.innerHeight - EDGE - h) : above;
  }

  $effect(() => {
    const node = el;
    if (!node) return;
    return untrack(() => {
      place();
      const ro = new ResizeObserver(place);
      ro.observe(node);
      // 첫 포커스 — 고른 모델 줄(없으면 첫 줄 · Codex 는 그 한 줄)
      const cur = node.querySelector<HTMLElement>('[data-flip-model][aria-checked="true"]');
      (cur ?? node.querySelector<HTMLElement>("[data-flip-model], [data-chat-effort][tabindex='0']") ?? node).focus({ preventScroll: true });
      return () => ro.disconnect();
    });
  });

  /** 바깥을 누르면 닫는다 — 연 단추만 비켜 간다(그 단추의 click 이 닫기를 맡는다). 창 크기가 바뀌어도 닫는다 */
  $effect(() => {
    const onDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (el?.contains(target) || trigger.contains(target)) return;
      onclose(false);
    };
    const onResize = () => onclose(false);
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
      onclose(true);
      return;
    }
    if (ev.key === "Tab") {
      // 상자 안에서 돈다 — 묶음마다 Tab 에 걸린 것 하나
      const stops = Array.from(node.querySelectorAll<HTMLElement>('button[tabindex="0"]'));
      if (stops.length === 0) return;
      const i = stops.indexOf(document.activeElement as HTMLElement);
      const next = ev.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : i < 0 || i >= stops.length - 1 ? 0 : i + 1;
      ev.preventDefault();
      ev.stopPropagation();
      stops[next].focus({ preventScroll: true });
      return;
    }
    // 맨 글자는 상자 안에서 끝낸다(뒤의 입력 칸 · 대화 면 키가 받지 않게)
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) ev.stopPropagation();
  }

  /** 모델 줄 안 ↑↓ — 포커스만 옮긴다(끝에서 돈다) */
  function rove(ev: KeyboardEvent): void {
    if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown" && ev.key !== "Home" && ev.key !== "End") return;
    const list = Array.from(el?.querySelectorAll<HTMLElement>("[data-flip-model]") ?? []);
    if (list.length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = list.length - 1;
    else if (ev.key === "ArrowDown") next = i < 0 || i >= list.length - 1 ? 0 : i + 1;
    else next = i <= 0 ? list.length - 1 : i - 1;
    list[next].focus({ preventScroll: true });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="fm menu-surface"
  class:touch
  role="dialog"
  aria-label={t("pane.flip.model.menu")}
  tabindex="-1"
  bind:this={el}
  use:portal
  style="left:{left}px;top:{top}px"
  onkeydown={onKey}
  data-flip-model-menu={cli}
>
  {#if models.length > 0}
    <div class="label" id={labelId}>{t("app.chatDock.model.label")}</div>
    <div class="models" role="radiogroup" aria-labelledby={labelId}>
      {#each models as m, i (m.value)}
        <button
          type="button"
          role="radio"
          class="row menu-row"
          aria-checked={m.checked}
          tabindex={m.checked || (!anyChecked && i === 0) ? 0 : -1}
          data-flip-model={m.value}
          onkeydown={rove}
          onclick={() => onmodel(m.value)}
        >
          <span class="row-label">{m.label}</span>
          <span class="check" aria-hidden="true">{#if m.checked}<UiIcon name="check" size={14} />{/if}</span>
        </button>
      {/each}
    </div>
    <hr class="menu-sep" />
  {/if}
  <ChatEffortGauge {levels} value={effort} nameOf={(e) => (e ? effortName(e) : ring ? effortName("") : "")} noDefault={!ring} {touch} onpick={(e) => oneffort(e)} />
  <p class="note" data-flip-model-note>{note}</p>
</div>

<style>
  /* 상자 · 줄 · 구분선은 전역 메뉴 한 벌 — 폭과 자리만 여기(`ChatModelPopover` 와 같은 층 · 같은 폭) */
  .fm {
    position: fixed;
    z-index: 41;
    box-sizing: border-box;
    width: min(288px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-2);
    overflow: hidden;
  }

  .label {
    flex: none;
    padding: 2px var(--space-3) 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .models {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
  }

  .fm.touch .row {
    height: 44px;
  }

  /* 맨 아래 안내 — 작은 회색 한 줄 */
  .note {
    margin: 0;
    padding: 0 var(--space-3) 2px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .row-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .check {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    color: var(--control-sel-fg);
  }

  .row[aria-checked="true"] {
    font-weight: var(--fw-semibold);
  }
</style>
