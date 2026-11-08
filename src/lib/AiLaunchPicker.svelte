<script lang="ts">
  import { tick } from "svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { aiIconName } from "$lib/pane-icons";
  import { aiAvatarSrc } from "$lib/avatars.svelte.js";
  import { comboFromEvent, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import { carouselOffset, digitRowIndex } from "$lib/ai-launch-pick";
  import { aiLaunchPicker, closeAiLaunchPicker, runAiLaunch } from "$lib/app/ai-launch.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";

  /**
   * **AI CLI 고르기** — `Ctrl+Shift+A`(키바인딩 `ai-panel`) · 팔레트의 같은 줄. 상태는 `app/ai-launch.svelte.ts`,
   * 줄 짓기 · 돌림판 자리 셈은 순수 `$lib/ai-launch-pick`.
   *
   * - 모양(2026-11-02 사용자 B2안 — 목업 PdNG5zHJL7M48VSJhrrcHN): **판 없이** 창 가운데에 판 · 뒤 효과 없이 캐릭터만 띄운
   *   (어두운 막 · 빛 무리 · 작은 유리 판은 사용자가 걷었다)
   *   **돌림판** — 고른 하나가 가운데 크게(이름 아래), 양옆은 작고 흐리게. 아래 점 줄이 몇 번째인지 알린다.
   * - 움직임: 고르기가 바뀌면 캐릭터가 옆으로 미끄러지며 크기 · 흐림이 바뀌고, 가운데에 선 캐릭터는 살짝 튀고 이름이 올라온다.
   *   끝에서 처음으로 넘어가는(둘러 가는) 캐릭터는 화면을 가로지르지 않게 미끄럼 없이 자리를 옮긴다. 열 때 캐릭터가
   *   아래에서 차례로 떠오른다. 움직임 줄이기면 전부 끈다.
   * - 키: 숫자 1~9 = 그 줄을 곧바로 연다 · ←→(↑↓ 도) · Home/End · 휠로 돌리고 Enter · 떠 있는 동안 같은 `ai-panel` 조합 = 골라진 줄.
   *   **Esc 는 여기서 끊는다**(뒤 화면의 Escape 사슬로 새지 않게) — 닫고 포커스를 열기 전 자리로 돌려준다.
   * - 마우스: 옆 캐릭터를 누르면 그쪽으로 돌리고, 가운데를 누르면 연다. 캐릭터 묶음 밖을 누르면 닫는다.
   * - 줄을 고르면 메뉴 통로(`runOnMenu`)로 **값을 스냅샷하고 닫은 뒤** 연다(docs/conventions.md). 가림막이 내려와도 닫는다.
   */

  const picker = $derived(aiLaunchPicker());

  let el = $state<HTMLElement | null>(null);
  let sel = $state(0);
  /** 바로 앞 자리(줄마다 가운데에서 몇 칸) — 한 번에 두 칸 넘게 뛴 줄은 미끄럼 없이 옮긴다(둘러 가기) */
  let prevOffsets: number[] = [];

  /** 상자가 새로 뜨면 골라진 줄을 처음부터 */
  $effect(() => {
    const p = picker;
    if (!p) return;
    sel = p.selected;
    prevOffsets = [];
  });

  /** 뜨면 포커스 — 키를 받으려고 */
  $effect(() => {
    const node = el;
    if (!node) return;
    void tick().then(() => node.focus({ preventScroll: true }));
  });

  /** 가림막이 내려오면 닫는다 */
  $effect(() => {
    if (picker && veilVisible()) closeAiLaunchPicker(false);
  });

  const slots = $derived.by(() => {
    const p = picker;
    if (!p) return [];
    const n = p.rows.length;
    const out = p.rows.map((row, i) => {
      const d = carouselOffset(i, sel, n);
      const prev = prevOffsets[i];
      return { row, i, d, jump: prev !== undefined && Math.abs(prev - d) > 1 };
    });
    prevOffsets = out.map((s) => s.d);
    return out;
  });

  /** 줄 하나를 고른다 — 스냅샷 → 닫기 → 실행 */
  function choose(i: number): void {
    runOnMenu(
      () => {
        const p = aiLaunchPicker();
        const row = p?.rows[i];
        return p && row ? { cli: row.cli, here: p.here } : null;
      },
      () => closeAiLaunchPicker(false),
      runAiLaunch,
    );
  }

  function step(by: number): void {
    const n = picker?.rows.length ?? 0;
    if (n > 0) sel = (sel + by + n) % n;
  }

  function onKey(ev: KeyboardEvent): void {
    const p = picker;
    if (!p) return;
    const n = p.rows.length;
    const stop = () => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    if (ev.key === "Escape") {
      stop();
      closeAiLaunchPicker(true);
      return;
    }
    if (ev.key === "Enter") {
      stop();
      choose(sel);
      return;
    }
    if (ev.key === "Tab") {
      ev.preventDefault(); // 포커스가 상자 밖으로 새지 않게 — 고르는 것은 화살표다
      return;
    }
    // 같은 키 두 번 = 골라진 줄(처음엔 지난번에 연 CLI)
    const combo = comboFromEvent(ev);
    if (combo !== null && combo === effectiveCombo("ai-panel", settings.keybindings)) {
      stop();
      choose(sel);
      return;
    }
    if (!ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      const d = digitRowIndex(ev.code, n);
      if (d !== null) {
        stop();
        choose(d);
        return;
      }
    }
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
      stop();
      step(1);
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
      stop();
      step(-1);
    } else if (ev.key === "Home") {
      stop();
      sel = 0;
    } else if (ev.key === "End") {
      stop();
      sel = n - 1;
    }
  }

  /** 휠 한 번 = 한 칸 — 트랙패드의 잔 사건은 모아서 */
  let wheelAcc = 0;
  function onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    wheelAcc += Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    if (Math.abs(wheelAcc) < 40) return;
    step(wheelAcc > 0 ? 1 : -1);
    wheelAcc = 0;
  }

  /** 캐릭터 묶음 밖을 누르면 닫는다 */
  function onDown(ev: PointerEvent): void {
    const target = ev.target;
    if (target instanceof Element && target.closest("[data-ai-launch-card]")) return;
    closeAiLaunchPicker(true);
  }

  function onPick(i: number): void {
    if (i === sel) choose(i);
    else sel = i;
  }
</script>

{#if picker}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="ailaunch"
    role="listbox"
    aria-label={t("app.ai.launch.aria")}
    aria-activedescendant="ailaunch-row-{sel}"
    tabindex="-1"
    data-ai-launch-picker
    bind:this={el}
    onkeydown={onKey}
    onwheel={onWheel}
    onpointerdown={onDown}
  >
    <div class="card" data-ai-launch-card>
    <div class="stage">
      {#each slots as s (s.row.cli.id)}
        {@const ai = aiIconName(s.row.cli.id)}
        {@const avatar = ai ? aiAvatarSrc(ai, true) : null}
        {@const far = Math.abs(s.d)}
        <button
          type="button"
          id="ailaunch-row-{s.i}"
          class="opt"
          class:sel={s.d === 0}
          class:jump={s.jump}
          class:missing={!s.row.installed}
          role="option"
          aria-selected={s.d === 0}
          tabindex="-1"
          data-ai-launch-row={s.row.cli.id}
          style:--d={s.d}
          style:--scale={far === 0 ? 1 : far === 1 ? 0.55 : 0.35}
          style:--op={far === 0 ? 1 : far === 1 ? 0.5 : 0}
          style:--z={10 - far}
          style:--i={s.i}
          style:pointer-events={far > 1 ? "none" : null}
          onclick={() => onPick(s.i)}
        >
          <span class="face" class:logo={!avatar}>
            {#if ai}<AiGlyph name={ai} size={avatar ? 116 : 64} />{/if}
          </span>
        </button>
      {/each}
    </div>

    {#key sel}
      {@const row = picker.rows[sel]}
      <div class="caption" aria-hidden="true">
        <b>{row?.cli.name ?? ""}</b>
        {#if row && !row.installed}<span class="meta" data-not-installed>{t("app.ai.launch.notInstalled")}</span>{/if}
      </div>
    {/key}

    <div class="dots" aria-hidden="true">
      {#each picker.rows as row, i (row.cli.id)}<span class:on={i === sel}></span>{/each}
    </div>

    </div>
  </div>
{/if}

<style>
  /* 자리 — 창 전체를 받는 투명한 층(바깥 누르기 · 휠을 받으려고 — 화면은 덮지 않는다). 그 가운데에 **판도 뒤 효과도 없이**
     캐릭터 · 이름 · 점 줄만 띄운다(키 안내도 뺐다)(2026-11-02 사용자 — 어두운 막 · 빛 무리 · 작은 유리 판을 차례로 걷었다).
     층은 블록 넘기기 상자 · 셸 메뉴와 같은 121. */
  .ailaunch {
    --ease: cubic-bezier(0.2, 0, 0, 1);
    --spring: cubic-bezier(0.34, 1.4, 0.64, 1);
    position: fixed;
    inset: 0;
    z-index: 121;
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--fg-1);
    font-family: var(--font-ui);
    outline: none;
  }
  /* 묶음 — 모양 없음(누른 자리가 안인지 가리는 경계일 뿐) */
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    width: min(440px, calc(100vw - 16px));
    overflow: hidden;
    animation: ailaunch-in 160ms var(--ease);
  }
  @keyframes ailaunch-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  /* 돌림판 — 캐릭터는 모두 가운데에 겹쳐 두고 `--d`(가운데에서 몇 칸)만큼 옆으로 민다 */
  .stage {
    position: relative;
    width: 100%;
    height: 136px;
  }
  .opt {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 124px;
    height: 124px;
    margin: -62px 0 0 -62px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    cursor: pointer;
    z-index: var(--z);
    opacity: var(--op);
    transform: translateX(calc(var(--d) * 128px)) scale(var(--scale));
    filter: saturate(0.5) brightness(0.85);
    transition:
      transform 360ms var(--ease),
      opacity 280ms var(--ease),
      filter 280ms var(--ease);
  }
  .opt.sel {
    filter: none;
  }
  /* 둘러 가는 줄 — 반대편으로 순간 이동(가로지르는 미끄럼 없이) */
  .opt.jump {
    transition: none;
  }
  /* 반대편에 새로 선 캐릭터는 그 자리에서 떠오른다 */
  .opt.jump .face {
    animation: ailaunch-swap 260ms var(--ease);
  }
  @keyframes ailaunch-swap {
    from {
      opacity: 0;
      scale: 0.8;
    }
  }
  .opt:focus-visible {
    outline: none;
  }

  .face {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    overflow: hidden;
    transition: box-shadow 280ms var(--ease);
  }
  /* 아바타가 없으면 로고를 동그란 판 위에 */
  .face.logo {
    background: var(--control-tile-bg);
  }
  .opt.sel .face {
    box-shadow:
      0 0 0 3px var(--bg-base),
      0 0 0 5px var(--accent),
      0 8px 28px color-mix(in srgb, var(--accent) 35%, transparent);
    animation: ailaunch-pop 420ms var(--spring);
  }
  @keyframes ailaunch-pop {
    0% {
      transform: scale(0.92);
    }
    100% {
      transform: scale(1);
    }
  }
  .opt.missing .face {
    opacity: 0.5;
  }

  /* 열 때 — 캐릭터가 아래에서 차례로 떠오른다(자리 transform 과 겹치지 않게 안쪽 .face 에) */
  .opt .face {
    animation: ailaunch-rise 420ms var(--ease) backwards;
    animation-delay: calc(var(--i) * 40ms);
  }
  .opt.sel .face {
    animation:
      ailaunch-rise 420ms var(--ease) backwards,
      ailaunch-pop 420ms var(--spring);
  }
  @keyframes ailaunch-rise {
    from {
      opacity: 0;
      translate: 0 14px;
    }
  }

  /* 이름 — 고르기가 바뀔 때마다 아래에서 올라온다({#key sel}) */
  .caption {
    display: grid;
    justify-items: center;
    gap: 2px;
    min-height: 44px;
    animation: ailaunch-caption 260ms var(--ease);
  }
  .caption b {
    font-size: 17px;
    font-weight: 700;
  }
  .meta {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }
  @keyframes ailaunch-caption {
    from {
      opacity: 0;
      translate: 0 8px;
    }
  }

  .dots {
    display: flex;
    gap: 6px;
  }
  .dots span {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--fg-1) 22%, transparent);
    transition:
      width 260ms var(--ease),
      background 260ms var(--ease);
  }
  .dots span.on {
    width: 18px;
    background: var(--accent);
  }


  @media (prefers-reduced-motion: reduce) {
    .card {
      animation: none;
    }
    .opt,
    .face,
    .dots span {
      transition: none;
    }
    .opt .face,
    .opt.sel .face,
    .opt.jump .face,
    .caption {
      animation: none;
    }
  }
</style>
