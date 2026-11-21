<script lang="ts">
  import { tick, untrack } from "svelte";
  import { buildBlockMatcher, buildMatcher, matchesInLine, parseSearchQuery } from "$lib/search-query";
  import {
    applyAutocomplete,
    backspaceAtStart,
    composeQuery,
    dropChip as dropChipOf,
    tokenizeOnSpace,
    type ChipKind,
    type ChipState,
  } from "$lib/search-chips";
  import {
    HITS_PER_TERMINAL,
    HITS_TOTAL,
    disambiguateNames,
    headerTabTitle,
    scanBlockTargets,
    scanTargets,
    searchTarget,
    searchTargets,
    type BlockHit,
    type SearchHit,
    type SearchTarget,
    type TerminalHits,
  } from "$lib/search-registry";
  import { blocksOf } from "$lib/block-history";
  import { commandsOf } from "$lib/shell-integration";
  import { comboFromEvent, effectiveCombo } from "$lib/keybindings";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { settings } from "$lib/settings.svelte.js";
  import { showNotice } from "$lib/app/notice";
  import { closeSearchKeeping } from "$lib/app/overlays.svelte.js";
  import { focusTile, tabOfPane, residentWindowTabs } from "$lib/app/tabs.svelte.js";
  import { tabDisplayTitle } from "$lib/session";
  import UiIcon from "$lib/UiIcon.svelte";

  /**
   * 터미널 찾기 오버레이 — 전체 · 범위(`@`) · 블록(`#`) · `@` 자동완성 네 모드로 갈라진다.
   * 범위 모드는 결과가 타일 안(xterm 강조)에 있어 화면을 덮지 않는다(`.bare`).
   * 칩은 표현일 뿐 — 두 칸은 곧바로 `composeQuery` 로 한 줄이 되고 파싱 · 훑기 · 강조는 그 한 줄로만 돈다.
   *
   * `{@html}` 을 쓰지 않는다 — 미리보기의 출처는 원격 셸 출력이라 `echo` 한 줄로 `<img onerror=…>` 를 찍을 수 있고,
   * 그 순간 `{@html}` 은 곧바로 XSS 다. 조각 배열을 `{#each}` 로 그려 Svelte 의 기본 이스케이프를 지나가게 둔다.
   */

  let {
    seed,
    onclose,
  }: {
    seed: ChipState;
    onclose: () => void;
  } = $props();

  const DEBOUNCE_MS = 150;

  const PREVIEW_LEAD = 40;
  const PREVIEW_LEN = 160;

  // `seed` 는 열릴 때 한 번만 뜻이 있다 — 뒤늦게 따라가면 사용자가 치던 질의를 덮어쓴다.
  let chip = $state<string | null>(untrack(() => seed.scopeChip));
  /** `@` 와 다른 축이다 */
  let blockChip = $state<string | null>(untrack(() => seed.blockChip));
  let query = $state(untrack(() => seed.text));
  let debounced = $state(untrack(() => composeQuery(seed)));
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  /** 칩을 눌러 연 자동완성 — 칩이 서 있으면 판정할 글자가 입력칸에 없어 이 기억 한 칸이 대신한다 */
  let acPinned = $state(false);

  const chips = $derived<ChipState>({ scopeChip: chip, blockChip, text: query });
  const full = $derived(composeQuery(chips));

  let selRaw = $state(0);
  let acSelRaw = $state(0);

  let pos = $state<{ index: number; count: number }>({ index: 0, count: 0 });

  /** `select()` 하지 않는다 — `Ctrl+F` 로 들어오면 범위는 칩이고 곧바로 검색어를 치라는 뜻이다 */
  $effect(() => {
    const el = inputEl;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });

  $effect(() => {
    const q = full;
    const id = setTimeout(() => {
      debounced = q;
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  });

  /** 모드 판정은 디바운스를 기다리지 않는다 */
  const live = $derived(parseSearchQuery(full));
  const settled = $derived(parseSearchQuery(debounced));
  const matcher = $derived(buildMatcher(settled));
  const blockMatcher = $derived(buildBlockMatcher(settled));

  /** `buildMatcher` 는 빈 검색어와 깨진 정규식을 똑같이 `null` 로 준다 — 앞쪽은 조용해야 하고 뒤쪽은 말해 줘야 해 여기서 다시 가른다 */
  const regexBroken = $derived(
    settled.options.regex &&
      ((settled.text !== "" && matcher === null) ||
        (settled.block !== null && settled.block !== "" && blockMatcher === null)),
  );

  function stillTyping(raw: string): boolean {
    const at = raw.lastIndexOf("@");
    if (at === -1) return false;
    const rest = raw.slice(at + 1);
    if (rest.startsWith('"')) return rest.indexOf('"', 1) === -1;
    return !/\s/.test(rest);
  }

  /** 판정 재료는 입력칸의 글자뿐 — 합성 질의를 보면 칩이 서 있는 동안 드롭다운이 영원히 뜬다 */
  const typed = $derived(parseSearchQuery(query));
  const acOpen = $derived(
    acPinned ||
      (typed.scope?.kind === "terminal" && (typed.scope.name === "" || stillTyping(query))),
  );

  const mode = $derived.by((): "ac" | "block" | "scope" | "all" => {
    if (acOpen) return "ac";
    if (live.block !== null) return "block";
    return live.scope === null ? "all" : "scope";
  });

  const bare = $derived(mode === "scope");

  /** `void full` 로 매 입력마다 다시 읽는다 — 레지스트리는 평범한 `Map` 이다. 훑기는 여기 매달지 않는다(디바운스가 무의미해진다) */
  const entries = $derived.by((): { target: SearchTarget; label: string }[] => {
    void full;
    const targets = searchTargets();
    const labels = disambiguateNames(targets.map((tg) => tg.name()));
    return targets.map((tg, i) => ({ target: tg, label: labels[i] }));
  });

  const acItems = $derived.by(() => {
    const typing = !acPinned && typed.scope?.kind === "terminal" ? typed.scope.name : "";
    const frag = typing.toLowerCase();
    if (frag === "") return entries;
    const starts = entries.filter((e) => e.label.toLowerCase().startsWith(frag));
    const inside = entries.filter(
      (e) => !e.label.toLowerCase().startsWith(frag) && e.label.toLowerCase().includes(frag),
    );
    return [...starts, ...inside];
  });

  const acSel = $derived(acItems.length === 0 ? -1 : Math.min(acSelRaw, acItems.length - 1));

  /** 라벨 완전 일치다 — `@bash` 와 `@bash/2` 는 다른 타일이다 */
  const scoped = $derived.by(() => {
    const s = live.scope;
    if (mode !== "scope" || s?.kind !== "terminal") return null;
    return entries.find((e) => e.label === s.name) ?? null;
  });

  /** 레지스트리 값 그대로라 동일성이 안정하다 — 아래 강조 효과가 키 입력마다 지웠다 칠하지 않는 것은 그 덕이다 */
  const scopedTarget = $derived(scoped?.target ?? null);

  /**
   * 범위 모드에 들어갈 때 한 번 그 타일을 활성으로 — `display:none` 인 비활성 탭은 렌더러가 멎어 강조가 보이지 않는다.
   * 기억은 `$state` 가 아니다 — 자기가 쓴 값을 다시 읽어 스스로를 깨운다.
   */
  let shownPane: string | null = null;
  $effect(() => {
    const id = scopedTarget?.paneId ?? null;
    if (id === null || id === shownPane) return;
    shownPane = id;
    const tab = tabOfPane(id);
    if (tab) focusTile(tab.id, id);
  });

  /** 정리에서 반드시 지운다 — 범위를 옮기거나 넓혔을 때 앞 타일의 색칠이 남으면 걷을 길이 없다 */
  $effect(() => {
    const target = scopedTarget;
    const re = matcher;
    if (!target) {
      pos = { index: 0, count: 0 };
      return;
    }
    target.highlight(re); // `null` 이면 창구가 알아서 지운다
    pos = target.position();
    return () => target.clear();
  });

  function step(dir: 1 | -1): void {
    const target = scopedTarget;
    if (!target) return;
    if (dir === 1) target.next();
    else target.prev();
    pos = target.position();
  }

  // ── 전체 모드 ──

  const result = $derived.by(() => {
    if (mode !== "all" || !matcher) return null;
    return scanTargets(searchTargets(), matcher);
  });

  /** 그룹 머리글은 별도 배열이 아니라 표시다 — ↑↓ 가 경계에서 안 끊기게 */
  type Row = { group: TerminalHits; hit: SearchHit; head: boolean; key: string };

  const rows = $derived.by((): Row[] => {
    const out: Row[] = [];
    for (const g of result?.groups ?? []) {
      g.hits.forEach((hit, i) => {
        out.push({ group: g, hit, head: i === 0, key: `${g.paneId}:${hit.line}:${hit.col}` });
      });
    }
    return out;
  });

  // ── 블록 모드 (`#`) ──

  /** 이름이 어디에도 없으면 빈 배열 — 조용히 전체를 훑으면 사용자가 적은 범위를 무시한다 */
  const blockTargets = $derived.by((): SearchTarget[] => {
    const s = settled.scope;
    // 간이 모드(tmux) 타일은 블록이 생기지 않아 뺀다 — 늘 0건이 "아직 못 찾았다" 로 읽힌다. 화면 검색은 거르지 않는다.
    const usable = entries.filter((e) => e.target.screenOnly !== true);
    if (s === null) return usable.map((e) => e.target);
    const one = usable.find((e) => e.label === s.name);
    return one ? [one.target] : [];
  });

  /** 판정은 거르기 전 목록으로 — 간이 모드 타일을 가리킨 것은 없는 타일이 아니라 블록이 없는 타일이다 */
  const blockScopeMissing = $derived(
    mode === "block" &&
      settled.scope !== null &&
      !entries.some((e) => e.label === settled.scope?.name),
  );

  const blockResult = $derived.by(() => {
    if (mode !== "block") return null;
    return scanBlockTargets(blockTargets, blocksOf, blockMatcher, matcher);
  });

  const blockRows = $derived(blockResult?.hits ?? []);

  const listLen = $derived(mode === "block" ? blockRows.length : rows.length);
  const sel = $derived(listLen === 0 ? -1 : Math.min(selRaw, listLen - 1));

  /** 날짜는 적지 않는다 — 이력은 세션이 사는 동안만 산다 */
  function hhmmss(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /** 없는 정보를 지어내지 않는다 */
  function exitLabel(hit: BlockHit): string {
    if (hit.running) return t("commands.search.running");
    return hit.exit === null ? "" : `exit ${hit.exit}`;
  }

  /** `{@html}` 을 쓰지 않는 이유는 머리말과 같다 — 이 문자열도 원격 출력이다 */
  function commandPieces(text: string, re: RegExp | null): Piece[] {
    if (!re) return [{ text, hit: false }];
    const out: Piece[] = [];
    let i = 0;
    for (const m of matchesInLine(text, re)) {
      if (m.col > i) out.push({ text: text.slice(i, m.col), hit: false });
      if (m.len > 0) out.push({ text: text.slice(m.col, m.col + m.len), hit: true });
      i = Math.max(i, m.col + m.len);
    }
    if (i < text.length) out.push({ text: text.slice(i), hit: false });
    return out;
  }

  /**
   * 마커가 죽었으면(스크롤백 밖 · 이관돼 옴) 없는 자리로 보내지 않고 타일만 띄운다.
   * 착지점을 한 줄 위로 — 프롬프트가 맨 윗줄에 붙으면 직전 명령 출력과의 경계가 안 읽힌다(`CommandApi.jump` 와 같다).
   */
  function jumpBlock(hit: BlockHit): void {
    const tab = tabOfPane(hit.paneId);
    if (!tab) return; // 훑은 뒤에 닫힌 타일 — 아무 일도 하지 않는다
    focusTile(tab.id, hit.paneId);

    const commands = commandsOf(hit.paneId);
    const line = commands?.lineOfBlock(hit.blockId) ?? null;
    const target = searchTarget(hit.paneId);
    if (line === null || !target) {
      showNotice(t("commands.search.blockGone"));
      onclose(); // 남길 강조가 없다 — 평범하게 닫으며 전부 지운다
      return;
    }
    if (blockMatcher) target.highlight(blockMatcher);
    target.reveal(Math.max(0, line - 1));
    // **블록 전체를 두른다** — 매치된 글자 몇 개만 색칠하면 어느 블록에 왔는지가 안 읽힌다.
    // `highlight` 뒤여야 한다: 저쪽이 앞 점프의 띠를 걷는다 (`Terminal.svelte`).
    commands?.bandBlock(hit.blockId);
    closeSearchKeeping(hit.paneId);
  }

  /** 걸러낸 뒤의 1등이 곧 Enter 의 대상이어야 한다 */
  $effect(() => {
    void full;
    selRaw = 0;
    acSelRaw = 0;
  });

  $effect(() => {
    const i = sel;
    if (i < 0 || !listEl) return;
    listEl.querySelectorAll<HTMLElement>("[data-row]")[i]?.scrollIntoView({ block: "nearest" });
  });

  /** 등록 시점이 아니라 그릴 때 푼다 */
  function tabNameOf(paneId: string): string {
    const tab = tabOfPane(paneId);
    return tab ? tabDisplayTitle(tab, t) : "";
  }

  function headerTab(paneId: string, label: string): string {
    return headerTabTitle(label, tabNameOf(paneId), residentWindowTabs().length);
  }

  type Piece = { text: string; hit: boolean };

  /** 매치 위치는 원래 줄에서 잰다 — 창을 먼저 자르면 경계에 걸친 매치가 엉뚱한 자리에 칠해진다 */
  function previewOf(hit: SearchHit, re: RegExp): { lead: boolean; tail: boolean; pieces: Piece[] } {
    const start = Math.max(0, hit.col - PREVIEW_LEAD);
    const end = Math.min(hit.text.length, start + PREVIEW_LEN);
    const slice = hit.text.slice(start, end);

    const marks = matchesInLine(hit.text, re)
      .map((m) => ({ a: m.col - start, b: m.col + m.len - start }))
      .filter((m) => m.b > 0 && m.a < slice.length)
      .map((m) => ({ a: Math.max(0, m.a), b: Math.min(slice.length, m.b) }));

    const pieces: Piece[] = [];
    let i = 0;
    for (const m of marks) {
      if (m.a > i) pieces.push({ text: slice.slice(i, m.a), hit: false });
      if (m.b > m.a) pieces.push({ text: slice.slice(m.a, m.b), hit: true });
      i = Math.max(i, m.b);
    }
    if (i < slice.length) pieces.push({ text: slice.slice(i), hit: false });
    return { lead: start > 0, tail: end < hit.text.length, pieces };
  }

  /** `onclose` 가 아니라 `closeSearchKeeping` — 저쪽은 모든 터미널의 강조를 지워 도착한 화면에서 찾은 것이 사라진다 */
  function jump(row: Row): void {
    const paneId = row.group.paneId;
    const tab = tabOfPane(paneId);
    const target = searchTarget(paneId);
    if (!tab || !target) return; // 훑은 뒤에 닫힌 타일 — 아무 일도 하지 않는다
    focusTile(tab.id, paneId);
    // 현재 매치는 **고른 그 결과**다(`at`) — 없으면 버퍼 맨 위의 첫 매치(대개 같은 글을 친 명령 줄)가 진하게 칠해진다
    if (matcher) target.highlight(matcher, { line: row.hit.line, col: row.hit.col });
    target.reveal(row.hit.line);
    closeSearchKeeping(paneId);
  }

  // ── 키 ──

  /** `bind:value` 를 쓰지 않는다 — 바인딩이 DOM 값을 다시 써 넣으면 칩으로 옮긴 자르기가 없던 일이 된다 */
  function onInput(value: string): void {
    acPinned = false; // 글자를 치기 시작하면 다시 글자가 판정의 근거다
    // **반복**해서 떼어낸다 — 한 번에 여러 토큰이 들어오는 길이 실제로 있다(붙여넣기,
    // `@web1 #build error`). 한 번만 떼면 나머지가 글자로 남아 칩과 실제 파스가 갈린다.
    let rest = value;
    for (;;) {
      const tok = tokenizeOnSpace(rest);
      if (!tok) break;
      if (tok.kind === "scope") chip = tok.chip;
      else blockChip = tok.chip;
      rest = tok.rest;
    }
    query = rest;
  }

  /** 확정 동작이라 디바운스를 기다리지 않는다 — 목록이 닫히는 순간 범위 모드로 넘어가게 */
  async function pick(label: string): Promise<void> {
    const next = applyAutocomplete(chips, label);
    apply(next);
    acPinned = false;
    debounced = composeQuery(next);
    await tick();
    inputEl?.focus();
    inputEl?.setSelectionRange(query.length, query.length);
  }

  function apply(next: ChipState): void {
    chip = next.scopeChip;
    blockChip = next.blockChip;
    query = next.text;
  }

  function dropChip(kind?: ChipKind): void {
    apply(kind === undefined ? backspaceAtStart(chips) : dropChipOf(chips, kind));
    acPinned = false;
    inputEl?.focus();
  }

  function openChipMenu(): void {
    acPinned = true;
    inputEl?.focus();
  }

  /** 맨 앞 Backspace 만 가로챈다. `Escape` 는 여기서도 닫기다 — 칩 지우기로 바꾸면 "Esc 로 닫는다" 는 앱의 관례가 갈린다 */
  function onInputKeydown(ev: KeyboardEvent): void {
    const el = ev.currentTarget as HTMLInputElement;
    const hasChip = chip !== null || blockChip !== null;
    if (ev.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0 && hasChip) {
      ev.preventDefault();
      dropChip();
    }
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 창의 Escape 사슬이 뒤이어 다른 모달까지 닫지 않게 (팔레트와 같다)
      onclose();
      return;
    }

    // 열어 둔 조합을 다시 누르면 닫힌다 — 팔레트와 같은 관례이고, 사용자가 `Ctrl+F` 를 다른
    // 조합으로 바꿔 두었어도 그대로 따라간다.
    const combo = comboFromEvent(ev);
    if (combo && combo === effectiveCombo("find", settings.current.keybindings)) {
      ev.preventDefault();
      onclose();
      return;
    }

    // 자동완성이 떠 있는 동안 Enter 는 "다음 매치" 가 아니라 **"선택"** 이다. 이름을 고르는
    // 중에 매치를 걷는 것은 뜻이 없고, 우선순위가 흔들리면 Enter 가 무슨 일을 할지 알 수 없다.
    if (acOpen && acItems.length > 0) {
      const n = acItems.length;
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        acSelRaw = (acSel + 1) % n;
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        acSelRaw = (acSel - 1 + n) % n;
        return;
      }
      if (ev.key === "Enter" || ev.key === "Tab") {
        ev.preventDefault();
        const item = acItems[acSel];
        if (item) void pick(item.label);
        return;
      }
      return;
    }

    // 범위 모드 — Enter/F3 이 다음, Shift 를 얹으면 이전. 브라우저 찾기 막대와 같은 몸짓이다.
    if (mode === "scope") {
      if (ev.key === "Enter" || ev.key === "F3") {
        ev.preventDefault();
        step(ev.shiftKey ? -1 : 1);
      }
      return;
    }

    // 목록이 있는 두 모드(전체 · 블록)는 **같은 키**로 걷는다 — 고른 뒤에 하는 일만 다르다.
    const n = listLen;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (n > 0) selRaw = (sel + 1) % n; // 끝에서 처음으로 감싼다
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (n > 0) selRaw = (sel - 1 + n) % n;
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (mode === "block") {
        const hit = blockRows[sel];
        if (hit) jumpBlock(hit);
      } else {
        const row = rows[sel];
        if (row) jump(row);
      }
    }
  }
</script>

<!-- 범위 모드에서는 덮지 않는다(`.bare`) — 하이라이트된 타일이 보여야 한다 -->
<div
  class="overlay"
  class:bare
  role="presentation"
  onmousedown={(ev) => {
    if (ev.target === ev.currentTarget) onclose();
  }}
>
  <div
    class="panel glass-raised"
    class:bare
    role="dialog"
    aria-modal="true"
    aria-label={t("commands.search.aria")}
    tabindex="-1"
    onkeydown={onKeydown}
  >
    <div class="qrow">
      <!-- 칩 본체와 × 는 형제다 — 중첩 interactive 를 피하고, `<button>` 의 `role="button"` 은 redundant-role 로 잡혀 `span` + `role` 이다 -->
      <div class="field">
        {#if chip !== null}
          <span class="chip" data-chip="scope">
            <span
              class="chip-body"
              role="button"
              tabindex="0"
              aria-label={t("commands.search.chip.scope.aria", { name: chip })}
              onclick={openChipMenu}
              onkeydown={(ev) => {
                // 처리한 키는 **버블까지 끊는다.** `preventDefault` 는 기본 동작만 막을 뿐이라
                // 같은 이벤트가 `.panel` 의 onKeydown 으로 올라가는데, 거기서는 방금 켜진
                // `acOpen` 때문에 Enter 가 "후보 선택" 으로 읽혀 목록 첫 터미널로 범위가 조용히
                // 바뀐다 (마우스로는 지나지 않는 길이라 화면에 흔적이 없다 — menu-runner 절과
                // 같은 종류의 함정이다).
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  ev.stopPropagation();
                  openChipMenu();
                } else if (ev.key === "Backspace" || ev.key === "Delete") {
                  ev.preventDefault();
                  ev.stopPropagation();
                  dropChip("scope");
                }
              }}
            >@{chip}</span
            >
            <span
              class="chip-x"
              role="button"
              tabindex="-1"
              aria-label={t("commands.search.chip.scope.remove", { name: chip })}
              onclick={() => dropChip("scope")}
              onkeydown={(ev) => {
                // 위 칩 본체와 같은 이유로 버블까지 끊는다 (패널 핸들러의 Enter 가지)
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  ev.stopPropagation();
                  dropChip("scope");
                }
              }}><UiIcon name="close" size={11} /></span
            >
          </span>
        {/if}
        {#if blockChip !== null}
          <span class="chip block" data-chip="block">
            <span
              class="chip-body"
              role="button"
              tabindex="0"
              aria-label={t("commands.search.chip.block.aria", { name: blockChip })}
              onclick={() => inputEl?.focus()}
              onkeydown={(ev) => {
                if (ev.key === "Backspace" || ev.key === "Delete") {
                  ev.preventDefault();
                  ev.stopPropagation();
                  dropChip("block");
                }
              }}
            >#{blockChip}</span
            >
            <span
              class="chip-x"
              role="button"
              tabindex="-1"
              aria-label={t("commands.search.chip.block.remove", { name: blockChip })}
              onclick={() => dropChip("block")}
              onkeydown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  ev.stopPropagation();
                  dropChip("block");
                }
              }}><UiIcon name="close" size={11} /></span
            >
          </span>
        {/if}
        <input
          class="q"
          type="text"
          bind:this={inputEl}
          value={query}
          oninput={(ev) => onInput(ev.currentTarget.value)}
          onkeydown={onInputKeydown}
          placeholder={chip === null
            ? t("commands.search.placeholder.all")
            : t("commands.search.placeholder.scoped")}
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          aria-label={t("commands.search.input.aria")}
        />
      </div>
      {#if mode === "scope" && scoped}
        <span class="count" class:none={pos.count === 0}>
          {pos.count === 0 ? "0" : `${pos.index}/${pos.count}`}
        </span>
      {/if}
    </div>

    {#if acOpen}
      <!-- 충돌 구분 번호가 붙은 그대로 보여 준다 — 그래야 `@bash/2` 라는 이름을 배운다 -->
      <div class="results">
        {#if acItems.length === 0}
          <p class="empty">{t("commands.search.ac.empty")}</p>
        {:else}
          {#each acItems as item, i (item.target.paneId)}
            <button
              type="button"
              class="row"
              class:sel={i === acSel}
              onmouseenter={() => (acSelRaw = i)}
              onclick={() => void pick(item.label)}
            >
              <span class="label mono">{item.label}</span>
              <span class="tail">{tabNameOf(item.target.paneId)}</span>
            </button>
          {/each}
        {/if}
      </div>
    {:else if regexBroken}
      <p class="msg err">{t("commands.search.regexBroken")}</p>
    {:else if mode === "block"}
      <!-- 타일별로 묶지 않는다 — 여러 타일을 가로질러 가장 최근에 돌린 명령이 위에 와야 한다 -->
      {#if blockScopeMissing}
        <p class="msg muted">{t("commands.search.noTerminal")}</p>
      {:else}
        <div class="results" bind:this={listEl}>
          {#if blockRows.length === 0}
            <p class="empty">{t("commands.search.blocks.empty")}</p>
          {:else}
            {#each blockRows as hit, i (`${hit.paneId}:${hit.blockId}`)}
              <button
                type="button"
                data-row
                class="row"
                class:sel={i === sel}
                onmouseenter={() => (selRaw = i)}
                onclick={() => jumpBlock(hit)}
              >
                <span class="blk">
                  <span class="blkhead">
                    <span class="mono name">{hit.label}</span>
                    <span class="ws">· {hhmmss(hit.startedAt)}</span>
                    {#if exitLabel(hit)}
                      <span class="ws" class:bad={!hit.running && hit.exit !== 0}>
                        · {exitLabel(hit)}
                      </span>
                    {/if}
                    <span class="line mono"
                      >· {#each commandPieces(hit.commandLine, blockMatcher) as p, pi (pi)}<span
                          class="piece"
                          class:mark={p.hit}>{p.text}</span
                        >{/each}</span
                    >
                  </span>
                  {#if hit.cwd}
                    <span class="cwd mono">{hit.cwd}</span>
                  {/if}
                </span>
              </button>
            {/each}
            {#if blockResult?.truncated}
              <p class="empty">{t("commands.search.truncated", { limit: HITS_TOTAL })}</p>
            {/if}
          {/if}
        </div>
      {/if}
    {:else if mode === "scope"}
      {#if !scoped}
        <p class="msg muted">{t("commands.search.noTerminal")}</p>
      {/if}
    {:else if matcher}
      <div class="results" bind:this={listEl}>
        {#if rows.length === 0}
          <p class="empty">{t("commands.search.empty")}</p>
        {:else}
          {#each rows as row, i (row.key)}
            {#if row.head}
              {@const ws = headerTab(row.group.paneId, row.group.label)}
              <p class="section">
                <span class="mono">{row.group.label}</span>
                {#if ws}
                  <span class="ws">· {ws}</span>
                {/if}
                <span class="ws">
                  · {row.group.truncated
                    ? t("commands.search.group.countMore", {
                        count: row.group.hits.length,
                        limit: HITS_PER_TERMINAL,
                      })
                    : t("commands.search.group.count", { count: row.group.hits.length })}
                </span>
              </p>
            {/if}
            {@const pv = previewOf(row.hit, matcher)}
            <button
              type="button"
              data-row
              class="row"
              class:sel={i === sel}
              onmouseenter={() => (selRaw = i)}
              onclick={() => jump(row)}
            >
              <span class="line mono">
                {#if pv.lead}…{/if}<!--
                  조각 배열을 그대로 그린다 — `{@html}` 은 여기서 곧바로 XSS 다 (머리말).
                -->{#each pv.pieces as p, pi (pi)}<span
                    class="piece"
                    class:mark={p.hit}>{p.text}</span
                  >{/each}{#if pv.tail}…{/if}
              </span>
            </button>
          {/each}
          {#if result?.truncated}
            <p class="empty">{t("commands.search.truncated", { limit: HITS_TOTAL })}</p>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- 문구 사이에 `<code>` 가 끼어 마크업에 맞춰 키를 쪼갰다 — 문자열에 HTML 을 넣지 않는다 -->
    <p class="hint">
      <code>{t("commands.search.hint.at")}</code>{t("commands.search.hint.scope")}<code>/re</code>
      <code>/case</code>
      <code>/word</code>
      {t("commands.search.hint.options")}<code>{t("commands.search.hint.hash")}</code>{t(
        "commands.search.hint.block",
      )}<code>{t("commands.search.hint.quoted")}</code>{t("commands.search.hint.literal")}
    </p>
  </div>
</div>

<style>
  /* 팔레트와 같은 덮개·같은 자리 (`CommandPalette.svelte` 의 `.overlay`) */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 12vh 16px 16px;
    background: var(--bg-overlay);
  }

  .overlay.bare {
    padding: 6vh 16px 16px;
    background: transparent;
  }

  .panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 560px;
    max-height: 70vh;
    padding: 10px;
    /* 판 자신은 굴리지 않는다(목록은 `.results` 가 굴린다) — 흐림 판(`::before`)이 내용과 함께 굴러가지 않게 */
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--border);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-modal);
  }

  .panel.bare {
    max-width: 420px;
  }

  .qrow {
    display: flex;
    align-items: center;
    gap: var(--gap);
  }

  /* `input.q` 셀렉터는 그대로 둔다 — 그 이름으로 찾는 코드가 있다 */
  .field {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--surface-field); /* 필드의 우물 — 대화 상자의 입력 칸과 같은 면 */
    border: 1px solid var(--border);
    border-radius: 999px;
  }

  .field:focus-within {
    border-color: var(--accent);
  }

  .q {
    flex: 1 1 auto;
    min-width: 0;
    padding: 4px 4px;
    font-family: var(--font-ui);
    font-size: 14px;
    color: var(--fg);
    background: none;
    border: 0;
    outline: none;
  }

  .chip {
    display: inline-flex;
    flex: 0 0 auto;
    max-width: 55%;
    align-items: center;
    gap: 2px;
    padding: 1px 4px 1px 8px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: 999px;
    -webkit-backdrop-filter: blur(6px) saturate(1.2);
    backdrop-filter: blur(6px) saturate(1.2);
    transition: background-color 0.12s ease;
  }

  .chip:hover,
  .chip:has(:focus-visible) {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
  }

  .chip.block {
    background: color-mix(in srgb, var(--warn) 18%, transparent);
    border-color: color-mix(in srgb, var(--warn) 35%, transparent);
  }

  .chip.block:hover,
  .chip.block:has(:focus-visible) {
    background: color-mix(in srgb, var(--warn) 28%, transparent);
  }

  .chip-body {
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 18px;
    color: var(--fg);
    text-shadow: 0 0 1px rgb(0 0 0 / 25%);
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  /* `UiIcon` 은 `display:block` 이라 글자처럼 가운데에 서지 않는다 — flex 상자로 잡는다 */
  .chip-x {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--fg-chip);
    border-radius: 999px;
    cursor: pointer;
    transition: color 0.12s ease;
  }

  .chip-x:hover {
    color: var(--fg);
  }

  .chip-body:focus-visible,
  .chip-x:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }

  @media (prefers-reduced-motion: reduce) {
    .chip,
    .chip-x {
      transition: none;
    }
  }

  .count {
    flex: 0 0 auto;
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-chip);
    background: var(--bg-chip);
    border-radius: var(--radius);
    line-height: 22px;
  }

  .count.none {
    color: var(--fg-muted);
  }

  .results {
    flex: 1 1 auto;
    overflow-y: auto;
    margin-top: 6px;
  }

  .section {
    display: flex;
    gap: 4px;
    margin: 8px 2px 2px;
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--fg-chip);
  }

  .section .ws {
    color: var(--fg-muted);
  }

  .empty {
    margin: 12px 2px;
    font-size: 12px;
    text-align: center;
    color: var(--fg-muted);
  }

  .msg {
    margin: 8px 2px 2px;
    font-size: 12px;
  }

  .msg.err {
    color: var(--err);
  }

  .msg.muted {
    color: var(--fg-muted);
  }

  .row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 4px 8px;
    font: inherit;
    font-size: 12px;
    color: inherit;
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .row.sel {
    background: var(--bg-hover);
  }

  .label {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tail {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--fg-muted);
  }

  .line {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .blk {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    flex-direction: column;
    gap: 1px;
  }

  .blkhead {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 4px;
  }

  .blkhead .name {
    flex: 0 0 auto;
    color: var(--fg-chip);
  }

  .blkhead .ws {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--fg-muted);
  }

  .blkhead .ws.bad {
    color: var(--err);
  }

  .cwd {
    overflow: hidden;
    font-size: 11px;
    color: var(--fg-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .piece.mark {
    color: var(--fg);
    background: var(--accent-soft);
    border-radius: 2px;
  }

  .hint {
    margin: 6px 2px 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--fg-muted);
  }

  .hint code {
    font-family: var(--font-mono);
    color: var(--fg-chip);
  }
</style>
