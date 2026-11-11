<script lang="ts">
  import { tick } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stemEnd } from "$lib/doc-new";
  import { closeNewDoc, newDocBox, newDocEdit as edit, submitNewDoc } from "$lib/app/new-doc.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";

  /**
   * **문서 타일의 [새 문서…] 이름 상자** (`app/new-doc.svelte.ts`). `+page` 에 늘 마운트돼 그 상태가 있을 때만 그린다.
   *
   * 모양은 파일 타일 메뉴의 인라인 폼(`browser/FileMenu.svelte` 의 새 파일 — 전역 `.menu-surface` · `.menu-title` · `.menu-input` ·
   * `data-inline-edit` · 오류 한 줄)이고, 자리 · 닫힘은 고르기 상자(`CodeTermPicker`)와 같은 결이다 — 메뉴가 서 있던 자리 · 화면 안으로 민다 ·
   * 바깥을 누르거나 가림막이 내려오면 닫는다. 키: Enter = 만들기 · **Esc 는 여기서 끊고**(뒤 화면의 Escape 사슬로 새지 않게) 닫으며 포커스를
   * 그 문서 타일로 돌려준다. 이름 칸은 확장자 앞이 골라진 채 뜬다.
   */

  const box = $derived(newDocBox());

  let el = $state<HTMLElement | null>(null);
  let pos = $state<{ left: number; top: number } | null>(null);

  /** 상자가 새로 뜨면 자리를 처음부터 */
  $effect(() => {
    if (box) pos = null;
  });

  /** 자리 — 기준점에서, 화면 밖이면 안쪽으로 민다 */
  $effect(() => {
    const node = el;
    const b = box;
    if (!node || !b) return;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    pos = {
      left: Math.max(8, Math.min(b.anchor.x, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(b.anchor.y, window.innerHeight - h - 8)),
    };
  });

  /** 자리를 잡은 뒤 이름 칸에 포커스 — 확장자 앞까지 고른다(숨은 상자는 포커스를 받지 않는다) */
  $effect(() => {
    if (pos === null) return;
    void tick().then(() => {
      const input = edit.el;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(0, stemEnd(input.value));
    });
  });

  /** 바깥 누름으로 닫는다 */
  $effect(() => {
    if (!box) return;
    const onDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (target instanceof Node && el?.contains(target)) return;
      closeNewDoc("none");
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  });

  /** 가림막이 내려오면 닫는다 */
  $effect(() => {
    if (box && veilVisible()) closeNewDoc("none");
  });

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeNewDoc("source");
    }
  }
</script>

{#if box}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="new-doc menu-surface"
    role="dialog"
    aria-label={t("files.doc.new.aria")}
    tabindex="-1"
    data-new-doc-box
    bind:this={el}
    style:left="{pos?.left ?? 0}px"
    style:top="{pos?.top ?? 0}px"
    style:visibility={pos ? "visible" : "hidden"}
    onkeydown={onKey}
  >
    <div class="menu-title" title={box.dir}>{t("files.doc.new.title", { dir: box.dirName })}</div>
    <div class="row">
      <input
        class="menu-input"
        data-inline-edit
        bind:value={edit.value}
        bind:this={edit.el}
        aria-label={t("files.doc.new.aria")}
        aria-invalid={edit.error !== null}
        spellcheck="false"
        autocomplete="off"
        disabled={box.busy}
        oninput={() => (edit.error = null)}
        onkeydown={(ev) => {
          if (ev.key === "Enter" && !ev.isComposing) {
            ev.preventDefault();
            void submitNewDoc();
          }
        }}
      />
      <button type="button" class="btn btn-sm btn-primary" disabled={box.busy} onclick={() => void submitNewDoc()}>
        {t("files.doc.new.submit")}
      </button>
    </div>
    {#if edit.error}<div class="error" role="alert">{edit.error}</div>{/if}
  </div>
{/if}

<style>
  /* 상자 — 모양은 전역 메뉴 한 벌(`.menu-surface`) · 고르기 상자(`CodeTermPicker`)와 같은 층(121) */
  .new-doc {
    position: fixed;
    z-index: 121;
    width: min(320px, calc(100vw - 16px));
    box-sizing: border-box;
  }

  .menu-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-1);
  }

  /* 이름 칸은 고정폭 — 확장자 · 점이 또렷하게 */
  .row .menu-input {
    flex: 1;
    min-width: 0;
    margin: var(--space-1) 0;
    font-family: var(--font-mono);
  }

  .row .btn {
    flex: none;
  }

  /* 오류 — 파일 타일 인라인 폼(`FileMenu` 의 `.ctx-error`)과 같은 글 */
  .error {
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--err);
  }
</style>
