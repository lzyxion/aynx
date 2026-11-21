<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { writeClipboard } from "$lib/clipboard";

  /** 사용자가 그 자리에서 칠 명령 몇 줄 + 복사 단추. 실패 알림은 `copy` 를 준 호출부의 몫이다 */
  let {
    lines,
    label,
    copy = () => writeClipboard(lines.join("\n")),
  }: {
    lines: readonly string[];
    label: string;
    copy?: () => Promise<boolean>;
  } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function onCopy(): Promise<void> {
    if (!(await copy())) return;
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 1500);
  }

  $effect(() => () => clearTimeout(timer));
</script>

<div class="command-block">
  <pre class="lines">{lines.join("\n")}</pre>
  <button
    type="button"
    class="copy btn btn-ghost btn-sm"
    class:copied
    title={label}
    aria-label={label}
    data-command-copy
    onclick={() => void onCopy()}
  >
    <UiIcon name={copied ? "check" : "copy"} size={13} />
  </button>
</div>

<style>
  .command-block {
    position: relative;
    width: 100%;
    box-sizing: border-box;
  }

  .lines {
    margin: 0;
    width: 100%;
    box-sizing: border-box;
    overflow-x: auto; /* 줄바꿈으로 명령이 깨지면 복사해도 손으로 쳐도 틀린다 */
    /* 긴 줄이 복사 단추 밑으로 들어가지 않게 */
    padding: var(--space-3) calc(var(--space-3) + 28px) var(--space-3) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.7;
    white-space: pre;
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    user-select: text;
    cursor: text;
  }

  .copy {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    padding: 0;
  }

  .copy.copied {
    color: var(--ok);
  }
</style>
