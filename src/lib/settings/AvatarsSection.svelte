<script lang="ts">
  import { tick } from "svelte";
  import { optionEntries, t } from "$lib/i18n/i18n.svelte.js";
  import { isRemote } from "$lib/ipc";
  import { AI_ICON_STYLES, setAiIconStyle, settings } from "$lib/settings.svelte.js";
  import {
    AVATAR_NAME_MAX,
    MAX_USER_APP_ICONS,
    assignAvatar,
    loadUserAppIcons,
    removeUserAppIcon,
    renameUserAvatar,
    slotAvatarId,
    startAppIconCrop,
    startRecrop,
    userAppIcons,
    type AvatarSlot,
  } from "$lib/app/app-icons.svelte.js";
  import {
    BUILTIN_AVATARS,
    avatarId,
    avatarLabel,
    avatarLibrary,
    avatarSrc,
    builtinAvatarThumb,
    type BuiltinAvatar,
  } from "$lib/avatars.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { closeDockThen } from "$lib/app/dock.svelte.js";
  import { openArtists } from "$lib/app/orchestration.svelte.js";
  import { artistList } from "$lib/orchestration/api";
  import type { ArtistProfile } from "$lib/orchestration/artist-form";
  import ArtistAvatar from "$lib/orchestration/player/ArtistAvatar.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import ChoiceChips, { type ChoiceIcons } from "$lib/settings/ChoiceChips.svelte";
  import TipName, { tipOf } from "$lib/settings/TipName.svelte";
  import AvatarPicker from "$lib/settings/AvatarPicker.svelte";
  import UiIcon from "$lib/UiIcon.svelte";

  /**
   * **설정 › 테마 › 아바타 하위 화면**의 본문(2026-10-31 — docs/log/2026-10-31-avatars.md · 목업 avatar-mock Main · Interactions).
   * 처음엔 왼쪽 메뉴의 한 칸이었다가(1~3절) 테마 요약의 "아바타" 줄 → [설정 ›] 로 여는 하위 화면이 됐다(4절 — 틀 · 뒤로 · 제목은
   * `AppThemeSection` 의 `SubViewStack` · `SettingsSubView`). 위에서부터:
   *
   * - **표시** — AI 아이콘 모양(로고 / 아바타 — `[ai] icon_style`) + 작은 미리보기(탭 칩 · 알림 줄 · 로딩 덮개 원 — 진짜 `AiGlyph` 로 그린다).
   * - **라이브러리** — 44px 동그라미 나열(내장 넷 + 사용자 그림 · 끝에 점선 [＋] — 목업 avatar-mock Library). 어딘가에 지정되어
   *   쓰는 그림은 강조색 이중 고리, 아니면 살짝 흐리게. 호버 · 키보드 포커스 = 말풍선(이름 · 내장/사용자 · 날짜 · 쓰는 곳), **좌클릭 =
   *   같은 말풍선 고정**(Escape 로만 닫힘 — 다른 동그라미를 누르면 그리로 옮김 · 같은 것을 다시 누르면 닫힘 · 바깥 클릭엔 안 닫힘).
   *   관리 메뉴는 **우클릭 · 메뉴 키 · Shift+F10 으로만** — 사용자 그림은 이름 바꾸기(F2 — 고정한 말풍선 안 칸) · 다시 자르기 ·
   *   …에 쓰기 · 지우기(Delete), 내장은 "…에 쓰기" 만. 쓰는 곳은 지금 **그려지는** 그림 기준이다(지운 그림을 가리키는 값은 기본에 센다).
   * - **아바타 지정** — 앱 아이콘(둥근 사각) · Claude Code · Codex 줄의 [바꾸기] → 고르기 팝오버(`AvatarPicker` — 추가는 라이브러리의 [＋] 하나),
   *   오케스트레이션 아티스트 줄은 겹친 얼굴 · 이름들 · [아티스트에서 편집 →](설정을 닫고 오케스트레이션 탭의 아티스트 화면).
   *
   * 규칙: **지정 고르기는 미저장 변경**(곧바로 미리 보이고 [저장] / [취소]), **넣기 · 지우기 · 이름 · 다시 자르기는 곧바로 파일 작업**
   * (`app/app-icons.svelte.ts` 머리말). 원격 웹 창에서는 관리(넣기 · 이름 · 다시 자르기 · 지우기)를 숨긴다 — 그 명령은 원격 미지원 표다.
   * 관리 메뉴는 메뉴 통로(`runOnMenu`) 하나를 지나고 `document.body` 로 옮겨 그린다(`ImageMenu` 와 같은 까닭 — 설정 모달 위 z 106).
   * 말풍선도 `body` 로 옮겨 그린다(z 104 — 설정 본문 overflow 에 잘리지 않게 · 메뉴 아래 층).
   * 제목은 하위 화면 머리(`SettingsSubView`)가 말하고, 한 줄 설명은 테마 요약 줄 이름의 툴팁으로 갔다.
   */
  let {
    active = false,
    onescape = null,
  }: {
    active?: boolean;
    /** 겹(메뉴 · 이름 칸 · 팝오버 · 고정 말풍선)이 하나도 없을 때의 Escape — 테마 요약으로 돌아간다(아래 Escape 효과) */
    onescape?: (() => void) | null;
  } = $props();

  const AI_ICON_STYLE_ENTRIES = optionEntries(AI_ICON_STYLES);
  const AI_ICON_STYLE_ICONS: ChoiceIcons = { logo: "ai", avatar: "user" };

  /** 지정 줄 셋 — `domId` 는 설정 색인 anchor(`settings-index.ts`)이자 [바꾸기] 단추 id */
  const SLOTS = [
    { slot: "app", domId: "app-icon", name: "settings.avatars.slot.app", where: "settings.avatars.slot.app.where" },
    { slot: "claude", domId: "avatar-claude", name: "settings.avatars.slot.claude", where: "settings.avatars.slot.cli.where" },
    { slot: "codex", domId: "avatar-codex", name: "settings.avatars.slot.codex", where: "settings.avatars.slot.cli.where" },
  ] as const;

  /** 이 화면이 읽은 아티스트(지정 칩 · 아티스트 줄 · 지우기 확인은 따로 다시 읽는다). 실패면 빈 목록 */
  let artists = $state<ArtistProfile[]>([]);

  $effect(() => {
    if (!active) return;
    userAppIcons.error = null;
    void loadUserAppIcons();
    void artistList()
      .then((list) => (artists = list))
      .catch(() => (artists = []));
  });

  const full = $derived(avatarLibrary.list.length >= MAX_USER_APP_ICONS);
  const used = $derived({ app: slotAvatarId("app"), claude: slotAvatarId("claude"), codex: slotAvatarId("codex") });

  /** 아티스트 얼굴이 실제로 그리는 라이브러리 id — 지운 그림 · 모르는 값이면 `null`(그 CLI 의 얼굴로 접힌다 — 칩에 세지 않는다) */
  function artistAvatar(a: ArtistProfile): string | null {
    return avatarSrc(a.icon) !== null ? avatarId(a.icon) : null;
  }

  /** 쓰는 곳 — 이 그림이 지금 **그려지는** 자리(말풍선 목록 · 비어 있지 않으면 동그라미에 강조색 테두리) */
  function placesOf(id: string): string[] {
    const out: string[] = [];
    if (used.app === id) out.push(t("settings.avatars.slot.app"));
    if (used.claude === id) out.push(t("settings.avatars.slot.claude"));
    if (used.codex === id) out.push(t("settings.avatars.slot.codex"));
    const names = artists.filter((a) => artistAvatar(a) === id).map((a) => `‘${a.name}’`);
    if (names.length > 0) out.push(t("settings.avatars.tip.artists", { names: names.join(" · ") }));
    return out;
  }

  /** 말풍선 머리의 곁말 — "내장" · "사용자 · MM-DD" · "사용자" */
  function metaOf(id: string): string {
    if (!isUser(id)) return t("settings.avatars.card.builtin");
    const date = dateOf(avatarLibrary.list.find((a) => a.id === id)?.added);
    return date ? t("settings.avatars.card.user", { date }) : t("settings.avatars.card.userNoDate");
  }

  function thumbOf(id: string): string | null {
    return (BUILTIN_AVATARS as readonly string[]).includes(id) ? builtinAvatarThumb(id as BuiltinAvatar) : avatarSrc(id);
  }

  /** 넣은 날 — `MM-DD`(지역 시각) */
  function dateOf(ms: number | null | undefined): string | null {
    if (!ms) return null;
    const d = new Date(ms);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ── 아바타 추가 — 숨은 파일 칸 하나(라이브러리의 [＋] 만 누른다 — [바꾸기] 팝오버에는 추가가 없다, 2026-10-31 사용자) ──

  let fileInput = $state<HTMLInputElement | null>(null);

  function pickFile(): void {
    if (isRemote || full) return;
    fileInput?.click();
  }

  function onPicked(ev: Event): void {
    const input = ev.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // 같은 파일을 다시 골라도 change 가 오게
    if (file) void startAppIconCrop(file, null);
  }

  // ── 지정 줄의 [바꾸기] 팝오버 ─────────────────────────────────────────────

  let popFor = $state<AvatarSlot | null>(null);

  function togglePop(slot: AvatarSlot): void {
    popFor = popFor === slot ? null : slot;
  }

  /** 팝오버 바깥을 누르면 닫는다([바꾸기] 단추는 스스로 토글한다) */
  function onWindowPointerDown(ev: PointerEvent): void {
    if (popFor === null) return;
    const el = ev.target instanceof Element ? ev.target : null;
    if (el?.closest("[data-avatar-pop], [data-avatar-change]")) return;
    popFor = null;
  }

  function popKeydown(ev: KeyboardEvent, slot: AvatarSlot): void {
    if (ev.key !== "Escape" && ev.code !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation(); // 설정 모달의 Escape(닫기)로 새지 않게 — 팝오버만 닫는다
    popFor = null;
    document.getElementById(SLOTS.find((s) => s.slot === slot)?.domId ?? "")?.focus();
  }

  function focusFirst(node: HTMLElement) {
    (node.querySelector<HTMLElement>(".avatar.active") ?? node.querySelector<HTMLElement>("button"))?.focus();
  }

  // ── 카드 메뉴 ──────────────────────────────────────────────────────────────

  let menu = $state<{ id: string; x: number; y: number } | null>(null);
  let menuEl = $state<HTMLElement | null>(null);

  function openMenu(id: string, x: number, y: number): void {
    menu = { id, x, y };
  }

  function openMenuAt(id: string, el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    openMenu(id, r.left, r.bottom + 4);
  }

  function closeMenu(): void {
    menu = null;
  }

  /** 이 노드를 `body` 끝으로 옮긴다(머리말) — 사라질 때 함께 걷는다 */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  $effect(() => {
    if (!menuEl || !menu) return;
    const r = menuEl.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - r.width - 4);
    const y = menu.y + r.height > window.innerHeight ? Math.max(4, menu.y - r.height - 40) : menu.y;
    menuEl.style.left = `${Math.max(4, x)}px`;
    menuEl.style.top = `${Math.max(4, y)}px`;
    (menuEl.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
  });

  /** 메뉴의 위 · 아래 화살표 — 항목 사이를 돈다. Escape 는 메뉴만 닫는다 */
  function menuKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Escape" || ev.code === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      const id = menu?.id;
      closeMenu();
      if (id) cardEl(id)?.focus();
      return;
    }
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    ev.preventDefault();
    const items = [...(menuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }

  function isUser(id: string): boolean {
    return !(BUILTIN_AVATARS as readonly string[]).includes(id);
  }

  function cardEl(id: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-avatar-card="${CSS.escape(id)}"]`);
  }

  // ── 말풍선 — 호버 · 포커스는 떠 있는 동안만, 클릭은 고정(Esc 로만 닫힘) ─────────────────────

  /** 고정한 동그라미 — 같은 동그라미를 다시 누르거나 Escape 로만 풀린다(바깥 클릭으로는 안 닫힌다 — 2026-10-31 사용자) */
  let pin = $state<string | null>(null);
  /** 마우스가 올라간 동그라미 */
  let hover = $state<string | null>(null);
  /** 키보드로 포커스한 동그라미(`:focus-visible` 일 때만 — 마우스 클릭 뒤 남는 포커스는 말풍선을 세우지 않는다) */
  let focused = $state<string | null>(null);
  /** 방금 닫은 동그라미 — 마우스 · 포커스가 떠날 때까지 미리보기로 다시 세우지 않는다(닫자마자 호버 말풍선이 되살지 않게) */
  let suppress = $state<string | null>(null);
  let tipEl = $state<HTMLElement | null>(null);

  const allIds = $derived([...BUILTIN_AVATARS, ...avatarLibrary.list.map((a) => a.id)] as string[]);
  const preview = $derived.by(() => {
    const h = hover ?? focused;
    return h !== null && h !== suppress && h !== pin ? h : null;
  });
  /** 지금 말풍선이 가리키는 동그라미 — 이름을 고치는 중이면 그것, 아니면 미리보기, 아니면 고정 */
  const tipId = $derived.by(() => {
    const id = renaming ?? preview ?? pin;
    return id !== null && allIds.includes(id) ? id : null;
  });
  const tipPinned = $derived(tipId !== null && tipId === pin);

  $effect(() => {
    if (active) return;
    pin = hover = focused = suppress = null;
  });

  function clickDot(id: string): void {
    if (pin === id) {
      pin = null;
      suppress = id;
    } else {
      pin = id;
      suppress = null;
    }
  }

  function leaveDot(id: string): void {
    if (hover === id) hover = null;
    if (suppress === id) suppress = null;
  }

  /** 말풍선 자리 — 동그라미 아래(모자라면 위), 화살표는 동그라미 가운데. `body` 로 옮겨 그려 설정 본문 overflow 에 잘리지 않는다 */
  function placeTip(): void {
    if (!tipEl || tipId === null) return;
    const a = cardEl(tipId)?.getBoundingClientRect();
    if (!a) return;
    const r = tipEl.getBoundingClientRect();
    const cx = a.left + a.width / 2;
    const x = Math.max(8, Math.min(cx - 28, window.innerWidth - r.width - 8));
    let y = a.bottom + 12;
    const above = y + r.height > window.innerHeight - 8;
    if (above) y = Math.max(8, a.top - 12 - r.height);
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
    tipEl.style.setProperty("--arrow-x", `${Math.round(cx - x - 6)}px`);
    tipEl.dataset.side = above ? "above" : "below";
  }

  $effect(() => {
    void tipId;
    void renaming;
    void artists;
    if (!tipEl) return;
    placeTip();
    const on = () => placeTip();
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
    };
  });

  /**
   * **이 화면의 Escape 한 곳** — 창에 **캡처**로 받아 거기서 끊는다(설정 모달의 Escape(닫기)보다 먼저 · `SubViewStack` 과 같은 관례).
   * 한 겹씩 벗는다: 카드 메뉴 · 이름 칸 · [바꾸기] 팝오버가 떠 있으면 그쪽 요소의 Escape 다(여기서는 물러난다) → 고정한 말풍선을
   * 닫는다 → 아무 겹도 없으면 `onescape`(테마 하위 화면 → 요약). 요약에서의 Escape 는 늘 그렇듯 설정 모달 몫이다.
   * `SubViewStack` 의 Escape 를 쓰지 않는 까닭은 `AppThemeSection` 머리말(등록 순서상 그쪽이 먼저 돌아 말풍선을 건너뛴다).
   * 한국어 IME 가 켜져 있으면 Escape 가 `key: "Process"` 로 올 수 있어 물리 키 `code` 도 본다(`tabbar/tab-menu.ts` 의 `menuEscape`) —
   * 조합 중(`isComposing`)이면 IME 몫이다. 설정 모달 밖(위에 뜬 확인 상자 · 자르기 모달)의 Escape 는 그쪽 것.
   */
  $effect(() => {
    if (pin === null && !onescape) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== "Escape" && ev.code !== "Escape") return;
      if (ev.isComposing || menu || renaming !== null || popFor !== null) return;
      const target = ev.target instanceof Node ? ev.target : null;
      const scope = libEl?.closest<HTMLElement>('[aria-modal="true"]') ?? document.body;
      if (!target || !(target === document.body || scope.contains(target) || tipEl?.contains(target))) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (pin !== null) {
        suppress = pin;
        pin = null;
        return;
      }
      onescape?.();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  let libEl = $state<HTMLElement | null>(null);

  // ── 이름 바꾸기 — 고정한 말풍선 안의 칸 ─────────────────────────────────────

  let renaming = $state<string | null>(null);
  let draft = $state("");

  async function beginRename(id: string): Promise<void> {
    if (isRemote || !isUser(id)) return;
    draft = avatarLibrary.list.find((a) => a.id === id)?.name ?? "";
    pin = id;
    suppress = null;
    renaming = id;
    await tick();
    const input = document.querySelector<HTMLInputElement>(`[data-avatar-name-input="${CSS.escape(id)}"]`);
    input?.focus();
    input?.select();
  }

  function finishRename(commit: boolean): void {
    const id = renaming;
    if (id === null) return;
    renaming = null;
    if (commit) void renameUserAvatar(id, draft);
    void tick().then(() => cardEl(id)?.focus());
  }

  function cardKeydown(ev: KeyboardEvent, id: string): void {
    // 메뉴는 우클릭으로만 연다(좌클릭은 아무것도 안 함 — 2026-10-31 사용자). 키보드는 메뉴 키 · Shift+F10.
    if (ev.code === "ContextMenu" || (ev.shiftKey && ev.code === "F10")) {
      ev.preventDefault();
      openMenuAt(id, ev.currentTarget as HTMLElement);
      return;
    }
    if (isRemote || !isUser(id)) return;
    if (ev.code === "F2") {
      ev.preventDefault();
      void beginRename(id);
    } else if (ev.code === "Delete") {
      ev.preventDefault();
      void removeUserAppIcon(id);
    }
  }

  // ── 아티스트 줄 ──────────────────────────────────────────────────────────

  function editArtists(): void {
    closeDockThen(openArtists);
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<!-- ── 표시 ─────────────────────────────────────────────────────────────── -->
<h4 class="subhead first">{t("settings.avatars.show.heading")}</h4>
<div class="rows term">
  <div class="srow show-row">
    <div class="show-name">
      <TipName
        id="ai-icon-style"
        label={t("settings.theme.avatar.style.label")}
        tip={tipOf(t("settings.theme.avatar.style.summary"), t("settings.theme.avatar.style.note"))}
      />
      <span class="desc">{t("settings.avatars.show.where")}</span>
    </div>
    <ChoiceChips
      id="ai-icon-style"
      labelledby="ai-icon-style-label"
      entries={AI_ICON_STYLE_ENTRIES}
      icons={AI_ICON_STYLE_ICONS}
      value={settings.aiIconStyle}
      onpick={setAiIconStyle}
    />
    <!-- 미리보기 — 진짜 그리는 자리(`AiGlyph`)를 작게 세운다: 탭 칩 둘 · 알림 줄 · 로딩 덮개 원 -->
    <div class="preview" role="group" aria-label={t("settings.avatars.preview.aria")}>
      <span class="pv-tab"><AiGlyph name="claude" size={14} />Claude Code</span>
      <span class="pv-tab"><AiGlyph name="codex" size={14} />Codex</span>
      <span class="pv-note"><AiGlyph name="claude" size={20} />{t("settings.avatars.preview.notice")}</span>
      <span class="pv-veil"><AiGlyph name="claude" size={44} /></span>
    </div>
  </div>
</div>

<!-- ── 라이브러리 ───────────────────────────────────────────────────────── -->
<div class="sub-line">
  <h4 class="subhead">{t("settings.avatars.library.heading")}</h4>
  <span class="count">{t("settings.avatars.library.count", { n: String(avatarLibrary.list.length), max: String(MAX_USER_APP_ICONS) })}</span>
</div>
<div class="dots" id="avatar-library" role="list" aria-label={t("settings.avatars.library.heading")} bind:this={libEl}>
  {#each allIds as id (id)}
    {@const label = avatarLabel(id) ?? id}
    <!-- 44px 동그라미 — 쓰는 중이면 강조색 이중 테두리, 아니면 살짝 흐리게. 좌클릭 = 말풍선 고정 토글 · 우클릭 = 관리 메뉴 -->
    <div class="dot-item" role="listitem">
      <button
        type="button"
        class="dot"
        class:used={placesOf(id).length > 0}
        class:pinned={pin === id || menu?.id === id}
        data-avatar-card={id}
        aria-label={label}
        aria-expanded={pin === id}
        aria-controls={tipId === id ? "avatar-tip" : undefined}
        aria-describedby={tipId === id && !tipPinned ? "avatar-tip" : undefined}
        onclick={() => clickDot(id)}
        onpointerenter={() => (hover = id)}
        onpointerleave={() => leaveDot(id)}
        onfocus={(ev) => {
          if (ev.currentTarget.matches(":focus-visible")) focused = id;
        }}
        onblur={() => {
          if (focused === id) focused = null;
          if (suppress === id && hover !== id) suppress = null;
        }}
        oncontextmenu={(ev) => {
          ev.preventDefault();
          openMenu(id, ev.clientX, ev.clientY);
        }}
        onkeydown={(ev) => cardKeydown(ev, id)}
      >
        <img src={thumbOf(id) ?? ""} alt="" width="44" height="44" draggable="false" />
      </button>
    </div>
  {/each}
  {#if !isRemote}
    <button
      type="button"
      class="dot add"
      disabled={full}
      aria-label={t("settings.avatars.add")}
      data-avatar-add
      onclick={pickFile}
    >
      <UiIcon name="plus" size={18} />
    </button>
    <!-- 화면에 없는 파일 칸 — 그림은 이 창에서만 읽는다(경로를 Rust 에 넘기지 않는다) -->
    <input
      class="hidden-input"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"
      tabindex="-1"
      aria-hidden="true"
      bind:this={fileInput}
      onchange={onPicked}
    />
  {/if}
</div>
{#if userAppIcons.error}
  <p class="av-error" role="alert">{userAppIcons.error}</p>
{/if}

<!-- ── 아바타 지정 ──────────────────────────────────────────────────────── -->
<div class="sub-line">
  <h4 class="subhead">{t("settings.avatars.assign.heading")}</h4>
</div>
<div class="rows term">
  {#each SLOTS as s (s.slot)}
    {@const id = used[s.slot]}
    <div class="srow arow">
      <img class="slot-face" class:square={s.slot === "app"} src={thumbOf(id) ?? ""} alt="" width="40" height="40" draggable="false" />
      <div class="atext">
        <span class="aname"
          >{t(s.name)} <span class="muted">· {avatarLabel(id) ?? id}</span></span
        >
        <span class="desc">{t(s.where)}</span>
      </div>
      <button
        type="button"
        class="btn btn-secondary change"
        class:open={popFor === s.slot}
        id={s.domId}
        aria-expanded={popFor === s.slot}
        aria-haspopup="dialog"
        data-avatar-change={s.slot}
        onclick={() => togglePop(s.slot)}>{t("settings.avatars.change")}</button
      >
      {#if popFor === s.slot}
        <div
          class="pop glass-raised"
          role="dialog"
          tabindex="-1"
          aria-label={(s.slot === "app" ? t("settings.avatars.pick.titleApp") : t("settings.avatars.pick.title", { slot: t(s.name) }))}
          data-avatar-pop={s.slot}
          use:focusFirst
          onkeydown={(ev) => popKeydown(ev, s.slot)}
        >
          <span class="pop-title">{(s.slot === "app" ? t("settings.avatars.pick.titleApp") : t("settings.avatars.pick.title", { slot: t(s.name) }))}</span>
          <AvatarPicker
            id="avatar-pick-{s.slot}"
            value={id}
            square={s.slot === "app"}
            onpick={(picked) => {
              assignAvatar(s.slot, picked);
              popFor = null;
            }}
          />
        </div>
      {/if}
    </div>
  {/each}
  <div class="srow arow">
    <span class="faces" aria-hidden="true">
      {#each artists.slice(0, 3) as a (a.id)}<ArtistAvatar cli={a.cli} profile={a} size={26} ring />{/each}
      {#if artists.length === 0}<span class="faces-empty"><UiIcon name="user" size={18} /></span>{/if}
    </span>
    <div class="atext">
      <span class="aname"
        >{t("settings.avatars.slot.artists")}
        {#if artists.length > 0}<span class="muted">· {t("settings.avatars.slot.artists.count", { n: String(artists.length) })}</span>{/if}</span
      >
      <span class="desc">{artists.length > 0 ? artists.map((a) => a.name).join(" · ") : t("settings.avatars.slot.artists.none")}</span>
    </div>
    {#if !isRemote}
      <button type="button" class="link-btn" data-avatar-artists onclick={editArtists}>{t("settings.avatars.slot.artists.edit")}</button>
    {/if}
  </div>
</div>

{#if tipId !== null}
  {@const id = tipId}
  {@const label = avatarLabel(id) ?? id}
  {@const places = placesOf(id)}
  <!-- 말풍선 — 호버 · 포커스면 tooltip(커서를 먹지 않는다), 고정이면 dialog(이름 칸을 띄울 수 있다) -->
  <div class="portal" use:portal>
    <div
      class="av-tip"
      class:pinned={tipPinned}
      id="avatar-tip"
      role={tipPinned ? "dialog" : "tooltip"}
      tabindex="-1"
      aria-label={tipPinned ? t("settings.avatars.tip.aria", { name: label }) : undefined}
      data-avatar-tip={id}
      data-pinned={tipPinned ? "" : undefined}
      bind:this={tipEl}
    >
      <span class="tip-arrow" aria-hidden="true"></span>
      <span class="tip-head">
        {#if renaming === id}
          <!-- 이름 칸 — Enter · 바깥으로 나가면 저장, Escape 는 이름 고치기만 취소한다(말풍선 · 설정 모달은 그대로) -->
          <input
            class="name-input"
            type="text"
            maxlength={AVATAR_NAME_MAX}
            aria-label={t("settings.avatars.card.nameField", { name: label })}
            placeholder={label}
            data-avatar-name-input={id}
            bind:value={draft}
            onblur={() => finishRename(true)}
            onkeydown={(ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                finishRename(true);
              } else if (ev.key === "Escape" || ev.code === "Escape") {
                ev.preventDefault();
                ev.stopPropagation();
                finishRename(false);
              }
            }}
          />
        {:else}
          <span class="tip-name">{label}</span>
        {/if}
        <span class="tip-meta">· {metaOf(id)}</span>
      </span>
      {#if places.length > 0}
        <ul class="tip-places">
          {#each places as p (p)}<li>{p}</li>{/each}
        </ul>
      {:else}
        <span class="tip-none">{t("settings.avatars.card.none")}</span>
      {/if}
    </div>
  </div>
{/if}

{#if menu}
  {@const m = menu}
  {@const user = isUser(m.id) && !isRemote}
  <div class="portal" use:portal>
    <button
      type="button"
      class="menu-backdrop"
      tabindex="-1"
      aria-label={t("files.menu.close.aria")}
      onclick={closeMenu}
      oncontextmenu={(ev) => {
        ev.preventDefault();
        closeMenu();
      }}
    ></button>
    <div
      class="av-menu menu-surface"
      role="menu"
      tabindex="-1"
      aria-label={avatarLabel(m.id) ?? m.id}
      data-avatar-menu={m.id}
      style:left="{m.x}px"
      style:top="{m.y}px"
      bind:this={menuEl}
      onkeydown={menuKeydown}
    >
      {#if user}
        <button type="button" class="menu-row" role="menuitem" data-avatar-action="rename"
          onclick={() => runOnMenu(() => m.id, closeMenu, (id) => beginRename(id))}
          >{t("settings.avatars.menu.rename")}<span class="menu-kbd">F2</span></button
        >
        <button type="button" class="menu-row" role="menuitem" data-avatar-action="recrop"
          onclick={() => runOnMenu(() => m.id, closeMenu, (id) => startRecrop(id))}>{t("settings.avatars.menu.recrop")}</button
        >
        <div class="menu-sep" role="separator"></div>
      {/if}
      <button type="button" class="menu-row" role="menuitem" data-avatar-action="app"
        onclick={() => runOnMenu(() => m.id, closeMenu, (id) => assignAvatar("app", id))}>{t("settings.avatars.menu.useApp")}</button
      >
      <button type="button" class="menu-row" role="menuitem" data-avatar-action="claude"
        onclick={() => runOnMenu(() => m.id, closeMenu, (id) => assignAvatar("claude", id))}
        >{t("settings.avatars.menu.useCli", { cli: t("settings.avatars.slot.claude") })}</button
      >
      <button type="button" class="menu-row" role="menuitem" data-avatar-action="codex"
        onclick={() => runOnMenu(() => m.id, closeMenu, (id) => assignAvatar("codex", id))}
        >{t("settings.avatars.menu.useCli", { cli: t("settings.avatars.slot.codex") })}</button
      >
      {#if user}
        <div class="menu-sep" role="separator"></div>
        <button type="button" class="menu-row danger" role="menuitem" data-avatar-action="remove"
          onclick={() => runOnMenu(() => m.id, closeMenu, (id) => removeUserAppIcon(id))}
          >{t("settings.avatars.menu.remove")}<span class="menu-kbd">Delete</span></button
        >
      {/if}
    </div>
  </div>
{/if}

<style>
  /* 소제목 줄 — 제목 · 개수 · 오른쪽 안내 */
  .sub-line {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin-top: var(--space-5);
    margin-bottom: var(--space-2);
  }

  .sub-line .subhead {
    margin: 0;
  }

  .count {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .desc {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .muted {
    font-weight: 400;
    color: var(--fg-2);
  }

  /* ── 표시 줄 — 이름 · 칩 · 미리보기, 좁으면 미리보기가 다음 줄로 ── */
  .srow.show-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-4);
  }

  .show-name {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 140px;
    min-width: 0;
  }

  .preview {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-left: auto;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-field);
  }

  .pv-tab,
  .pv-note {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-1);
    white-space: nowrap;
    border-radius: 8px;
    background: var(--control-tile-bg);
  }

  .pv-note {
    height: 32px;
    color: var(--fg-2);
  }

  .pv-veil {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.3);
    background: var(--control-tile-bg);
  }

  /* ── 라이브러리 — 44px 동그라미 나열(간격 12 · 목업 Library ①) ── */
  .dots {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    /* 바깥 고리(최대 7px)가 잘리지 않게 — 설정 본문은 왼쪽 여백 없이 스크롤 상자라 왼쪽은 안으로 7px 들인다(음수 여백이면 잘린다) */
    padding: 7px 0 7px 7px;
    margin: -7px 0;
  }

  .dot-item {
    display: contents;
  }

  .dot {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: transform 120ms ease-out;
  }

  .dot img {
    display: block;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    object-fit: cover;
    user-select: none;
    /* 쓰지 않는 그림은 살짝 흐리게 — 올리면 또렷하게 */
    opacity: 0.85;
    transition: opacity 120ms ease-out;
  }

  .dot:hover img,
  .dot.used img,
  .dot.pinned img {
    opacity: 1;
  }

  .dot:not(.add):hover {
    transform: scale(1.08);
  }

  /* 쓰는 중 — 2px 띄운(투명 — 유리 판 위에서도 바탕이 그대로 보인다) 강조색 2px 고리 */
  .dot.used {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* 고정(또는 관리 메뉴가 열린) 동그라미 — 고리 바깥에 옅은 강조색 한 겹(목업 ③) */
  .dot::after {
    position: absolute;
    inset: -7px;
    content: "";
    border: 3px solid transparent;
    border-radius: 50%;
    pointer-events: none;
  }

  .dot.pinned::after {
    border-color: color-mix(in srgb, var(--accent) 28%, transparent);
  }

  .dot:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .dot.used:focus-visible {
    outline-color: var(--accent);
  }

  .dot.used:focus-visible::after {
    border-color: var(--focus-ring);
  }

  /* [＋] — 점선 동그라미 */
  .dot.add {
    border: 1.5px dashed var(--line-strong);
  }

  .dot.add:hover:not(:disabled) {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .dot.add:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* ── 말풍선 — `body` 로 옮겨 그린다(설정 본문 overflow 밖 · 카드 메뉴 바로 아래 층) ── */
  .av-tip {
    position: fixed;
    z-index: 104;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 200px;
    max-width: 300px;
    box-sizing: border-box;
    padding: 10px 12px;
    font-family: var(--font-ui);
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    box-shadow: var(--shadow-raised);
    /* 호버 말풍선은 커서를 먹지 않는다(밑의 동그라미에서 pointerleave 가 나 깜빡이지 않게) */
    pointer-events: none;
  }

  .av-tip.pinned {
    pointer-events: auto;
  }

  .av-tip:focus {
    outline: none;
  }

  .tip-arrow {
    position: absolute;
    top: -7px;
    left: var(--arrow-x, 22px);
    width: 12px;
    height: 12px;
    background: var(--surface-raised-solid);
    border-top: 1px solid var(--line-strong);
    border-left: 1px solid var(--line-strong);
    transform: rotate(45deg);
  }

  /* `data-side` 는 자리 잴 때(`placeTip`) 스크립트가 단다 */
  .av-tip:global([data-side="above"]) .tip-arrow {
    top: auto;
    bottom: -7px;
    transform: rotate(225deg);
  }

  .tip-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    font-size: var(--t-sm);
  }

  .tip-name {
    overflow: hidden;
    font-weight: var(--fw-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tip-meta {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .tip-places {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    font-size: var(--t-xs);
    color: var(--fg-2);
    list-style: none;
  }

  .tip-places li {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tip-places li::before {
    flex: 0 0 auto;
    width: 5px;
    height: 5px;
    content: "";
    border-radius: 50%;
    background: var(--accent);
  }

  .tip-none {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* 이름 칸 — 고정한 말풍선의 이름 자리 */
  .name-input {
    flex: 1 1 auto;
    min-width: 0;
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font: inherit;
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    outline: none;
    box-shadow: var(--glass-ctl-edge, none);
  }

  .name-input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .name-input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .hidden-input {
    display: none;
  }

  .av-error {
    margin: var(--space-2) 0 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    color: var(--err);
    background: var(--err-soft);
    border-radius: var(--radius-sm);
  }

  /* ── 지정 줄 — [그림 | 이름 · 설명 | 단추], 팝오버는 줄 아래 오른쪽 ── */
  .srow.arow {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .slot-face {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
  }

  .slot-face.square {
    border-radius: 9px;
  }

  .atext {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .aname {
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .atext .desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .change.open {
    color: var(--on-accent);
    background: var(--accent);
  }

  /* 겹친 얼굴(최대 셋) — 폭은 얼굴 수만큼(최소 40 — 위 줄들의 그림 칸과 맞춘다) */
  .faces {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    min-width: 40px;
  }

  .faces > :global(* + *) {
    margin-left: -12px;
  }

  .faces-empty {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    color: var(--fg-3);
    border-radius: 50%;
    background: var(--control-tile-bg);
  }

  .link-btn {
    flex: 0 0 auto;
    padding: 0;
    font: inherit;
    font-size: var(--t-sm);
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
  }

  .link-btn:hover:not(:disabled) {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .link-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .pop {
    position: absolute;
    top: calc(100% - 4px);
    right: var(--space-4);
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 380px;
    max-width: calc(100% - 2 * var(--space-4));
    box-sizing: border-box;
    padding: var(--space-4);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
  }

  .pop-title {
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  /* ── 카드 메뉴 — `ImageMenu` 와 같은 층(독 z 100 위) ── */
  .portal {
    display: contents;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 105;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .av-menu {
    position: fixed;
    z-index: 106;
    min-width: 200px;
    max-width: 280px;
  }

  /* `.menu-row` 는 `display: block` 이라 꼬리표(`.menu-kbd` — F2 · Delete)를 끝으로 밀려면 플렉스여야 한다(목업 ④) */
  .av-menu .menu-row {
    display: flex;
    align-items: center;
  }
</style>
