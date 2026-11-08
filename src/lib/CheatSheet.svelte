<script lang="ts">
  /**
   * **단축키 도움말** — 이 앱의 키와 몸짓을 한 장에 편다
   * (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md ·
   * 다시 그린 모양은 docs/log/2026-09-28-cheatsheet-cleanup.md).
   *
   * ## 팔레트와 무엇이 다른가
   *
   * 명령 팔레트는 **실행하는 길**이라 목록이 액션 레지스트리 그대로다. 이 화면은 **읽는
   * 길**이고, 그래서 레지스트리에 **없는 것들**까지 싣는다:
   *
   * - 파일 타일의 고정 키 (`Ctrl+A/C/X/V` · `F2` · `Backspace` · `Delete` …) — 컴포넌트
   *   안에 하드코딩된 관습이라 설정 화면 어디에도 나오지 않는다.
   * - 마우스 몸짓 (헤더 드래그 · 창 밖 티어아웃 · `Ctrl` 드래그 복사 · 줄 끝 손잡이 …).
   *
   * 조합이 **바뀔 수 있는** 것들(레지스트리)은 언제나 [`effectiveCombo`] 로 읽어 사용자
   * 오버라이드가 그대로 보인다 — 화면에 보이는 조합이 실제와 다른 것이 가장 나쁘다.
   * 설명 문단은 두지 않는다: 줄 이름은 한 줄로 끝나고, 더 긴 사실은 사용자 문서
   * (`docs/user/shortcuts.md`)가 든다.
   *
   * ## 화면
   *
   * 모달이다 (`anyModalOpen` 에 들어간다 — 전역 키가 쉰다). Escape·바깥 클릭·**같은 키**로
   * 닫힌다. 떠 있는 동안 키를 캡처 단계에서 통째로 잡는다(아래 `onKeydown` 주석).
   */
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
    /** 지금 걸린 오버라이드 (`settings.current.keybindings`) */
    keybindings?: Record<string, string>;
    onclose: () => void;
    /** "설정에서 바꾸기" — 상위가 설정을 열고 단축키 섹션을 편다 */
    onopensettings?: () => void;
  } = $props();

  /** 한 줄 — 왼쪽에 뜻(한 줄, 넘치면 …), 오른쪽에 칩들 */
  interface Row {
    label: string;
    chips: Chip[];
  }

  interface Group {
    title: string;
    rows: Row[];
  }

  /**
   * 열고 닫는 움직임 — 상자는 **화면 아래에서 올라오고 아래로 내려간다**(서랍처럼 — 2026-10-25 사용자 선택, 다른 모달의
   * 공용 `.modal-rise` 와 갈린다). 덮개는 흐려지기만. 거리는 창 높이의 절반이라 상자가 아래 가장자리 너머에서 출발한다.
   * `prefers-reduced-motion` 이면 움직이지 않는다.
   *
   * **덮개 · 상자의 `opacity` 는 글래스에서 움직이지 않는다**(10-29 — theme.css 모달 등장 절 · 10-28). `opacity` 가 1 아래인
   * 동안 그 요소가 배경 뿌리가 되어 상자의 흐림(`.glass-raised` 의 `::before` · `::after`)이 창 뒤를 못 보고, 움직임이 끝나는
   * 순간 유리가 툭 켜진다. 그래서 덮개는 배경색을(두 재질 모두), 글래스의 상자는 판 색 · 선 · 그림자와 안의 내용(`--sheet-fade` →
   * `.sheet > *`)을 페이드한다 — 흐림 판은 처음부터 서 있다. 평면은 예전처럼 상자의 `opacity` 다.
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
          // 그림자도 같이 — 공용 `glass-surface-in` 이 `box-shadow: none` 에서 출발하는 것과 같은 뜻(모양은 `--glass-shadow` 와 같은 값)
          `box-shadow: 0 8px 32px color-mix(in srgb, var(--glass-shadow-color) ${p}, transparent)`
        );
      },
    };
  }
  /** 덮개 — 배경색만 페이드(전역 `overlay-fade-in` 과 같은 뜻 — 덮개의 `opacity` 는 안쪽 유리의 흐림을 끈다) */
  function veilFade(_node: Element, { duration }: { duration: number }) {
    return {
      duration: reduced() ? 0 : duration,
      css: (t: number) => `background-color: color-mix(in srgb, var(--bg-overlay) ${(t * 100).toFixed(1)}%, transparent)`,
    };
  }

  /** 지금 걸린 조합 (오버라이드 우선) */
  const eff = (id: string) => effectiveCombo(id, keybindings);

  /**
   * 레지스트리 줄 — 모르는 id 면 `null` 이라 목록에서 조용히 빠진다.
   *
   * 뜻 칸은 기본이 **설정 화면과 같은 글자**다 (`actionLabel` — docs/log/2026-09-17-i18n.md).
   * 다만 이 화면은 줄 이름을 한 줄로 끝내야 해서, 설정의 이름이 긴 줄은 이 화면 전용의
   * 짧은 이름(`short`)을 쓴다. 설정 쪽 이름을 줄이지 않는 이유: 그 목록은 문맥 없이 한 줄씩
   * 읽히고(검색도 그 글자로 한다), 여기는 묶음 제목이 문맥을 대신 들어 준다.
   */
  function reg(id: string, short?: Key): Row | null {
    const chips = comboChips([eff(id)]);
    if (!chips) return null;
    if (short) return { label: t(short), chips };
    const name = actionLabel(id);
    return { label: t(name.key, name.params), chips };
  }

  /** 여러 액션을 한 줄에 — `merge` 가 있으면 수식 키가 같은 것끼리 한 칩으로 접는다 */
  function many(ids: readonly string[], label: Key, merge?: string): Row | null {
    const chips = comboChips(ids.map(eff), merge);
    return chips ? { label: t(label), chips } : null;
  }

  /** 고정 키·몸짓 줄 — 레지스트리에 없어 바뀌지 않는다 */
  const fixed = (label: Key, chips: Chip[]): Row => ({ label: t(label), chips });
  const k = keyChip;
  const m = (key: Key) => mouseChip(t(key));

  const arrows = (verb: string) => [`${verb}-left`, `${verb}-right`, `${verb}-up`, `${verb}-down`];

  /** `null` 을 떨어낸 목록 */
  const keep = (rows: (Row | null)[]): Row[] => rows.filter((r): r is Row => r !== null);

  /**
   * 묶음 여섯. **`keybindings` 를 읽으므로 `$derived`** 다 — 설정에서 조합을 바꾸고
   * 돌아오면 (다시 열지 않아도) 글자가 따라 바뀐다.
   */
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
        // 저장만 조합이 있다 — 여는 쪽은 "어느 레이아웃" 이 인자라 키 하나에 담기지 않는다
        // (docs/log/2026-09-04-layout-presets.md).
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
        // 독 세 칸 — 상태바 독 툴팁과 같은 접기(`Ctrl+Shift+H/J/K`)
        many(["open-hosts-dock", "open-projects-dock", "open-db-dock"], "commands.cheatsheet.open.dock", "/"),
        ...(chatDockAvailable() ? [reg("open-chat-dock")] : []),
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
        // 끝내기 — 원격 창에는 없다(독 · 팔레트와 같은 판단)
        ...(isRemote ? [] : [reg("quit-app")]),
      ]),
    },
    {
      title: t("commands.cheatsheet.terminal.title"),
      rows: [
        // 찾기 둘은 전역 액션이지만 묶음은 **층이 아니라 주제**로 나뉜다 — 사람은 찾기를 이 묶음에 와서 묻는다.
        // `find` 는 2026-10-19 부터 "이 타일에서 찾기"(타일 종류로 갈린다 — `app/tile-find.ts`)라 라벨이 그것을 말한다.
        // 둘은 범위가 달라 한 줄로 접지 않는다 — 접으면 어느 칩이 어느 찾기인지 읽히지 않았다(2026-10-25).
        ...keep([
          many(["jump-prev", "jump-next"], "commands.cheatsheet.terminal.jump"),
          reg("copy-output", "commands.cheatsheet.terminal.copyOutput"),
          reg("edit-remote"),
          reg("ask-ai-block"),
          reg("find"),
          reg("find-all"),
        ]),
        // 종료된 타일을 Ctrl+D 로 닫고 Enter 로 다시 잇는 것은 이 앱의 짝이라 남긴다 (`keys.svelte.ts` 의 종료된 타일 처리)
        fixed("commands.cheatsheet.terminal.eof", [k("Ctrl+D")]),
        fixed("commands.cheatsheet.terminal.reconnect", [k("Enter")]),
        // 우클릭은 조합이 아니라 **몸짓**이라 리매핑 목록에 없다 (docs/log/2026-09-05-terminal-context-menu.md)
        fixed("commands.cheatsheet.terminal.menu", [m("commands.cheatsheet.g.rightClick")]),
        fixed("commands.cheatsheet.terminal.menuSwap", [m("commands.cheatsheet.g.shiftRightClick")]),
      ],
    },
    {
      // 바꿀 수 있는 파일 타일 층(`files-*`)만 싣는다 — 탐색기의 관습(클릭 선택 · Ctrl+C/X/V · Delete · F2 ·
      // Backspace 등, `browser/file-keys.ts` 의 `onKeydown` 고정 키)은 누구나 알아 목록만 길게 했다(2026-10-25)
      title: t("commands.cheatsheet.files.title"),
      rows: keep([
        many(["files-view-icons", "files-view-compact", "files-view-details"], "commands.cheatsheet.files.views", "/"),
        reg("files-location"),
        reg("files-places"),
        reg("files-filter"),
        reg("files-preview"),
      ]),
    },
    // 마우스 묶음(끌어 옮기기 · 끌어 놓기 · 우클릭 메뉴 등)은 걷었다 — 단축키 표로 좁힌다(2026-10-25)
  ]);

  /**
   * **떠 있는 동안 키를 통째로 잡는다** — 캡처 단계에서 받아 뒤로 흘리지 않는다.
   *
   * 이 화면에는 입력칸이 없다. 그것이 다른 모달과 갈리는 지점이다: 비밀번호·업로드·호스트
   * 폼은 `<input>` 이 포커스라, 뒤에 깔린 타일들의 **창 단위** 키 핸들러(`SftpBrowser` 의
   * `<svelte:window onkeydown>`)가 "입력칸이면 물러난다" 규칙으로 알아서 비켜났다. 여기서는
   * 포커스가 평범한 `div` 라 그 규칙에 걸리지 않는다 — 덮개 뒤에서 `↑↓` 가 파일 선택을
   * 옮기고 `Delete` 가 삭제 확인을 띄운다. 보이지 않는 곳에서 일어나는 일 중 최악이다.
   *
   * 그래서 `window` 의 **캡처** 단계에 붙어 우리 키를 먼저 처리하고 `stopPropagation` 한다
   * (캡처는 타깃에 닿기 전이라 버블 단계의 창 리스너들이 아예 돌지 않는다). 기본 동작은
   * 막지 않으므로 Tab 이동도, 버튼 위의 Enter 도 그대로다.
   *
   * 그 대가로 **Escape 도 여기서 처리해야 한다** — `+page` 의 Escape 사슬 역시 버블 단계의
   * 창 리스너이기 때문이다. 닫는 길 셋(Escape · 같은 조합 · `?`)이 한 함수에 모인 이유다.
   */
  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      onclose();
      return;
    }
    // `?` = `Shift+Slash`. **`ev.code` 로** 본다 — IME 가 켜져 있어도 물리 키는 그대로다
    // (여는 쪽 `keys.svelte.ts` 의 `handleCheatSheetKey` 와 같은 판정이어야 같은 키로 닫힌다).
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

  /** 열리면 상자에 포커스를 준다 — 탭 순회가 뒤에 깔린 타일로 새지 않게 */
  let panel = $state<HTMLDivElement | null>(null);
  $effect(() => {
    panel?.focus({ preventScroll: true });
  });

  // 캡처 단계라 `<svelte:window>` 로는 붙일 수 없다 (그쪽은 버블이다) — 위 주석 참고.
  $effect(() => {
    const onCapture = (ev: KeyboardEvent) => {
      onKeydown(ev);
      ev.stopPropagation();
    };
    window.addEventListener("keydown", onCapture, true);
    return () => window.removeEventListener("keydown", onCapture, true);
  });

  /**
   * 넘친 줄 이름에만 전체 이름 툴팁 — 잘리지 않은 이름에 같은 글자를 한 번 더 띄우지 않는다
   * (타일 헤더의 "잘렸을 때만" 과 같은 규칙). 호버 순간에 재므로 창 폭이 바뀌어도 맞다.
   * 액션으로 붙이는 이유: 글자 칸(`span`)에 핸들러 속성을 달면 a11y 검사가 역할을 요구한다 —
   * 이것은 조작이 아니라 툴팁 채우기일 뿐이다.
   */
  function clipTitle(el: HTMLElement) {
    const onEnter = () => {
      if (el.scrollWidth > el.clientWidth) el.title = el.textContent ?? "";
      else el.removeAttribute("title");
    };
    el.addEventListener("pointerenter", onEnter);
    return { destroy: () => el.removeEventListener("pointerenter", onEnter) };
  }
</script>

<!--
  바깥을 누르면 닫힌다 — 팔레트와 **같은 방식**이다: 덮개에서 `target === currentTarget`
  일 때만 닫으므로 안쪽 상자에서 `stopPropagation` 을 따로 걸 필요가 없다 (걸어 두면
  글자를 드래그해 복사하다 손이 밖으로 나가는 경우까지 닫히지 않는다).
-->
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
    /* 줄 사이 머리카락 선 — 테두리보다 한 단 옅게, 색은 글자 토큰에서 만든다(두 테마 공통) */
    --hair: color-mix(in srgb, var(--fg) 8%, transparent);
    display: flex;
    flex-direction: column;
    width: min(1000px, 100%);
    max-height: 100%;
    /* 대화 상자 등급의 뜬 면(10-29) — 평면은 불투명(`--surface-raised-solid` — 밑의 터미널 글자가 비치지 않게), 글래스는
       `.glass-raised` 의 흐림 · 흰 선 · 그림자와 슬라이더를 따르는 판 진하기(theme.css 재질 절) */
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--border);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-modal);
    outline: none;
    overflow: hidden;
  }

  /* 글래스 등장 · 퇴장 동안 안의 내용만 흐려진다(위 `slide` — 평면은 값이 없어 1) */
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

  /* 보조 버튼 — 강조색은 선택·주 동작·입력 대기에만 쓴다 */
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

  /*
    묶음은 **세로로 흘러 내려가는 열**이다(`columns`). 격자였을 때는 한 행의 카드 높이가
    가장 긴 카드에 맞춰져 짧은 카드 밑에 빈칸이 났다 — 열 흐름은 다음 묶음이 바로 이어 선다.
    묶음 하나는 열 사이에서 쪼개지지 않는다(`break-inside: avoid`).
  */
  .body {
    flex: 1 1 auto;
    min-height: 0;
    padding: 18px 20px 8px;
    overflow: auto;
    /*
      300px 이 아니라 280px — 상자 폭(1000px)에서 여백·세로 스크롤바를 빼면 300px 세 열(+틈)이
      몇 px 모자라 두 열로 떨어진다(헤드리스로 확인).
    */
    columns: 3 280px;
    column-gap: 28px;
  }

  .grp {
    break-inside: avoid;
    margin: 0 0 28px;
  }

  /* 묶음 제목은 줄 글자(12.5px)보다 크고 진하다 — 11px 흐린 대문자 꼬리표였을 때는 줄과 구분이 안 됐다 */
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

  /* 이름은 한 줄 — 넘치면 … (전체 이름은 호버 툴팁 · `clipTitle`) */
  .lbl {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--fg);
  }

  /* 조합(알약 — 전역 `.keycap-group`) 사이 — 알약끼리 붙어 보이지 않게 */
  .keys {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
  }

  /*
   * 클릭 몸짓 — 클릭 부분은 마우스 아이콘 칩(`Keys` — `우클릭` · `Ctrl+클릭`), 자리 낱말(`헤더` · `tab`)은 그 옆 글자다.
   * 어순은 사전 그대로(`splitMouseGesture`) — ko `헤더 [🖱]` · en `[🖱] header`
   */
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
