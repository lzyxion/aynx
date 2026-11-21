<script lang="ts">
  import { tick } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stemEnd } from "$lib/doc-new";
  import { closeNewDoc, newDocBox, newDocEdit as edit, submitNewDoc } from "$lib/app/new-doc.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";

  /** 문서 타일의 [새 문서…] 이름 상자 — `+page` 에 늘 마운트돼 상태가 있을 때만 그린다. */

  const box = $derived(newDocBox());

  let el = $state<HTMLElement | null>(null);
  let pos = $state<{ left: number; top: number } | null>(null);

  $effect(() => {
    if (box) pos = null;
  });

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

  /** 자리를 잡은 뒤에 포커스한다 — 숨은 상자는 포커스를 받지 않는다 */
  $effect(() => {
    if (pos === null) return;
    void tick().then(() => {
      const input = edit.el;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(0, stemEnd(input.value));
    });
  });

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

  $effect(() => {
    if (box && veilVisible()) closeNewDoc("none");
  });

  /** Esc 는 여기서 끊는다 — 뒤 화면의 Escape 사슬로 새지 않게 */
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
  /* 고르기 상자(`CodeTermPicker`)와 같은 층 */
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

  .row .menu-input {
    flex: 1;
    min-width: 0;
    margin: var(--space-1) 0;
    font-family: var(--font-mono);
  }

  .row .btn {
    flex: none;
  }

  .error {
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--err);
  }
</style>
