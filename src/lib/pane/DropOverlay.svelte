<script lang="ts">
  import type { DropZone } from "$lib/layout";

  /**
   * **드랍 미리보기** — 놓기 전에 무슨 일이 일어날지 그 자리에 그려 보인다.
   *
   * 모양은 두 가지뿐이고, 어느 쪽인지는 판정이 이미 정해 두었다
   * (`drop-rules.ts` 의 `DropPlan.preview`):
   *
   * - `zone` — **절반을 덮는다.** 그 절반이 새 타일(또는 끌린 탭)이 들어설 자리다.
   * - `all` — **상자 전체를 덮는다.** 나눌 절반이 없는 조작이다: 파일 업로드·경로 붙여넣기,
   *   그리고 시작 타일 위의 드롭(4분면과 무관하게 그 타일이 **교체**된다).
   *
   * `label` 이 있으면 가운데에 한 줄 적는다 — 같은 상자 전체 오버레이라도 업로드인지
   * 붙여넣기인지, 어느 폴더로 가는지가 커서만으로는 읽히지 않기 때문이다. 4분면
   * 미리보기에는 글자가 없다: 그쪽은 덮인 절반 자체가 이미 답이다.
   */
  let {
    preview,
    /** `preview: "zone"` 일 때만 읽힌다 — 상자 전체를 덮는 쪽에는 나눌 절반이 없다 */
    zone = "right",
    label = null,
  }: {
    preview: "zone" | "all";
    zone?: DropZone;
    label?: string | null;
  } = $props();
</script>

<div class="drop {preview === 'all' ? 'all' : zone}" aria-hidden="true">
  {#if label}<span class="drop-label">{label}</span>{/if}
</div>

<style>
  /*
   * `pointer-events: none` 이 필수다: 이 오버레이가 커서를 먹으면 자기 위에서 dragover 가
   * 끊겨 하이라이트가 깜빡인다.
   */
  .drop {
    position: absolute;
    z-index: 4;
    box-sizing: border-box;
    pointer-events: none;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    opacity: 0.75;
  }

  .drop.left {
    top: 0;
    left: 0;
    width: 50%;
    height: 100%;
  }

  .drop.right {
    top: 0;
    right: 0;
    width: 50%;
    height: 100%;
  }

  .drop.top {
    top: 0;
    left: 0;
    width: 100%;
    height: 50%;
  }

  .drop.bottom {
    bottom: 0;
    left: 0;
    width: 100%;
    height: 50%;
  }

  /* 상자 전체 — 분할이 아니므로 4분면 미리보기와 모양이 달라야 한다 */
  .drop.all {
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .drop-label {
    padding: 4px 10px;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--fg);
    background: var(--bg-panel);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
  }
</style>
