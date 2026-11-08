<script lang="ts">
  // 원격 창의 거울에서 **함께 볼 수 없는 타일**의 자리(원격 웹 R2-B — `$lib/mirror/tile-policy` 의 `own`). 쿼리 타일처럼 서버 상태(DB 연결 ·
  // 트랜잭션)를 타일 열쇠로 쥔 것은 같은 열쇠로 붙으면 집 PC 의 것을 함께 쥐게 된다 — 대신 [원격에서 따로 열기] 로 이 창에만 제 타일을 세운다
  // (`app/mirror.svelte.ts` 의 `openOwnInstance` — 새 id · 새 `tileKey`).
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { openOwnInstance } from "$lib/app/mirror.svelte.js";
  import type { PaneSpec } from "$lib/session";

  let { pane }: { pane: PaneSpec } = $props();

  const kindName = $derived(pane.kind === "query" ? t("pane.mirror.kind.query") : pane.kind);
  const detail = $derived(pane.kind === "query" ? (pane.query?.name ?? "") : "");
</script>

<div class="mirror-placeholder" data-tile-focus={pane.id}>
  <p class="title">{t("pane.mirror.placeholder.title", { kind: kindName })}</p>
  {#if detail}<p class="detail">{detail}</p>{/if}
  <p class="body">{t("pane.mirror.placeholder.body")}</p>
  <button type="button" class="open" onclick={() => openOwnInstance(pane.id)}>{t("pane.mirror.placeholder.open")}</button>
</div>

<style>
  .mirror-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    padding: 24px;
    box-sizing: border-box;
    text-align: center;
    color: var(--fg-2);
    /* 크롬 타일 몸처럼 면을 깐다 — 월페이퍼 위에서 글자가 묻히지 않게. 글래스면 타일 상자가 흐림 판을 깔므로 비운다(`--tile-inner`) */
    background: var(--tile-inner, var(--surface-raised-solid));
  }
  .title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--fg);
  }
  .detail {
    margin: 0;
    font-size: 12px;
  }
  .body {
    margin: 0;
    max-width: 420px;
    font-size: 12px;
    line-height: 1.5;
  }
  .open {
    margin-top: 4px;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--surface-raised-solid);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .open:hover {
    border-color: var(--accent);
  }
</style>
