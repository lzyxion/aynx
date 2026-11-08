<script lang="ts">
  // **수락 전 검증 칸 묶음** — [새 앨범] 3절이 쓴다(목업 V3NewAlbum: 모노 입력 알약 + 오른쪽 실행 방식 세그먼트). 명령이 있으면 아래에
  // 시한 · 고급 칸 셋(보존 폴더 · 캐시 키 · 추가 환경 변수 — 접지 않고 늘 보인다) · 경고 한 줄이 붙는다. **실행 방식 칸**은 부르는 쪽의 `mode` 조각으로 받는다.
  // 검증 문자열은 사람만 정한다(MCP 로 못 바꾼다). 제목은 부르는 쪽 카드가 단다.
  //
  // `tag` 는 `data-<tag>-verify-*` 이름표의 머리다.
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { VERIFY_COMMAND_MAX, VERIFY_TIMEOUT_DEFAULT, VERIFY_TIMEOUT_MAX } from "$lib/orchestration/model";

  let {
    tag,
    inputId,
    command = $bindable(),
    timeout = $bindable(),
    keepDirs = $bindable(),
    cacheKeyFiles = $bindable(),
    extraEnv = $bindable(),
    unsupported = false,
    commandError = null,
    timeoutError = null,
    mode,
  }: {
    tag: string;
    inputId: string;
    command: string;
    timeout: string | number | null;
    keepDirs: string;
    cacheKeyFiles: string;
    extraEnv: string;
    /** 이 OS 에서 검증을 돌릴 수 없다(서버의 비Windows 스텁) — 칸을 끈다 */
    unsupported?: boolean;
    commandError?: string | null;
    timeoutError?: string | null;
    /** 명령 칸 오른쪽에 그리는 실행 방식 칸 */
    mode?: Snippet;
  } = $props();

  const attr = (name: string) => ({ [`data-${tag}-verify${name ? `-${name}` : ""}`]: "" });
</script>

<div class="verify" {...attr("")}>
  {#if unsupported}
    <p class="sub" {...attr("unsupported")}>{t("orch.field.verify.unsupported")}</p>
  {:else}
    <div class="row">
      <label class="cmd-wrap"><span class="sr-only">{t("orch.field.verify")}</span><input
        id={inputId}
        class="cmd"
        title={t("orch.field.verify.title")}
        placeholder={t("orch.field.verify.placeholder")}
        maxlength={VERIFY_COMMAND_MAX}
        autocomplete="off"
        spellcheck="false"
        {...attr("command")}
        bind:value={command}
      /></label>
      {@render mode?.()}
    </div>
    {#if commandError}<p class="field-err" role="alert">{commandError}</p>{/if}
    {#if command.trim() !== ""}
      <div class="more">
        <label class="timeout">
          <span>{t("orch.field.verify.timeout")}</span>
          <input
            type="number"
            min="1"
            max={VERIFY_TIMEOUT_MAX}
            step="1"
            inputmode="numeric"
            placeholder={String(VERIFY_TIMEOUT_DEFAULT)}
            {...attr("timeout")}
            bind:value={timeout}
          />
        </label>
        <!-- 고급 칸 셋 — 접지 않는다(목업 V3FoldA): 명령이 있으면 시한 옆에 작은 칸 셋이 늘 보인다 -->
        <div class="adv" {...attr("advanced")}>
          <label class="adv-row">
            <span>{t("orch.field.verify.keepDirs")}</span>
            <input class="mono" autocomplete="off" spellcheck="false" {...attr("keep")} bind:value={keepDirs} />
          </label>
          <label class="adv-row">
            <span>{t("orch.field.verify.cacheKeys")}</span>
            <input class="mono" autocomplete="off" spellcheck="false" {...attr("cache")} bind:value={cacheKeyFiles} />
          </label>
          <label class="adv-row">
            <span>{t("orch.field.verify.extraEnv")}</span>
            <input class="mono" autocomplete="off" spellcheck="false" {...attr("env")} bind:value={extraEnv} />
          </label>
        </div>
      </div>
      {#if timeoutError}<p class="field-err" role="alert">{timeoutError}</p>{/if}
      <p class="sub" {...attr("warn")}>{t("orch.field.verify.warn")}</p>
    {/if}
  {/if}
</div>

<style>
  .verify { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
  .cmd-wrap { flex: 1 1 220px; min-width: 0; display: flex; }
  input {
    box-sizing: border-box;
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid var(--line-strong);
    outline: none;
  }
  .cmd { flex: 1; min-width: 0; height: var(--field-height); padding: 0 var(--space-3); background: var(--field-bg); border: 1px solid transparent; border-radius: var(--field-radius); box-shadow: var(--glass-ctl-edge, none); font-family: var(--font-mono); }
  .cmd:hover:not(:disabled, :focus) { background: var(--control-bg-hover); }
  .cmd:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .mono { font-family: var(--font-mono); }
  .more { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 6px 16px; font-size: var(--t-xs); color: var(--fg-2); }
  .timeout { display: inline-flex; align-items: center; gap: 8px; }
  .timeout input { width: 64px; height: 26px; padding: 0 10px; border-radius: 999px; text-align: center; font-size: var(--t-xs); }
  .timeout input:focus { border-color: var(--focus-border); }
  .adv { flex: 1 1 100%; min-width: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px 12px; }
  .adv-row { display: grid; gap: 4px; min-width: 0; font-size: var(--t-xs); color: var(--fg-2); }
  .adv-row input { width: 100%; height: var(--field-height); padding: 0 var(--space-3); background: var(--field-bg); border: 1px solid transparent; border-radius: var(--field-radius); box-shadow: var(--glass-ctl-edge, none); font-size: var(--t-xs); }
  .adv-row input:hover:not(:disabled, :focus) { background: var(--control-bg-hover); }
  .adv-row input:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .sub { margin: 0; font-size: var(--t-xs); line-height: 1.5; color: var(--fg-3); }
  .field-err { margin: 0; font-size: var(--t-xs); color: var(--err); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
