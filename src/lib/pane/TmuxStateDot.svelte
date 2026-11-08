<script lang="ts">
  /**
   * tmux 세션 한 개의 **붙음 상태 점** — 목록 팝오버(`TmuxMenu`)와 칩 카드(`TmuxSessionsCard`)가 함께 쓴다.
   *
   * - 붙어 있음(`attached ≥ 1`) = 채운 점, `--ok`(앱의 "살아 있음" 색)
   * - 둘 이상이 붙어 있음 = 점 오른쪽 위에 작은 숫자 — 다른 곳에서도 같은 세션을 보고 있다
   * - 비어 있음(`0`) = 빈 고리, `--fg-3` — 뒤에서 돌기만 하는 세션
   *
   * 글자 설명("붙어 있음 · 클라이언트 2")은 `title` 로만 둔다(2026-10-05 사용자 — 상태는 글자 대신 점).
   */
  let { attached, title = undefined }: { attached: number; title?: string } = $props();
</script>

<span class="tdot-wrap" {title}>
  <span class="tdot" class:on={attached > 0}></span>
  {#if attached > 1}<span class="tdot-n">{attached}</span>{/if}
</span>

<style>
  .tdot-wrap {
    display: inline-flex;
    align-items: flex-start;
    flex: none;
    min-width: 7px;
  }

  .tdot {
    width: 7px;
    height: 7px;
    margin-top: 1px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 1.5px solid var(--fg-3);
  }

  .tdot.on {
    background: var(--ok);
    border-color: var(--ok);
  }

  /* 위첨자 — 점보다 위로 반 칸, 숫자는 같은 초록 */
  .tdot-n {
    margin: -4px 0 0 1px;
    font-size: 9px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--ok);
  }
</style>
