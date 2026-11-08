<script lang="ts">
  // **훅 설치 확인의 본문**(`ConfirmDialog` 가 `req.hooks` 일 때 그린다) — 쓸 것 두 줄(스크립트 · 설정 "hooks")을 카드 하나에 번호로,
  // 더할 JSON 은 기본 접힘. 펼쳐도 칸은 고정 높이라 안에서만 스크롤한다(미리 보기가 백 줄을 넘어도 상자가 창만큼 늘지 않게).
  // 이벤트 칩은 미리 보기 JSON 의 `hooks` 키(`hookEventNames` — 못 읽으면 칩 줄을 빼고 개수 없는 문구). 상자의 키 · 포커스 ·
  // 닫기는 `ConfirmDialog` 몫이고 여기는 그리기와 [복사] 뿐이다.
  import UiIcon from "$lib/UiIcon.svelte";
  import { writeClipboard } from "$lib/clipboard";
  import { hookEventNames } from "$lib/app/hook-preview";
  import type { HookInstallDetail } from "$lib/app/confirm-dialog.svelte.js";
  import { toast } from "$lib/toast.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let { hooks }: { hooks: HookInstallDetail } = $props();

  const events = $derived(hookEventNames(hooks.preview));
  let open = $state(false);
  /** 복사 결과 — 1.5초 동안 단추 이름이 이것을 따른다(`CodeView` 와 같은 꼴) */
  let copied = $state<"ok" | "fail" | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(copyTimer));

  async function onCopy(): Promise<void> {
    const ok = await writeClipboard(hooks.preview);
    copied = ok ? "ok" : "fail";
    if (!ok) toast.error(t("settings.ai.hooks.confirm.copyfail"));
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = null), 1500);
  }
</script>

<ol class="card">
  <li>
    <span class="num" aria-hidden="true">1</span>
    <div class="what">
      <div class="label">{t("settings.ai.hooks.confirm.script")}</div>
      <div class="path" title={hooks.scriptPath}>{hooks.scriptPath}</div>
    </div>
  </li>
  <li>
    <span class="num" aria-hidden="true">2</span>
    <div class="what">
      <div class="label">
        {events
          ? t("settings.ai.hooks.confirm.settings", { n: events.length })
          : t("settings.ai.hooks.confirm.settingsAny")}
      </div>
      <div class="path" title={hooks.settingsPath}>{hooks.settingsPath}</div>
      {#if events && events.length > 0}
        <ul class="chips">
          {#each events as ev (ev)}<li>{ev}</li>{/each}
        </ul>
      {/if}
    </div>
  </li>
</ol>

<div class="json-bar">
  <button
    type="button"
    class="btn btn-ghost btn-sm"
    aria-expanded={open}
    aria-controls="hook-install-json"
    onclick={() => (open = !open)}
  >
    <UiIcon name={open ? "chevron-down" : "chevron"} size={14} />
    {open ? t("settings.ai.hooks.confirm.json.hide") : t("settings.ai.hooks.confirm.json.show")}
  </button>
  {#if open}
    <button type="button" class="btn btn-ghost btn-sm" onclick={() => void onCopy()}>
      <UiIcon name={copied === "ok" ? "check" : "copy"} size={14} />
      {copied === "ok"
        ? t("settings.ai.hooks.confirm.copied")
        : copied === "fail"
          ? t("settings.ai.hooks.confirm.copyfail")
          : t("settings.ai.hooks.confirm.copy")}
    </button>
  {/if}
</div>
{#if open}
  <pre class="json" id="hook-install-json" tabindex="-1">{hooks.preview}</pre>
{/if}

<style>
  .card {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }
  .card > li {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .card > li + li {
    border-top: 1px solid var(--line);
  }
  .num {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--bg-chip);
    color: var(--fg-chip);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
  }
  .what {
    flex: 1;
    min-width: 0;
  }
  .label {
    font-size: var(--t-sm);
    line-height: 20px;
  }
  .path {
    margin-top: var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chips {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: var(--space-2) 0 0;
    padding: 0;
  }
  .chips li {
    padding: 1px var(--space-2);
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--fg-chip);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
  }
  .json-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--space-2);
  }
  .json {
    height: 200px;
    margin: var(--space-1) 0 0;
    padding: var(--space-2) var(--space-3);
    overflow: auto;
    box-sizing: border-box;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-field-solid);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.5;
    white-space: pre;
    color: var(--fg-1);
  }

  /* 폰 · 태블릿(원격 웹 R5) — 손가락으로 누를 단추는 44px 높이 */
  @media (pointer: coarse) {
    .json-bar button {
      min-height: 44px;
    }
  }
</style>
