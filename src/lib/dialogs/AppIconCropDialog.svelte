<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { AVATAR_NAME_MAX, appIconCrop, closeAppIconCrop, submitAppIconCrop } from "$lib/app/app-icons.svelte.js";
  import {
    PREVIEW_CLIP,
    cropOnStage,
    fitStage,
    initialCrop,
    moveCrop,
    previewBackground,
    resizeCrop,
    zoomCrop,
    type Corner,
    type Crop,
  } from "$lib/app-icon-crop";

  const STAGE = 320;
  const CIRCLE = "circle(50% at 50% 50%)";
  const PREVIEWS = [
    { size: 64, clip: CIRCLE, label: "settings.avatars.crop.previewAvatar" },
    { size: 20, clip: CIRCLE, label: "settings.avatars.crop.previewTab" },
    { size: 48, clip: PREVIEW_CLIP, label: "settings.avatars.crop.previewApp" },
  ] as const;
  const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

  let modalEl = $state<HTMLElement | null>(null);
  let stageEl = $state<HTMLElement | null>(null);
  let imgEl = $state<HTMLImageElement | null>(null);
  let crop = $state<Crop>({ x: 0, y: 0, size: 1 });

  const w = $derived(appIconCrop.width);
  const h = $derived(appIconCrop.height);
  const stage = $derived(fitStage(w || 1, h || 1, STAGE));
  const box = $derived(cropOnStage(crop, stage));

  $effect(() => {
    if (!appIconCrop.open || !appIconCrop.url) return;
    crop = initialCrop(appIconCrop.width, appIconCrop.height);
    queueMicrotask(() => stageEl?.focus());
  });

  // 속성 이벤트는 passive 로 붙을 수 있어 preventDefault 가 먹게 직접 붙인다.
  $effect(() => {
    const el = stageEl;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      crop = zoomCrop(crop, Math.exp(ev.deltaY * 0.0015), w, h);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  /** 움직임은 늘 시작 영역에서 다시 계산한다(누적 오차 없음) */
  let drag: { mode: "move" | Corner; px: number; py: number; start: Crop } | null = null;

  function begin(ev: PointerEvent, mode: "move" | Corner): void {
    if (ev.button !== 0 || appIconCrop.busy) return;
    ev.preventDefault();
    ev.stopPropagation();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    drag = { mode, px: ev.clientX, py: ev.clientY, start: crop };
  }

  function onMove(ev: PointerEvent): void {
    if (!drag) return;
    const dx = (ev.clientX - drag.px) / stage.scale;
    const dy = (ev.clientY - drag.py) / stage.scale;
    crop =
      drag.mode === "move" ? moveCrop(drag.start, dx, dy, w, h) : resizeCrop(drag.start, drag.mode, dx, dy, w, h);
  }

  function end(): void {
    drag = null;
  }

  function onStageKey(ev: KeyboardEvent): void {
    const step = (ev.shiftKey ? 10 : 1) * Math.max(1, crop.size / 100);
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const mv = moves[ev.code];
    if (mv) {
      ev.preventDefault();
      crop = moveCrop(crop, mv[0], mv[1], w, h);
      return;
    }
    if (ev.code === "Equal" || ev.code === "NumpadAdd" || ev.code === "Minus" || ev.code === "NumpadSubtract") {
      ev.preventDefault();
      crop = zoomCrop(crop, ev.code === "Minus" || ev.code === "NumpadSubtract" ? 1.1 : 1 / 1.1, w, h);
    }
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (modalEl && trapTab(ev, modalEl)) return;
    ev.stopPropagation();
    if (ev.code === "Escape") {
      ev.preventDefault();
      closeAppIconCrop();
    }
  }

  function submit(): void {
    if (imgEl) void submitAppIconCrop(imgEl, crop);
  }
</script>

{#if appIconCrop.open && appIconCrop.url}
  <div
    class="overlay overlay-fade"
    role="presentation"
    onmousedown={(ev) => {
      if (ev.target === ev.currentTarget) closeAppIconCrop();
    }}
  >
    <div
      class="modal glass-raised modal-rise"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-icon-crop-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={onKeydown}
    >
      <div class="glass-scroll">
      <h2 id="app-icon-crop-title">{t(appIconCrop.replace ? "settings.avatars.crop.titleRecrop" : "settings.theme.app_icon.crop.title")}</h2>
      <p class="lead">{t("settings.theme.app_icon.crop.lead")}</p>

      <div class="body">
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          class="stage"
          style:width="{STAGE}px"
          style:height="{STAGE}px"
          role="application"
          aria-label={t("settings.theme.app_icon.crop.stage")}
          tabindex="0"
          bind:this={stageEl}
          onkeydown={onStageKey}
        >
          <img
            bind:this={imgEl}
            src={appIconCrop.url}
            alt=""
            draggable="false"
            style:left="{stage.left}px"
            style:top="{stage.top}px"
            style:width="{w * stage.scale}px"
            style:height="{h * stage.scale}px"
          />
          <div
            class="crop"
            style:left="{box.left}px"
            style:top="{box.top}px"
            style:width="{box.size}px"
            style:height="{box.size}px"
            role="presentation"
            onpointerdown={(ev) => begin(ev, "move")}
            onpointermove={onMove}
            onpointerup={end}
            onpointercancel={end}
          >
            <div class="shape" style:clip-path={PREVIEW_CLIP}></div>
            {#each CORNERS as c (c)}
              <div
                class="handle {c}"
                role="presentation"
                onpointerdown={(ev) => begin(ev, c)}
                onpointermove={onMove}
                onpointerup={end}
                onpointercancel={end}
              ></div>
            {/each}
          </div>
        </div>

        <div class="side">
          <span class="side-label">{t("settings.theme.app_icon.crop.preview")}</span>
          <div class="previews">
            {#each PREVIEWS as p (p.size)}
              {@const bg = previewBackground(crop, w, h, p.size)}
              <div class="preview-cell">
                <div
                  class="preview"
                  style:width="{p.size}px"
                  style:height="{p.size}px"
                  style:background-image="url({appIconCrop.url})"
                  style:background-size={bg.size}
                  style:background-position={bg.position}
                  style:clip-path={p.clip}
                ></div>
                <span class="side-label">{t(p.label)}</span>
              </div>
            {/each}
          </div>
          <span class="dims">{Math.round(crop.size)} × {Math.round(crop.size)}px</span>
          <label class="name-field">
            <span class="side-label">{t("settings.avatars.crop.name")}</span>
            <input
              type="text"
              maxlength={AVATAR_NAME_MAX}
              placeholder={t("settings.avatars.crop.namePlaceholder")}
              bind:value={appIconCrop.name}
              disabled={appIconCrop.busy}
              onkeydown={(ev) => {
                if (ev.code === "Enter" || ev.code === "NumpadEnter") {
                  ev.preventDefault();
                  submit();
                }
              }}
            />
          </label>
        </div>
      </div>

      <p class="hint">{t("settings.theme.app_icon.crop.hint")}</p>
      {#if appIconCrop.error}
        <p class="wrong" role="alert">{appIconCrop.error}</p>
      {/if}

      <div class="actions">
        <button type="button" class="btn btn-secondary" onclick={closeAppIconCrop} disabled={appIconCrop.busy}>
          {t("settings.theme.app_icon.crop.cancel")}
        </button>
        <button type="button" class="btn btn-primary primary" onclick={submit} disabled={appIconCrop.busy}>
          {t(appIconCrop.replace ? "settings.avatars.crop.okRecrop" : "settings.theme.app_icon.crop.ok")}
        </button>
      </div>
      </div>
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
    background: var(--bg-overlay);
  }

  .modal {
    box-sizing: border-box;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden; /* 스크롤은 안쪽 `.glass-scroll` — 흐림 층이 밑동까지 덮게 */
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
  }

  .glass-scroll {
    padding: var(--space-4);
  }

  .modal h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .lead {
    margin: 0 0 var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
  }

  .body {
    display: flex;
    gap: var(--space-4);
    align-items: flex-start;
  }

  .stage {
    position: relative;
    flex: 0 0 auto;
    overflow: hidden;
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    touch-action: none;
    user-select: none;
  }

  .stage:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .stage img {
    position: absolute;
    max-width: none;
    pointer-events: none;
  }

  .crop {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--accent);
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.55);
    cursor: move;
  }

  .shape {
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.7);
    background: rgb(255 255 255 / 0.04);
  }

  .handle {
    position: absolute;
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    background: var(--accent);
    border: 2px solid var(--on-accent);
    border-radius: 50%;
  }

  .handle.nw {
    left: -6px;
    top: -6px;
    cursor: nwse-resize;
  }

  .handle.ne {
    right: -6px;
    top: -6px;
    cursor: nesw-resize;
  }

  .handle.sw {
    left: -6px;
    bottom: -6px;
    cursor: nesw-resize;
  }

  .handle.se {
    right: -6px;
    bottom: -6px;
    cursor: nwse-resize;
  }

  .side {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 180px;
  }

  .previews {
    display: flex;
    align-items: flex-end;
    gap: var(--space-3);
  }

  .preview-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }

  .name-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    margin-top: var(--space-2);
  }

  .name-field input {
    box-sizing: border-box;
    width: 100%;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font: inherit;
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    box-shadow: var(--glass-ctl-edge, none);
    outline: none;
  }

  .name-field input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .name-field input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .side-label,
  .dims {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .preview {
    background-repeat: no-repeat;
  }

  .hint {
    margin: var(--space-3) 0 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-3);
  }

  .wrong {
    margin: var(--space-2) 0 0;
    font-size: var(--t-sm);
    color: var(--err);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
</style>
