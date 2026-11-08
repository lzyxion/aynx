<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { toast } from "$lib/toast.svelte.js";

  /**
   * 켠 동안 위험을 알리는 **경고 칩** — 토글 왼쪽에 서서 줄 높이를 늘리지 않는다(메신저 싣기 · 실행 출력 발췌).
   * 글자만 봐도 무슨 위험인지 읽히게 짧게 적고, 전체 문구는 앱 툴팁(`title`)으로 보인다. 호버가 없는 폰에서도 닿도록 누르면 같은 글을 토스트로 띄운다.
   * 고칠 곳이 따로 있으면 `onclick` 을 넘긴다 — 토스트 대신 그 동작을 한다(원격 접속의 마스터 암호 → 설정 › 보안).
   */
  let { label, detail, onclick, ...rest }: { label: string; detail: string; onclick?: () => void } & Record<`data-${string}`, unknown> = $props();
</script>

<button type="button" class="warn-chip" class:action={!!onclick} title={detail} data-tip-place="above" aria-label={`${label}: ${detail}`} {...rest}
  onclick={() => (onclick ? onclick() : toast.info(detail, { ms: 8000 }))}>
  <UiIcon name="warning" size={12} /><span>{label}</span>
</button>

<style>
  .warn-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 3px 9px 3px 7px;
    border: 0;
    border-radius: 999px;
    font-size: var(--t-xs);
    line-height: 1.3;
    white-space: nowrap;
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
    cursor: help;
  }

  .warn-chip.action {
    cursor: pointer;
  }
</style>
