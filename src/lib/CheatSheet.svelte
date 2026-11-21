<script lang="ts">
  /** 바뀔 수 있는 조합은 언제나 [`effectiveCombo`] 로 읽는다 — 화면에 보이는 조합이 실제와 다르면 안 된다 */
  import { workspaceMainWindow } from "$lib/app/workspaces.svelte.js";
  import { chatDockAvailable } from "$lib/app/chat-dock.svelte.js";
  import { isRemote } from "$lib/app/window.svelte.js";
  import { actionLabel, comboFromEvent, effectiveCombo } from "$lib/keybindings";
  import { comboChips, keyChip, mouseChip, nthChip, type Chip } from "$lib/cheatsheet";
  import UiIcon from "$lib/UiIcon.svelte";
  import Keys from "$lib/Keys.svelte";
  import { splitMouseGesture } from "$lib/keycaps";
  import { cubicIn, cubicOut } from "svelte/easing";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";

  let {
    keybindings = {},
    onclose,
    onopensettings,
  }: {
    keybindings?: Record<string, string>;
    onclose: () => void;
    onopensettings?: () => void;
  } = $props();

  interface Row {
    label: string;
    chips: Chip[];
  }

  interface Group {
    title: string;
    rows: Row[];
  }

  /**
   * 글래스에서는 덮개 · 상자의 `opacity` 를 움직이지 않는다 — 1 아래인 동안 그 요소가 배경 뿌리가 되어 흐림이 창 뒤를 못 보고, 끝나는 순간 유리가 툭 켜진다.
   * 그래서 덮개는 배경색, 상자는 판 색 · 선 · 그림자와 안의 내용(`--sheet-fade`)을 페이드한다.
   */
  const IN_MS = 320;
  const OUT_MS = 220;
  const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  function slide(_node: Element, { duration, easing }: { duration: number; easing: (t: number) => number }) {
    const dist = window.innerHeight / 2;
    const glass = document.documentElement.dataset.material === "glass";
    return {
      duration: reduced() ? 0 : duration,
      easing,
      css: (t: number) => {
        const a = Math.min(1, t * 2);
        const move = `transform: translateY(${(1 - t) * dist}px)`;
        if (!glass) return `opacity: ${a}; ${move}`;
        const p = `${(a * 100).toFixed(1)}%`;
        return (
          `${move}; --sheet-fade: ${a.toFixed(3)}; ` +
          `background-color: color-mix(in srgb, var(--glass-raised) ${p}, transparent); ` +
          `border-color: color-mix(in srgb, var(--glass-rim) ${p}, transparent); ` +
          `box-shadow: 0 8px 32px color-mix(in srgb, var(--glass-shadow-color) ${p}, transparent)`
        );
      },
    };
  }
  function veilFade(_node: Element, { duration }: { duration: number }) {
    return {
      duration: reduced() ? 0 : duration,
      css: (t: number) => `background-color: color-mix(in srgb, var(--bg-overlay) ${(t * 100).toFixed(1)}%, transparent)`,
    };
  }

  const eff = (id: string) => effectiveCombo(id, keybindings);

  /** 이름이 긴 줄은 이 화면 전용 `short` 를 쓴다 — 설정 쪽 이름은 줄이지 않는다(그 목록은 문맥 없이 읽히고 검색도 그 글자로 한다) */
  function reg(id: string, short?: Key): Row | null {
    const chips = comboChips([eff(id)]);
    if (!chips) return null;
    if (short) return { label: t(short), chips };
    const name = actionLabel(id);
    return { label: t(name.key, name.params), chips };
  }

  function many(ids: readonly string[], label: Key, merge?: string): Row | null {
    const chips = comboChips(ids.map(eff), merge);
    return chips ? { label: t(label), chips } : null;
  }

  const fixed = (label: Key, chips: Chip[]): Row => ({ label: t(label), chips });
  const k = keyChip;
  const m = (key: Key) => mouseChip(t(key));

  const arrows = (verb: string) => [`${verb}-left`, `${verb}-right`, `${verb}-up`, `${verb}-down`];

  const keep = (rows: (Row | null)[]): Row[] => rows.filter((r): r is Row => r !== null);

  const groups = $derived<Group[]>([
    {
      title: t("commands.cheatsheet.tabs.title"),
      rows: keep([
        reg("new-tab"),
        reg("close-tab"),
        reg("next-tab"),
        reg("prev-tab"),
        (() => {
          const chips = nthChip(eff("workspace-1"));
          return chips ? { label: t("commands.cheatsheet.tabs.nth"), chips } : null;
        })(),
      ]),
    },
    {
      title: t("commands.cheatsheet.tiles.title"),
      rows: keep([
        reg("split"),
        reg("zoom-tile", "commands.cheatsheet.tiles.zoom"),
        reg("flip-convo"),
        reg("close-tile"),
        many(arrows("focus"), "commands.cheatsheet.tiles.focus", ""),
        many(arrows("move"), "commands.cheatsheet.tiles.move", ""),
        many(arrows("expand"), "commands.cheatsheet.tiles.expand", ""),
        reg("toggle-sync", "commands.cheatsheet.tiles.sync"),
      ]),
    },
    {
      title: t("commands.cheatsheet.open.title"),
      rows: keep([
        reg("new-shell", "commands.cheatsheet.open.shell"),
        many(["open-hosts-dock", "open-projects-dock", "open-db-dock"], "commands.cheatsheet.open.dock", "/"),
        ...(chatDockAvailable() ? [reg("open-chat-dock")] : []),
        reg("open-plans"),
        reg("open-sftp", "commands.cheatsheet.open.sftp"),
        reg("open-localfs", "commands.cheatsheet.open.localfs"),
        reg("open-file"),
        reg("ai-panel", "commands.cheatsheet.open.ai"),
      ]),
    },
    {
      title: t("commands.cheatsheet.app.title"),
      rows: keep([
        reg("command-palette"),
        reg("open-settings", "commands.cheatsheet.app.settings"),
        reg("switch-profile"),
        reg("go-to-alert"),
        ...(workspaceMainWindow() ? [reg("switch-workspace"), reg("next-workspace"), reg("prev-workspace")] : []),
        reg("insert-snippet", "commands.cheatsheet.app.snippet"),
        reg("reconnect-all", "commands.cheatsheet.app.reconnect"),
        reg("cheat-sheet"),
        ...(isRemote ? [] : [reg("quit-app")]),
      ]),
    },
    {
      title: t("commands.cheatsheet.terminal.title"),
      rows: [
        // 찾기 둘은 한 줄로 접지 않는다 — 접으면 어느 칩이 어느 찾기인지 읽히지 않는다.
        ...keep([
          many(["jump-prev", "jump-next"], "commands.cheatsheet.terminal.jump"),
          reg("copy-output", "commands.cheatsheet.terminal.copyOutput"),
          ...(isRemote ? [] : [reg("edit-remote")]),
          reg("ask-ai-block"),
          reg("find"),
          reg("find-all"),
        ]),
        fixed("commands.cheatsheet.terminal.eof", [k("Ctrl+D")]),
        fixed("commands.cheatsheet.terminal.reconnect", [k("Enter")]),
        fixed("commands.cheatsheet.terminal.menu", [m("commands.cheatsheet.g.rightClick")]),
        fixed("commands.cheatsheet.terminal.menuSwap", [m("commands.cheatsheet.g.shiftRightClick")]),
      ],
    },
    {
      // 바꿀 수 있는 `files-*` 층만 싣는다 — 탐색기 관습의 고정 키(`browser/file-keys.ts`)는 목록만 길게 한다
      title: t("commands.cheatsheet.files.title"),
      rows: keep([
        many(["files-view-icons", "files-view-compact", "files-view-details"], "commands.cheatsheet.files.views", "/"),
        reg("files-location"),
        reg("files-places"),
        reg("files-filter"),
        reg("files-preview"),
      ]),
    },
    // 마우스 몸짓 묶음은 두지 않는다 — 단축키 표로 좁힌다
  ]);

  /**
   * 떠 있는 동안 키를 `window` 캡처 단계에서 통째로 잡는다 — 이 화면엔 입력칸이 없어 뒤 타일의 창 키 핸들러(`SftpBrowser`)가 비켜나지 않고
   * 덮개 뒤에서 `↑↓` 가 선택을 옮기고 `Delete` 가 삭제 확인을 띄운다. 그래서 Escape 도 여기서 닫는다(`+page` 의 Escape 사슬은 버블 단계다).
   */
  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      onclose();
      return;
    }
    // `ev.code` 로 본다 — 여는 쪽 `keys.svelte.ts` 의 `handleCheatSheetKey` 와 같은 판정이어야 같은 키로 닫힌다
    if (ev.code === "Slash" && ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      ev.preventDefault();
      onclose();
      return;
    }
    const combo = comboFromEvent(ev);
    if (combo && combo === effectiveCombo("cheat-sheet", keybindings)) {
      ev.preventDefault();
      onclose();
    }
  }

  /** 탭 순회가 뒤에 깔린 타일로 새지 않게 */
  let panel = $state<HTMLDivElement | null>(null);
  $effect(() => {
    panel?.focus({ preventScroll: true });
  });

  $effect(() => {
    const onCapture = (ev: KeyboardEvent) => {
      onKeydown(ev);
      ev.stopPropagation();
    };
    window.addEventListener("keydown", onCapture, true);
    return () => window.removeEventListener("keydown", onCapture, true);
  });

  /** 액션으로 붙인다 — 글자 칸(`span`)에 핸들러 속성을 달면 a11y 검사가 역할을 요구한다 */
  function clipTitle(el: HTMLElement) {
    const onEnter = () => {
      if (el.scrollWidth > el.clientWidth) el.title = el.textContent ?? "";
      else el.removeAttribute("title");
    };
    el.addEventListener("pointerenter", onEnter);
    return { destroy: () => el.removeEventListener("pointerenter", onEnter) };
  }
</script>

<div
  class="veil"
  role="presentation"
  in:veilFade={{ duration: IN_MS }}
  out:veilFade={{ duration: OUT_MS }}
  onmousedown={(ev) => {
    if (ev.target === ev.currentTarget) onclose();
  }}
>
  <div
    class="sheet glass-raised"
    in:slide={{ duration: IN_MS, easing: cubicOut }}
    out:slide={{ duration: OUT_MS, easing: cubicIn }}
    role="dialog"
    data-cheat-sheet
    aria-modal="true"
    aria-label={t("commands.cheatsheet.title")}
    tabindex="-1"
    bind:this={panel}
  >
    <div class="head">
      <h2>{t("commands.cheatsheet.title")}</h2>
      {#if onopensettings}
        <button type="button" class="ghost" onclick={onopensettings}>{t("commands.cheatsheet.rebind")}</button>
      {/if}
      <button type="button" class="x" aria-label={t("commands.cheatsheet.close")} onclick={onclose}
        ><UiIcon name="close" size={14} /></button
      >
    </div>

    <div class="body">
      {#each groups as g (g.title)}
        <section class="grp">
          <h3>{g.title}</h3>
          {#each g.rows as r (r.label)}
            <div class="row">
              <span class="lbl" use:clipTitle>{r.label}</span>
              <span class="keys"
                >{#each r.chips as c, i (i)}{@const gesture = c.kind === "mouse" ? splitMouseGesture(c.text) : null}{#if c.kind === "key"}<Keys
                      combo={c.text}
                    />{:else if gesture}<span class="gesture"
                      >{#each gesture as part, pi (pi)}{#if part.kind === "keys"}<Keys combo={part.value} />{:else}<span
                            class="where">{part.value}</span
                          >{/if}{/each}</span
                    >{:else}<span class="where">{c.text}</span>{/if}{/each}</span
              >
            </div>
          {/each}
        </section>
      {/each}
    </div>

    <div class="foot">
      <span><Keys combo="?" />{t("commands.cheatsheet.foot.question")}</span>
      <span><Keys combo="Esc" />{t("commands.cheatsheet.foot.esc")}</span>
    </div>
  </div>
</div>

<style>
  .veil {
    position: fixed;
    inset: 0;
    z-index: 105; /* 모달(100) 위 · 팔레트(110) 아래 — 셋이 겹쳐 뜨는 일은 없다 */
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--bg-overlay);
  }

  .sheet {
    --hair: color-mix(in srgb, var(--fg) 8%, transparent);
    display: flex;
    flex-direction: column;
    width: min(1000px, 100%);
    max-height: 100%;
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--border);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-modal);
    outline: none;
    overflow: hidden;
  }

  .sheet > * {
    opacity: var(--sheet-fade, 1);
  }

  .head {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    padding: 12px 14px 12px 20px;
    border-bottom: 1px solid var(--hair);
  }

  .head h2 {
    flex: 1 1 auto;
    margin: 0;
    font-size: 14px;
    font-weight: var(--fw-semibold);
    color: var(--fg);
  }

  .ghost {
    padding: 4px 10px;
    font: inherit;
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: var(--bg-chip);
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .ghost:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }
  .ghost:focus-visible,
  .x:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .x {
    /* `UiIcon` 은 `display:block` 이라 버튼 안에서 저절로 가운데 서지 않는다 */
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    line-height: 1;
    color: var(--fg-3);
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .x:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    padding: 18px 20px 8px;
    overflow: auto;
    /* 300px 이면 상자 폭(1000px)에서 여백 · 세로 스크롤바를 빼고 세 열이 몇 px 모자라 두 열로 떨어진다 */
    columns: 3 280px;
    column-gap: 28px;
  }

  .grp {
    break-inside: avoid;
    margin: 0 0 28px;
  }

  .grp h3 {
    margin: 0 0 6px;
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg);
  }

  .row {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 30px;
    padding: 4px 0;
    border-bottom: 1px solid var(--hair);
    font-size: 12.5px;
  }
  .row:last-child {
    border-bottom: 0;
  }

  .lbl {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--fg);
  }

  .keys {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
  }

  .gesture {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
  }
  .where {
    font: 12px/1 var(--font-ui);
    color: var(--fg-2);
    white-space: nowrap;
  }

  .foot {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: 16px;
    padding: 10px 20px;
    font-size: var(--t-xs);
    color: var(--fg-3);
    border-top: 1px solid var(--hair);
  }
  .foot span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  @media (max-width: 700px) {
    .body {
      columns: 1;
    }
  }
</style>
