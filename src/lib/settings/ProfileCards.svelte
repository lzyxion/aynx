<script lang="ts">
  import { tick } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import type { ThemeProfile } from "$lib/theme-profiles";
  import {
    activeProfileId,
    applyProfile,
    findThemeProfile,
    isModified,
    profileWallpaperSrc,
    removeProfile,
    renameThemeProfile,
    saveCurrentAs,
    themeProfiles,
  } from "$lib/theme-profiles.svelte.js";
  import ProfileCardFace from "$lib/ProfileCardFace.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { revealOriginFrom, revealTheme } from "$lib/theme-reveal";

  /**
   * **모양 프로필 카드** — 설정 › 앱 테마의 첫 묶음 (docs/log/2026-09-28-profile-cards-wallpapers.md).
   *
   * 예전의 select + 버튼 셋을 대신한다. 카드 한 장 = 프로필 한 벌이고, 미리 보기는 **그 프로필의
   * 월페이퍼**(어둡게·줄인 블러 그대로) — 사진이 없으면 그 프로필의 바탕색이다. 그 위에 창 모형은
   * 그리지 않는다(사용자 결정 2026-09-28). 아래는 이름 한 줄뿐이다(색 견본 없음, 2026-10-03). 누르면 입힌다
   * (`applyProfile` — 명령 팔레트와 같은 함수이고, 미저장 편집이 있으면 앞질러 저장하지 않는 규칙도
   * 그 함수 안에 있다).
   *
   * 조작은 카드마다 ⋯ 메뉴 하나로 모았다 — 덮어쓰기 · 이름 변경 · 삭제. 항목은 전부 `runOnMenu`
   * 통로를 지난다(스냅샷 → 닫기 → 실행, docs/conventions.md). 저장은 목록 끝의 점선 카드다.
   *
   * 규칙(같은 이름 덮어쓰기 되묻기 · 이름 유일 · 삭제 되묻기)은 전부 `theme-profiles.svelte.ts`
   * 에 있고, 여기서는 **어느 카드가 이름 칸을 열었나** 같은 화면 상태만 든다. 카드의 얼굴(사진 · 배지 · 이름 줄)은 위에서 내려오는 빠른 전환 줄과 같은 `ProfileCardFace` 다 (docs/log/2026-09-28-profile-switcher.md).
   */

  const profiles = $derived(themeProfiles());
  const activeId = $derived(activeProfileId());
  /** 고른 벌이 있고 지금 모양이 그것과 다른가 — 배지 "수정됨" */
  const modified = $derived(isModified());

  // ── 적용 ────────────────────────────────────────────────────────────────

  /**
   * 카드를 눌렀다. 이미 고른 벌이고 **손대지 않았으면** 아무 일도 없다 (예전 select 도 같은 값을
   * 다시 고르면 `change` 가 안 났다). 고친 뒤라면 다시 입혀 저장된 벌로 되돌린다.
   */
  function pick(id: string, ev: Event) {
    if (id === activeId && !modified) return;
    // 누른 카드에서 원으로 퍼진다(`theme-reveal.ts`) — 그 프로필의 월페이퍼를 먼저 디코딩한다
    void revealTheme(revealOriginFrom(ev), () => applyProfile(id), { preload: profileWallpaperSrc(id) });
  }

  // ── ⋯ 메뉴 ─────────────────────────────────────────────────────────────

  /** 지금 ⋯ 메뉴가 열린 카드의 id (`null` = 닫힘) */
  let menuId = $state<string | null>(null);
  let menuEl = $state<HTMLElement | null>(null);
  /**
   * 메뉴 자리 — **창 좌표**(`position: fixed`). 카드 안 `absolute` 였을 때는 카드(약 150px)보다 넓은 메뉴가 왼쪽으로 삐져
   * 나가 설정 본문 칸(`overflow: auto`)에 잘리고 왼쪽 메뉴 밑으로 숨었다(10-17 — 카드를 줄인 뒤 첫 열에서). ⋯ 단추 오른쪽 끝에
   * 맞추되 창 안으로 당기고, 아래가 모자라면 단추 위로 연다. 자리를 재기 전에는 숨긴다.
   */
  let menuPos = $state<{ top: number; left: number } | null>(null);
  const MENU_MARGIN = 8;

  function closeMenu() {
    menuId = null;
    menuPos = null;
  }

  // 창 좌표에 서므로 본문이 스크롤되면 단추와 어긋난다 — 그때는 닫는다(다른 앱 메뉴와 같은 규칙)
  $effect(() => {
    if (menuId === null) return;
    const onScroll = (ev: Event) => {
      if (menuEl && ev.target instanceof Node && menuEl.contains(ev.target)) return;
      closeMenu();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  });

  function placeMenu(id: string) {
    const btn = document.querySelector<HTMLElement>(`[data-profile-more="${CSS.escape(id)}"]`);
    if (!btn || !menuEl) return;
    const r = btn.getBoundingClientRect();
    const w = menuEl.offsetWidth;
    const h = menuEl.offsetHeight;
    const left = Math.min(Math.max(r.right - w, MENU_MARGIN), window.innerWidth - w - MENU_MARGIN);
    const below = r.bottom + 4;
    const top = below + h > window.innerHeight - MENU_MARGIN ? Math.max(MENU_MARGIN, r.top - h - 4) : below;
    menuPos = { top, left };
  }

  /** ⋯ 를 연다 — 첫 항목에 포커스를 줘 ↑↓·Enter 가 바로 닿게 한다 (셸 메뉴와 같은 규칙) */
  async function openMenu(id: string) {
    naming = null;
    menuId = menuId === id ? null : id;
    menuPos = null;
    if (menuId === null) return;
    await tick();
    placeMenu(id);
    menuEl?.querySelector<HTMLButtonElement>("button[role='menuitem']")?.focus({ preventScroll: true });
  }

  /** 닫고 그 카드의 ⋯ 로 포커스를 돌린다 (Escape — 키보드가 길을 잃지 않게) */
  function closeMenuToTrigger() {
    const id = menuId;
    menuId = null;
    if (id === null) return;
    document
      .querySelector<HTMLButtonElement>(`[data-profile-more="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: true });
  }

  /** ↑↓·Home/End 로 돌고 Escape 로 닫는다 — Escape 는 여기서 끊는다(설정 독까지 닫지 않게) */
  function onMenuKey(ev: KeyboardEvent) {
    const node = menuEl;
    if (!node) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenuToTrigger();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
    ev.preventDefault();
    const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>("button[role='menuitem']"));
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const down = ev.key === "ArrowDown";
    const next =
      ev.key === "Home"
        ? 0
        : ev.key === "End"
          ? buttons.length - 1
          : at < 0
            ? down
              ? 0
              : buttons.length - 1
            : (at + (down ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  }

  /** 바깥을 누르면 떠 있는 ⋯ 를 닫는다 (메뉴·⋯ 자신은 제 카드 안이라 걸리지 않는다) */
  function onWindowPointerDown(ev: PointerEvent) {
    if (menuId === null) return;
    const node = ev.target;
    if (node instanceof Element && node.closest(`[data-profile-card="${CSS.escape(menuId)}"]`)) return;
    menuId = null;
  }

  /** "현재 모양으로 덮어쓰기" — 같은 이름으로 저장하는 길 그대로다 (한 번 되묻고, id 는 유지) */
  function overwrite(p: ThemeProfile) {
    void saveCurrentAs(p.name);
  }

  // ── 이름 칸 (저장 · 이름 변경) ────────────────────────────────────────────
  //
  // 레이아웃 독의 이름 변경과 같은 규칙: Enter·포커스 아웃이 확정, Escape 가 취소 (치다가 다른
  // 곳을 누른 손의 뜻은 "취소" 가 아니라 "이만하면 됐다").

  /** 열린 이름 칸 — 새로 저장(`add`) 또는 그 id 의 이름 변경 */
  let naming = $state<{ kind: "add" } | { kind: "rename"; id: string } | null>(null);
  let nameValue = $state("");
  let nameInput = $state<HTMLInputElement | null>(null);

  /**
   * 저장 칸의 초깃값은 **고른 벌의 이름**이다 — 대개 방금 손본 그 벌을 갱신하려는 것이고
   * (그때는 한 번 되묻는다), 새 벌을 만들려면 통째로 갈아 치면 된다. 열자마자 전체 선택.
   */
  function startAdd() {
    menuId = null;
    naming = { kind: "add" };
    nameValue = (activeId !== null ? findThemeProfile(activeId)?.name : undefined) ?? "";
  }

  function startRename(p: ThemeProfile) {
    naming = { kind: "rename", id: p.id };
    nameValue = p.name;
  }

  function commitName() {
    const open = naming;
    if (open === null) return;
    naming = null; // 먼저 닫는다 — Enter 와 blur 가 겹쳐 두 번 확정되지 않게
    const value = nameValue.trim();
    if (value === "") return;
    if (open.kind === "add") void saveCurrentAs(value);
    else renameThemeProfile(open.id, value);
  }

  function onNameKey(ev: KeyboardEvent) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      commitName();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 설정 독을 닫는 Escape 까지 올라가지 않게 (한 켜만 벗는다)
      naming = null;
    }
  }

  $effect(() => {
    if (naming === null) return;
    nameInput?.focus();
    nameInput?.select();
  });

  /** 카드 위의 F2 · Delete — 목록들(레이아웃 독)과 같은 두 키 */
  function onCardKey(ev: KeyboardEvent, p: ThemeProfile) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    if (ev.key === "F2") {
      ev.preventDefault();
      startRename(p);
    } else if (ev.key === "Delete") {
      ev.preventDefault();
      ev.stopPropagation();
      void removeProfile(p.id);
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="cards" role="list" aria-label={t("settings.theme.profile.list.aria")}>
  {#each profiles as p (p.id)}
    {@const on = p.id === activeId}
    <div class="card" class:active={on} role="listitem" data-profile-card={p.id}>
      <button
        type="button"
        class="pick"
        aria-pressed={on}
        title={t("settings.theme.profile.apply.title", { name: p.name })}
        onclick={(ev) => pick(p.id, ev)}
        onkeydown={(ev) => onCardKey(ev, p)}
        oncontextmenu={(ev) => {
          // 우클릭 = ⋯ (이 앱의 다른 목록과 같은 규칙). 창 기본 메뉴는 막는다.
          ev.preventDefault();
          void openMenu(p.id);
        }}
      >
        <ProfileCardFace profile={p} active={on} {modified} />
      </button>

      <button
        type="button"
        class="more"
        data-profile-more={p.id}
        aria-label={t("settings.theme.profile.menu.aria", { name: p.name })}
        aria-haspopup="menu"
        aria-expanded={menuId === p.id}
        onclick={() => void openMenu(p.id)}><UiIcon name="more" size={14} /></button
      >

      {#if menuId === p.id}
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div
          class="menu menu-surface"
          role="menu"
          bind:this={menuEl}
          onkeydown={onMenuKey}
          style={menuPos ? `top:${menuPos.top}px;left:${menuPos.left}px` : "visibility:hidden"}
        >
          <button
            type="button"
            class="menu-row"
            role="menuitem"
            onclick={() => runOnMenu(() => p, closeMenu, startRename)}>{t("settings.theme.profile.rename")}</button
          >
          <div class="menu-sep" role="separator"></div>
          <button
            type="button"
            class="menu-row"
            role="menuitem"
            onclick={() => runOnMenu(() => p, closeMenu, overwrite)}
            >{t("settings.theme.profile.menu.overwrite")}</button
          >
          <div class="menu-sep" role="separator"></div>
          <button
            type="button"
            class="menu-row danger"
            role="menuitem"
            onclick={() => runOnMenu(() => p.id, closeMenu, removeProfile)}>{t("settings.theme.profile.delete")}</button
          >
        </div>
      {/if}

      {#if naming?.kind === "rename" && naming.id === p.id}
        <!-- 이름 칸은 이름 줄을 **덮는다** — 카드 높이가 바뀌어 격자가 흔들리지 않게 -->
        <input
          class="name-edit"
          bind:this={nameInput}
          bind:value={nameValue}
          aria-label={t("settings.theme.profile.name.rename.aria")}
          placeholder={t("settings.theme.profile.name.placeholder")}
          autocomplete="off"
          spellcheck="false"
          onkeydown={onNameKey}
          onblur={commitName}
        />
      {/if}
    </div>
  {/each}

  <!-- 끝 카드 — 지금 모양을 새 벌로 (같은 이름이면 한 번 되묻고 덮어쓴다) -->
  <div class="card add" role="listitem">
    {#if naming?.kind === "add"}
      <div class="add-in">
        <input
          class="value"
          bind:this={nameInput}
          bind:value={nameValue}
          aria-label={t("settings.theme.profile.name.save.aria")}
          placeholder={t("settings.theme.profile.name.placeholder")}
          autocomplete="off"
          spellcheck="false"
          onkeydown={onNameKey}
          onblur={commitName}
        />
        <small>{t("settings.theme.profile.name.save.hint")}</small>
      </div>
    {:else}
      <button type="button" class="add-btn" onclick={startAdd}>
        <span class="plus"><UiIcon name="plus" size={16} /></span>
        <span>{t("settings.theme.profile.add")}</span>
        <small>{t("settings.theme.profile.add.sub")}</small>
      </button>
    {/if}
  </div>
</div>

{#if profiles.length === 0}
  <p class="hint empty">{t("settings.theme.profile.emptyHint")}</p>
{/if}

<style>
  /* 카드 최소 폭 — 설정 모달의 내용 열(최대 640px)에서 한 줄에 넷이 선다(10-17 사용자: 카드가 커 보인다 —
     예전 168px 은 셋). `min(100%, …)` 은 그보다 좁은 칸에서 가로 스크롤 대신 한 장으로 접히게 한다. */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 132px), 1fr));
    gap: var(--space-3);
  }

  .card {
    position: relative;
    min-width: 0;
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    transition: border-color 0.12s;
  }

  .card:hover {
    border-color: var(--line-strong);
  }

  .card.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  /* 카드 본체 = 누르는 단추 하나 (⋯ 는 단추 안에 단추를 둘 수 없어 형제로 떠 있다) */
  .pick {
    display: grid;
    width: 100%;
    padding: 0;
    overflow: hidden;
    font: inherit;
    color: inherit;
    text-align: left;
    background: none;
    border: 0;
    border-radius: inherit;
    cursor: pointer;
  }

  .pick:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* 미리 보기 · 배지 · 이름 줄은 `ProfileCardFace` 가 그린다 (빠른 전환 줄과 한 벌).
     사진 위에 얹는 ⋯ 는 배지와 같은 **사진 쪽 대비**(검은 반투명 판 + 흰 글자)를 쓴다. */
  .more {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    color: #fff;
    background: rgb(0 0 0 / 0.45);
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s;
  }

  .card:hover .more,
  .card:focus-within .more,
  .more[aria-expanded="true"] {
    opacity: 1;
  }

  .more:hover {
    background: rgb(0 0 0 / 0.65);
  }

  .more:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* ⋯ 메뉴 — 모양은 전역 메뉴 한 벌(`theme.css` 의 `.menu-surface`·`.menu-row`), 여기는 자리만 */
  .menu {
    position: fixed;
    z-index: 20;
    min-width: 170px;
  }

  /* 이름 변경 칸 — 이름 줄 자리를 덮는다 */
  .name-edit {
    position: absolute;
    right: 8px;
    bottom: 6px;
    left: 8px;
    z-index: 6;
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-family: inherit;
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    outline: none;
    box-shadow: var(--glass-ctl-edge, none);
  }

  .name-edit:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .name-edit:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* ── 끝 카드: + 현재 모양 저장 ─────────────────────────────────────────── */

  .card.add {
    display: grid;
    min-height: 100%;
    background: none;
    border-style: dashed;
    border-color: var(--line-strong);
  }

  .add-btn,
  .add-in {
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 6px;
    padding: var(--space-5) var(--space-3);
    color: var(--fg-2);
    text-align: center;
  }

  .add-btn {
    width: 100%;
    font: inherit;
    font-size: var(--t-sm);
    background: none;
    border: 0;
    border-radius: inherit;
    cursor: pointer;
  }

  .add-btn:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .add-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .plus {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    background: var(--bg-chip);
    border-radius: 50%;
  }

  .add-btn small,
  .add-in small {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .add-in .value {
    width: 100%;
  }

  .empty {
    margin-top: var(--space-2);
  }

  @media (prefers-reduced-motion: reduce) {
    .card,
    .more {
      transition: none;
    }
  }
</style>
