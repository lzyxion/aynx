<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { chipLabel, chipOf, megabytes } from "$lib/updater";
  import { openUpdateCard, updateView } from "$lib/app/updater.svelte.js";

  // 상태는 `app/updater` 의 사본이고 주 창에서만 찬다 — 보조 창 · 원격 창에는 칩이 없다.
  let { vertical = false }: { vertical?: boolean } = $props();

  /** 세로 20px 칩 안에서는 13px — 15px 면 테두리에 닿는다 */
  const ICON_SIZE = $derived(vertical ? 13 : 15);
  const R = 6;
  const C = 2 * Math.PI * R;

  const view = $derived(updateView());
  const chip = $derived(chipOf(view));

  const tip = $derived.by(() => {
    const v = view;
    switch (chip.kind) {
      case "available":
        return t("app.update.chip.available.tip", { version: chip.version });
      case "downloading":
        return v && v.total !== null
          ? t("app.update.chip.downloading.tip", { version: chip.version, received: megabytes(v.received), total: megabytes(v.total) })
          : t("app.update.chip.downloading.tip.unknown", { version: chip.version, received: megabytes(v?.received ?? 0) });
      case "ready":
        return t("app.update.chip.ready.tip", { version: chip.version });
      case "installing":
        return t("app.update.chip.installing");
      case "failed":
        return t("app.update.chip.failed.tip", { version: chip.version });
      default:
        return "";
    }
  });
</script>

{#if chip.kind !== "none"}
  <button
    type="button"
    class="uchip"
    class:vertical
    data-update-chip={chip.kind}
    data-tone={chip.kind === "ready" ? "filled" : chip.kind === "failed" ? "bad" : chip.kind === "available" || chip.kind === "downloading" ? "accent" : "plain"}
    title={tip}
    aria-label={tip}
    aria-haspopup="dialog"
    disabled={chip.kind === "installing"}
    onclick={() => openUpdateCard()}
  >
    {#if chip.kind === "downloading"}
      <svg class="ring" viewBox="0 0 16 16" width={ICON_SIZE} height={ICON_SIZE} aria-hidden="true">
        <circle class="track" cx="8" cy="8" r={R} />
        <circle
          class="fill"
          cx="8"
          cy="8"
          r={R}
          stroke-dasharray={C}
          stroke-dashoffset={C * (1 - (chip.pct ?? 0) / 100)}
          class:spin={chip.pct === null}
        />
      </svg>
      {#if !vertical}<span class="text">{chipLabel(chip)}</span>{/if}
    {:else}
      <UiIcon
        name={chip.kind === "available" ? "up" : chip.kind === "ready" ? "check" : chip.kind === "failed" ? "exclaim" : "refresh"}
        size={ICON_SIZE}
      />
      {#if !vertical}<span class="text">{chipLabel(chip)}</span>{/if}
    {/if}
  </button>
{/if}

<style>
  /* 원격 칩(`RemoteChip`)과 같은 높이 · 고스트 관용구 */
  .uchip {
    position: relative;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: var(--sb-cell-h);
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    white-space: nowrap;
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .uchip:hover {
    background: var(--surface-hover);
  }

  .uchip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .uchip:disabled {
    cursor: default;
    opacity: 0.7;
  }

  /* 24px 는 꽉 찬 원이 너무 커 보였다 */
  .uchip.vertical {
    width: 20px;
    height: 20px;
    padding: 0;
    justify-content: center;
    align-self: center;
  }

  /* 맨 아이콘이면 옆의 ⚡ · 🔔 와 같아 보여 눈에 띄지 않았다 */
  .uchip[data-tone="accent"] {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .uchip[data-tone="accent"]:hover {
    background: color-mix(in srgb, var(--accent) 24%, transparent);
  }

  /* 받아 둠 — 꽉 채운 원은 너무 무거웠다 */
  .uchip[data-tone="filled"] {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent);
  }

  .uchip[data-tone="filled"]:hover {
    background: color-mix(in srgb, var(--accent) 38%, transparent);
  }

  /* 실패 — 진한 빨강 바탕은 경보처럼 보였다 */
  .uchip[data-tone="bad"] {
    color: color-mix(in srgb, var(--err) 75%, var(--fg-1));
    background: color-mix(in srgb, var(--err) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--err) 35%, transparent);
  }

  .uchip[data-tone="bad"]:hover {
    background: color-mix(in srgb, var(--err) 16%, transparent);
  }

  .ring {
    flex: none;
    transform: rotate(-90deg);
  }

  .ring circle {
    fill: none;
    stroke-width: 2;
  }

  .ring .track {
    stroke: var(--line-strong);
  }

  .ring .fill {
    stroke: currentColor;
    stroke-linecap: round;
    transition: stroke-dashoffset 200ms linear;
  }

  .ring .fill.spin {
    stroke-dashoffset: 28;
    transform-origin: 8px 8px;
    animation: uchip-spin 1s linear infinite;
  }

  @keyframes uchip-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 720px) {
    .uchip:not(.vertical) .text {
      display: none;
    }
    .uchip:not(.vertical) {
      width: 24px;
      padding: 0;
      justify-content: center;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ring .fill {
      transition: none;
    }
    .ring .fill.spin {
      animation: none;
    }
  }
</style>
