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
   * **터미널 찾기 오버레이** — 한 줄 입력으로 열려 있는 터미널들의 버퍼를 훑는다.
   *
   * 명령 팔레트(`CommandPalette.svelte`)와 **같은 자리·같은 결**이다: 화면 위쪽에 뜨는 패널
   * 하나, `{#if}` 마운트, 질의는 이 컴포넌트의 지역 상태. 다만 찾는 것이 "앱의 기능" 이 아니라
   * **터미널 안의 글자**라 세 가지가 다르다.
   *
   * ## 네 모드 (질의 하나가 갈라진다)
   *
   *  - **전체** (`error`) — 등록된 모든 터미널을 훑어 터미널별로 묶어 보여 준다. 한 줄을
   *    고르면 그 탭으로 **점프**한다.
   *  - **범위** (`@web1 error`) — 그 터미널 하나만. 목록을 그리지 않고 xterm 위에 직접
   *    강조를 얹은 뒤 `Enter`/`F3` 로 매치 사이를 걷는다. 브라우저의 찾기 막대와 같은 몸짓이다.
   *  - **블록** (`#build` · `@web1 #build`) — 찾는 **대상 자체가 다르다**: 화면 텍스트가
   *    아니라 명령 블록(`block-history.ts`)이다. `@` 는 여전히 "어느 타일" 만 정하므로 둘은
   *    함께 쓴다 (docs/log/2026-09-08-block-search.md).
   *  - **`@` 자동완성** — 이름을 아직 치는 중이면 열린 터미널 목록이 드롭다운으로 뜬다.
   *
   * ## 왜 범위 모드에서는 화면을 덮지 않는가
   *
   * 범위 모드의 결과는 **타일 안에** 있다 — 오버레이가 아니라 xterm 이 색칠한다. 팔레트처럼
   * 어두운 백드롭을 깔고 화면 가운데를 차지하면 정작 찾은 것이 그 뒤에 가려진다. 그래서
   * 범위 모드에서는 백드롭을 **투명**하게 두고 패널을 위쪽에 작게 띄운다. 전체 모드는 반대다 —
   * 결과가 오버레이 안에 있으므로 팔레트와 똑같이 덮는다.
   *
   * ## 범위는 **칩**으로 선다 — 그런데 파서는 그대로다
   *
   * `@web1` 을 글자로 두면 사용자가 그것을 검색어의 일부로 읽고(실제로 지우다 반만 지운다),
   * 어디까지가 범위이고 어디부터가 찾는 글자인지 화면에 표시가 없다. 그래서 Slack 의 필터
   * 칩처럼 **떼어 낸 조각 하나**로 보여 준다: 필드는 `[칩][입력]` 두 칸이고 상태도 둘
   * ([`chip`] · [`query`])이다.
   *
   * 그러면서 **문법 해석은 늘리지 않았다.** 두 칸은 곧바로 [`composeQuery`] 로 다시 한 줄
   * ([`full`])이 되고, 파싱·훑기·강조는 전부 그 한 줄로만 돈다 — 질의의 진실은 여전히
   * `search-query.ts` 하나다. 칩 쪽에서 문법을 두 번째로 해석하기 시작하면 **오버레이가 세는
   * 것과 타일이 실제로 칠하는 것이 갈린다** (`buildMatcher` 가 옵션을 정규식 하나에 녹인
   * 이유와 같다). 칩이 서고 사라지는 규칙만 순수 모듈 `search-chips.ts` 에 있다.
   *
   * ## 왜 `{@html}` 이 없는가
   *
   * 매치 강조는 조각 배열(`Piece[]`)을 만들어 `{#each}` 로 그린다. 미리보기 문자열의 출처는
   * **원격 셸의 출력**이고, 그것은 이 앱에서 가장 믿을 수 없는 문자열이다 — `<img onerror=…>`
   * 를 찍는 것은 `echo` 한 줄이면 되고, 그 순간 `{@html}` 은 곧바로 XSS 다. Svelte 의 기본
   * 이스케이프를 지나가게 두는 것이 유일하게 안전한 길이다.
   */

  let {
    seed,
    onclose,
  }: {
    /**
     * 열릴 때의 칩 + 검색어 (`find` 액션이 포커스된 터미널의 **라벨을 칩으로** 넣어 준다 —
     * `keys.svelte.ts`). 문자열 한 줄이 아니라 두 칸인 이유는 위 "범위는 칩으로 선다" 절.
     */
    seed: ChipState;
    /** Escape · 바깥 클릭 · 같은 조합 재입력 — 상위가 `closeSearch()` 로 받는다 */
    onclose: () => void;
  } = $props();

  /**
   * 입력이 멎고 나서 실제로 훑기까지의 시간(ms).
   *
   * 스캔은 터미널마다 스크롤백 수만 줄을 도는 일이라 키를 누를 때마다 돌리면 입력이 끊긴다.
   * 150ms 는 "글자 사이" 보다 길고 "다 치고 기다리는 시간" 보다는 짧은 자리다.
   */
  const DEBOUNCE_MS = 150;

  /** 미리보기에서 매치 **앞**에 남기는 글자 수 (그 앞은 `…` 로 접는다) */
  const PREVIEW_LEAD = 40;
  /** 미리보기 한 줄의 총 길이 — 이보다 긴 줄은 뒤를 `…` 로 접는다 */
  const PREVIEW_LEN = 160;

  /*
   * `seed` 는 **열릴 때 한 번**만 뜻이 있다 — 오버레이는 `{#if}` 로 새로 마운트되므로 열 때마다
   * 이 초기화가 다시 돈다. 뒤늦게 바뀌어도 따라가면 안 된다(사용자가 치던 질의를 덮어쓴다).
   * `untrack` 은 그 뜻을 컴파일러에게도 말해 준다 (`state_referenced_locally` 경고).
   */
  /** 칩으로 서 있는 범위 이름 (`null` = 전체). `@` 도 따옴표도 붙어 있지 않다 */
  let chip = $state<string | null>(untrack(() => seed.scopeChip));
  /** 칩으로 서 있는 `#` 의 항 (`null` = 블록 검색이 아니다). `@` 와 **다른 축**이다 */
  let blockChip = $state<string | null>(untrack(() => seed.blockChip));
  /** 입력칸의 글자 — **검색어(와 아직 칩이 아닌 옵션 토큰)뿐**이다 */
  let query = $state(untrack(() => seed.text));
  /** 디바운스가 끝난 **합성** 질의 — 훑기·강조는 오직 이 값으로 돈다 */
  let debounced = $state(untrack(() => composeQuery(seed)));
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  /**
   * **칩을 눌러** 자동완성을 연 상태.
   *
   * 평소의 드롭다운은 "이름을 치는 중" 이라는 글자 모양으로 판정되는데, 칩이 서 있으면 그
   * 글자가 입력칸에 없다 — 그래서 범위를 **바꾸려고** 칩을 눌렀을 때는 판정할 근거가 없다.
   * 기억 한 칸이 그 자리를 대신하고, 사용자가 글자를 치는 순간 내려간다(그때부터는 글자가
   * 다시 근거가 된다).
   */
  let acPinned = $state(false);

  /** 화면에 보이는 칸들을 합친 **한 줄** — 파싱·훑기·강조가 전부 이 값으로 돈다 (머리말) */
  const chips = $derived<ChipState>({ scopeChip: chip, blockChip, text: query });
  const full = $derived(composeQuery(chips));

  /** 전체 모드 목록의 하이라이트 (팔레트와 같이 **읽을 때** 죈다 — [`sel`]) */
  let selRaw = $state(0);
  /** 자동완성 드롭다운의 하이라이트 */
  let acSelRaw = $state(0);

  /** 범위 모드의 "n/총" — [`next`]·[`prev`] 뒤에 창구에서 다시 읽는다 */
  let pos = $state<{ index: number; count: number }>({ index: 0, count: 0 });

  /**
   * 열리는 순간 입력으로. **`select()` 하지 않는다** — 팔레트와 갈리는 유일한 자리다.
   *
   * `Ctrl+F` 로 들어오면 범위는 **칩**으로 서 있고 입력칸은 비어 있다 — 곧바로 검색어를 치라는
   * 뜻이다. 칩을 버리고 전체로 넓히려면 맨 앞에서 Backspace 한 번이면 된다([`onInputKeydown`]).
   * 커서를 끝에 놓는 것은 열자마자 다시 여는 경우(글자가 남아 있다)를 위한 것이다.
   */
  $effect(() => {
    const el = inputEl;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });

  /** 입력 → 150ms → [`debounced`]. 담는 것은 **합성 질의 한 줄**이다. 언마운트에 타이머도 죽는다 */
  $effect(() => {
    const q = full;
    const id = setTimeout(() => {
      debounced = q;
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  });

  /** 지금 치고 있는 그대로의 해석 — **모드 판정**은 디바운스를 기다리지 않는다 */
  const live = $derived(parseSearchQuery(full));
  /** 디바운스가 끝난 해석 — **훑기·강조**는 이쪽이다 */
  const settled = $derived(parseSearchQuery(debounced));
  const matcher = $derived(buildMatcher(settled));
  /** `#` 의 항으로 만든 매처. `null` = 거르지 않는다(= `#` 하나만 쳤다) 또는 깨진 정규식 */
  const blockMatcher = $derived(buildBlockMatcher(settled));

  /**
   * `/re` 를 켰는데 정규식이 잘못된 상태.
   *
   * [`buildMatcher`] 는 빈 검색어와 깨진 정규식을 **똑같이 `null`** 로 돌려준다(반쯤 친 질의가
   * 매 키 입력마다 예외를 던지지 않게). 그래서 "아무것도 안 쳤다" 와 "쳤는데 틀렸다" 를 여기서
   * 다시 가른다 — 앞쪽은 조용해야 하고 뒤쪽은 말해 줘야 한다. `#` 의 항도 같은 규칙을 탄다.
   */
  const regexBroken = $derived(
    settled.options.regex &&
      ((settled.text !== "" && matcher === null) ||
        (settled.block !== null && settled.block !== "" && blockMatcher === null)),
  );

  /**
   * 범위 이름을 **아직 치는 중**인가 (= 자동완성을 띄울 때).
   *
   * 마지막 `@` 뒤에 공백이 아직 없으면 치는 중이다. 따옴표로 열었으면 **닫는 따옴표**가
   * 나오기 전까지가 치는 중이고(`@"my te`), 그래야 공백이 든 이름도 끝까지 고를 수 있다.
   */
  function stillTyping(raw: string): boolean {
    const at = raw.lastIndexOf("@");
    if (at === -1) return false;
    const rest = raw.slice(at + 1);
    if (rest.startsWith('"')) return rest.indexOf('"', 1) === -1;
    return !/\s/.test(rest);
  }

  /**
   * `@` 자동완성이 열려 있는가.
   *
   * 판정의 재료는 **입력칸의 글자뿐**이다 — 합성 질의([`full`])를 보면 칩이 서 있는 동안
   * 언제나 범위 토큰이 있으므로 드롭다운이 영원히 뜬다. 칩을 눌러서 여는 길만 별도
   * 기억([`acPinned`])으로 얹는다. (`@` 하나만 친 상태도 포함 — 그때는 후보를 전부 보여 준다.)
   */
  const typed = $derived(parseSearchQuery(query));
  const acOpen = $derived(
    acPinned ||
      (typed.scope?.kind === "terminal" && (typed.scope.name === "" || stillTyping(query))),
  );

  /**
   * 화면 하나에 모드가 하나다 — 자동완성이 가장 세다 (이름을 고르는 중엔 훑을 것이 없다).
   *
   * `#` 가 `@` 를 이기는 것은 **축이 다르기 때문**이지 last-wins 여서가 아니다: `@` 는 "어느
   * 타일" 을, `#` 는 "무엇을 찾는가" 를 정하므로 모드를 가르는 것은 언제나 `#` 쪽이고 `@` 는
   * 그 안에서 대상을 좁힌다 (`@web1 #build` = web1 의 build 블록).
   */
  const mode = $derived.by((): "ac" | "block" | "scope" | "all" => {
    if (acOpen) return "ac";
    if (live.block !== null) return "block";
    return live.scope === null ? "all" : "scope";
  });

  /** 백드롭을 덮지 않는 모드 — 결과가 **타일 안에** 있는 경우다 (머리말) */
  const bare = $derived(mode === "scope");

  /**
   * 지금 등록된 창구들과 **충돌 구분 라벨**.
   *
   * `void full` 로 매 입력마다 다시 읽는다 — 레지스트리는 룬 상태가 아니라 평범한 `Map` 이라
   * 스스로 무효화를 알리지 않는다. 값이 싸서(이름 호출 + 번호 매기기) 매 키 입력에 물어도 된다.
   * 대신 **훑기**는 절대 여기 매달지 않는다 — 그러면 디바운스가 무의미해진다.
   */
  const entries = $derived.by((): { target: SearchTarget; label: string }[] => {
    void full;
    const targets = searchTargets();
    const labels = disambiguateNames(targets.map((tg) => tg.name()));
    return targets.map((tg, i) => ({ target: tg, label: labels[i] }));
  });

  /**
   * 자동완성 후보 — 접두사 일치를 부분 일치보다 위에 놓는다 (친 조각이 이름의 머리인 게 흔하다).
   *
   * 칩을 눌러 연 경우([`acPinned`])는 거를 조각이 없다 = **전부** 보여 준다. 범위를 바꾸려고
   * 연 목록에서 지금 칩의 이름으로 걸러 봐야 고를 것이 하나뿐이다.
   */
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

  /** 범위 모드가 가리키는 창구 — **라벨 완전 일치**다 (`@bash` 와 `@bash/2` 는 다른 타일이다) */
  const scoped = $derived.by(() => {
    const s = live.scope;
    if (mode !== "scope" || s?.kind !== "terminal") return null;
    return entries.find((e) => e.label === s.name) ?? null;
  });

  /**
   * 창구 객체는 레지스트리 `Map` 의 값 그대로라 **동일성이 안정**하다 ([`entries`] 가 매
   * 입력마다 새 배열을 만들어도 이 값은 그대로). 아래 강조 효과가 키 입력마다 지웠다 칠하는
   * 헛일을 하지 않는 것은 그 덕이다.
   */
  const scopedTarget = $derived(scoped?.target ?? null);

  /**
   * 범위 모드에 **들어갈 때 한 번** 그 타일을 활성으로 만든다.
   *
   * 비활성 탭의 타일도 마운트는 살아 있어(`PaneHost` 의 `display:none`) 버퍼를
   * 훑는 데는 문제가 없지만, `display:none` 인 동안에는 렌더러가 멎어 있어 **강조가 보이지
   * 않는다**. 찾아 놓고 못 보여 주면 범위 모드는 아무 일도 안 한 것과 같다.
   *
   * 기억을 룬 상태가 아니라 평범한 변수에 둔다 — 화면에 쓰이지 않고, `$state` 로 두면 이
   * 효과가 자기가 쓴 값을 다시 읽어 스스로를 깨운다.
   */
  let shownPane: string | null = null;
  $effect(() => {
    const id = scopedTarget?.paneId ?? null;
    if (id === null || id === shownPane) return;
    shownPane = id;
    const tab = tabOfPane(id);
    if (tab) focusTile(tab.id, id);
  });

  /**
   * 범위 모드의 실시간 강조. 정리에서 **반드시 지운다** — 범위를 `@a` 에서 `@b` 로 옮기거나
   * 전체 모드로 넓혔을 때 앞 타일의 색칠이 남으면 사용자가 그것을 걷을 길이 없다.
   */
  $effect(() => {
    // 이름이 `t` 가 아닌 이유: 이 파일은 문구 창구 `t()` 를 들여온다 (가려지면 헷갈린다).
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

  /** 범위 모드의 걸음 — 걷고 나서 위치를 **다시 읽는다**(창구만 아는 값이다) */
  function step(dir: 1 | -1): void {
    const target = scopedTarget;
    if (!target) return;
    if (dir === 1) target.next();
    else target.prev();
    pos = target.position();
  }

  // ---------------------------------------------------------------------------
  // 전체 모드
  // ---------------------------------------------------------------------------

  /**
   * 전체 훑기. 의존은 **[`matcher`] 와 [`mode`] 뿐**이라 디바운스가 끝난 뒤에만 돈다
   * (`searchTargets()` 는 안에서 부른다 — 룬 상태가 아니므로 의존이 생기지 않는다).
   */
  const result = $derived.by(() => {
    if (mode !== "all" || !matcher) return null;
    return scanTargets(searchTargets(), matcher);
  });

  /** 목록 한 줄 — 그룹 머리글은 **별도 배열이 아니라 표시**다 (↑↓ 가 경계에서 안 끊기게) */
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

  // ---------------------------------------------------------------------------
  // 블록 모드 (`#`) — docs/log/2026-09-08-block-search.md
  // ---------------------------------------------------------------------------

  /**
   * `#` 가 훑을 대상 — `@` 가 있으면 **그 타일 하나로 좁힌다**.
   *
   * 라벨 완전 일치인 것은 범위 모드와 같다(`@bash` 와 `@bash/2` 는 다른 타일이다). 이름이
   * 어디에도 없으면 빈 배열이고, 화면은 "그런 터미널이 없습니다" 를 띄운다 — 조용히 전체를
   * 훑으면 사용자가 적은 범위를 무시하는 셈이 된다.
   */
  const blockTargets = $derived.by((): SearchTarget[] => {
    const s = settled.scope;
    // **화면만 있는 타일(tmux · 간이 모드)은 여기서 빠진다** — 블록이 영영 생기지 않으므로
    // 훑어 봐야 늘 0건이고, 그 0건이 "이 타일엔 없다"(사실)가 아니라 "아직 못 찾았다"(오해)로
    // 읽힌다 (docs/log/2026-09-16-tmux-toggle.md). **화면 검색은 그대로 대상**이다 —
    // 그쪽은 `searchTargets()` 를 거르지 않는다(버퍼는 여느 타일과 똑같이 있다).
    const usable = entries.filter((e) => e.target.screenOnly !== true);
    if (s === null) return usable.map((e) => e.target);
    const one = usable.find((e) => e.label === s.name);
    return one ? [one.target] : [];
  });

  /**
   * `@` 를 적었는데 **그런 타일이 없다** (블록 모드의 빈 결과와 구분해 말해 준다).
   *
   * 판정은 **거르기 전의 목록**(`entries`)으로 한다 — 이름이 간이 모드 타일을 가리킨 것은
   * "없는 타일" 이 아니라 "블록이 없는 타일" 이라 0건이 맞는 답이다.
   */
  const blockScopeMissing = $derived(
    mode === "block" &&
      settled.scope !== null &&
      !entries.some((e) => e.label === settled.scope?.name),
  );

  /**
   * 블록 훑기. 의존은 디바운스가 끝난 [`settled`] 계열뿐이라 키를 칠 때마다 돌지 않는다.
   *
   * 규칙 둘 (`scanBlockTargets` 머리말과 같은 말):
   * - `#` 의 항은 **명령줄**(과 부차적으로 **cwd**)에 맞춰 본다.
   * - 뒤에 검색어가 더 있으면 고른 블록들의 **출력 발췌**를 그것으로 다시 거른다.
   */
  const blockResult = $derived.by(() => {
    if (mode !== "block") return null;
    return scanBlockTargets(blockTargets, blocksOf, blockMatcher, matcher);
  });

  const blockRows = $derived(blockResult?.hits ?? []);

  /** 지금 모드의 목록 길이 — 선택 인덱스와 키 처리가 이 하나를 본다 */
  const listLen = $derived(mode === "block" ? blockRows.length : rows.length);
  const sel = $derived(listLen === 0 ? -1 : Math.min(selRaw, listLen - 1));

  /** 결과 줄의 시각 — 날짜는 적지 않는다 (이력은 세션이 사는 동안만 산다) */
  function hhmmss(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /** 결과 줄의 상태 칸 — 없는 정보를 지어내지 않는다 (`exit` 가 `null` 이면 빈칸) */
  function exitLabel(hit: BlockHit): string {
    if (hit.running) return t("commands.search.running");
    return hit.exit === null ? "" : `exit ${hit.exit}`;
  }

  /**
   * 명령줄을 조각 배열로 — `#` 의 항이 맞은 자리를 강조한다.
   *
   * [`previewOf`] 와 달리 창을 자르지 않는다: 명령줄은 대개 한 줄에 들어가고, 넘치면 CSS 가
   * 말줄임으로 접는다. `{@html}` 을 안 쓰는 이유는 머리말과 같다 (이 문자열도 원격 출력이다).
   */
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
   * 블록 하나로 **점프**한다 — 그 타일을 띄우고, 블록이 시작한 프롬프트 줄로 스크롤한다.
   *
   * 줄 번호는 `CommandApi.lineOfBlock` 이 준다. 이력은 마커를 들지 않으므로(직렬화·이관을
   * 위해) 그 답을 아는 것은 xterm 마커를 쥔 `shell-integration` 뿐이다.
   *
   * **마커가 죽었으면**(스크롤백 밖으로 밀렸다 · 다른 창으로 이관돼 왔다) 없는 자리로 보내지
   * 않는다: 타일만 띄우고 한 줄로 알린다. 그래도 블록 자체는 이력에 남아 있어 목록에는
   * 계속 보인다 — 그것이 "발췌만 남았습니다" 라는 문구의 뜻이다.
   *
   * 착지점을 한 줄 위로 잡는 것은 명령 점프(`CommandApi.jump`)와 같은 이유다 — 프롬프트가
   * 맨 윗줄에 딱 붙으면 그 위 직전 명령의 출력 끝이 안 보여 경계가 읽히지 않는다.
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

  /** 질의가 바뀌면 두 선택 모두 맨 위로 — 걸러낸 뒤의 1등이 곧 Enter 의 대상이어야 한다 */
  $effect(() => {
    void full;
    selRaw = 0;
    acSelRaw = 0;
  });

  /** 하이라이트가 목록 밖으로 나가지 않게 따라 스크롤한다 (팔레트와 같은 배선) */
  $effect(() => {
    const i = sel;
    if (i < 0 || !listEl) return;
    listEl.querySelectorAll<HTMLElement>("[data-row]")[i]?.scrollIntoView({ block: "nearest" });
  });

  /** 그 패널이 지금 **어느 탭에 있는가** — 등록 시점이 아니라 그릴 때 푼다 */
  function tabNameOf(paneId: string): string {
    const tab = tabOfPane(paneId);
    return tab ? tabDisplayTitle(tab, t) : "";
  }

  /**
   * 결과 그룹 머리글에 붙일 탭 제목 (감출 때는 `""`).
   *
   * 규칙은 순수 함수 [`headerTabTitle`] 에 있고 여기서는 재료 셋만 모은다. 탭
   * 자동 제목이 **타일 이름들을 이어 붙인 것**이라 그냥 붙이면 `로컬 · 로컬 · 4개` 가 된다 —
   * 위 [`tabNameOf`] 을 자동완성에서는 그대로 쓰고 여기서만 이 필터를 거치는 이유는, 저쪽은
   * 같은 이름의 타일 중 하나를 **고르는** 화면이라 겹쳐 보여도 구분에 쓰이기 때문이다.
   */
  function headerTab(paneId: string, label: string): string {
    return headerTabTitle(label, tabNameOf(paneId), residentWindowTabs().length);
  }

  /** 미리보기 한 조각 (`hit` 이면 강조해서 그린다) */
  type Piece = { text: string; hit: boolean };

  /**
   * 긴 줄을 매치 주변으로 잘라 조각 배열로 만든다.
   *
   * 매치 위치는 **잘라낸 조각이 아니라 원래 줄**에서 다시 잰다 — 창을 먼저 자르고 그 안에서
   * 찾으면 창 경계에 걸친 매치가 반 토막 난 채로 다시 맞아 엉뚱한 자리가 칠해진다.
   */
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

  /**
   * 결과 한 줄로 **점프**한다 — 탭을 바꾸고, 강조를 얹고, 그 줄로 스크롤한다.
   *
   * 닫을 때 [`onclose`](= `closeSearch`)가 아니라 [`closeSearchKeeping`] 을 쓴다. 저쪽은 열려
   * 있던 **모든** 터미널의 강조를 지우는데, 그러면 방금 찾아 도착한 화면에서 정작 무엇을
   * 찾았는지가 사라진다 — 점프의 목적이 통째로 무너진다. 그래서 도착한 타일 하나만 남긴다.
   */
  function jump(row: Row): void {
    const paneId = row.group.paneId;
    const tab = tabOfPane(paneId);
    const target = searchTarget(paneId);
    if (!tab || !target) return; // 훑은 뒤에 닫힌 타일 — 아무 일도 하지 않는다
    focusTile(tab.id, paneId);
    if (matcher) target.highlight(matcher);
    target.reveal(row.hit.line);
    closeSearchKeeping(paneId);
  }

  // ---------------------------------------------------------------------------
  // 키
  // ---------------------------------------------------------------------------

  /**
   * 입력칸이 바뀔 때마다 — **공백을 치는 순간 칩이 선다**.
   *
   * `bind:value` 를 쓰지 않는 이유가 여기 있다: 여기서 글자를 잘라 칩으로 옮기는데, 바인딩의
   * 핸들러가 뒤이어 DOM 값을 다시 써 넣으면 그 자르기가 없던 일이 된다. 값은 이벤트에서 직접
   * 읽고 상태는 이 함수 하나가 정한다.
   */
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

  /**
   * 자동완성에서 하나를 고른다 — 라벨을 **칩으로 세우고** 치던 `@조각`은 글자에서 걷는다
   * ([`applyAutocomplete`]). 앞에 이미 친 토큰(`/re` 등)은 남는다.
   *
   * 고르는 것은 사용자의 **확정 동작**이라 디바운스를 기다리지 않고 곧바로 반영한다 — 그래야
   * 목록이 닫히는 순간 범위 모드로 넘어간다.
   */
  async function pick(label: string): Promise<void> {
    const next = applyAutocomplete(chips, label);
    apply(next);
    acPinned = false;
    debounced = composeQuery(next);
    await tick();
    inputEl?.focus();
    inputEl?.setSelectionRange(query.length, query.length);
  }

  /** 순수 모듈이 낸 다음 상태를 이 컴포넌트의 세 칸에 옮겨 담는다 */
  function apply(next: ChipState): void {
    chip = next.scopeChip;
    blockChip = next.blockChip;
    query = next.text;
  }

  /**
   * 칩을 뗀다 — 글자는 그대로 두고 그 축만 넓어진다.
   *
   * `kind` 를 주면 그 칩(× 버튼 · 칩 위의 Backspace), 안 주면 **캐럿 앞의 것**(맨 앞
   * Backspace)이다. 어느 것이 캐럿 앞인가는 `backspaceAtStart` 가 안다.
   */
  function dropChip(kind?: ChipKind): void {
    apply(kind === undefined ? backspaceAtStart(chips) : dropChipOf(chips, kind));
    acPinned = false;
    inputEl?.focus();
  }

  /** 칩 본체를 누르면 범위를 **바꾸는** 드롭다운이 열린다 (지우는 것은 × 와 Backspace 다) */
  function openChipMenu(): void {
    acPinned = true;
    inputEl?.focus();
  }

  /**
   * 입력칸의 키 — **맨 앞에서의 Backspace 만** 여기서 가로챈다.
   *
   * 칩은 글자가 아니라 앞에 놓인 조각이므로, 캐럿이 0 일 때의 지우기는 "그 앞의 것" 인 칩을
   * 향한다(브라우저 검색창·메일 수신인 칸과 같은 몸짓). 선택 영역이 있으면 그건 글자를 지우는
   * 몸짓이라 건드리지 않는다. `Escape` 는 여기서도 **오버레이 닫기** 그대로다 — 칩만 지우는
   * 뜻으로 바꾸면 "Esc 로 닫는다" 는 이 앱 전체의 관례가 이 화면에서만 갈린다.
   */
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

<!--
  바깥을 누르면 닫는다. 팔레트와 같은 `.overlay` 층위지만, **범위 모드에서는 덮지 않는다**
  (`.bare` — 위 머리말). 하이라이트된 타일이 보여야 하기 때문이다.
-->
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
      <!--
        `[칩][입력]` 합성 필드 — 테두리·포커스 링은 감싸는 `.field` 가 그린다(`:focus-within`).
        칩 본체와 × 는 **형제**다: 중첩 interactive 를 만들지 않으려는 것이고, `<button>` 에
        `role="button"` 을 적으면 svelte 가 redundant-role 로 잡으므로 `span` + `role` 이다.
      -->
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
          <!--
            `#` 칩 — 범위 칩과 **같은 모양**이다(색만 다르다). 다른 축이라는 사실은 글머리
            기호(`#`)와 색이 말하고, 몸짓은 하나로 배운다. 누를 자동완성이 없어 본체를 눌러도
            드롭다운이 열리지 않는다 — 그래서 본체 클릭은 그냥 입력칸 포커스다.
          -->
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
        <!-- 범위 모드의 "n/총" — 목록 대신 이 한 칸이 결과를 말한다 -->
        <span class="count" class:none={pos.count === 0}>
          {pos.count === 0 ? "0" : `${pos.index}/${pos.count}`}
        </span>
      {/if}
    </div>

    {#if acOpen}
      <!--
        `@` 자동완성 — 충돌 구분 번호가 **붙은 그대로** 보여 준다. 그래야 같은 이름이 둘일 때
        `@bash/2` 라는 이름이 있다는 것을 여기서 배우고 다음부터는 바로 칠 수 있다.
      -->
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
      <!--
        블록 결과 — 한 줄이 명령 하나다. 텍스트 결과처럼 타일별로 묶지 않는 이유는 정렬 기준이
        **시각**이라서다: 여러 타일을 가로질러 "가장 최근에 돌린 명령" 이 위에 와야 하므로
        타일 이름은 머리글이 아니라 **줄 안의 한 칸**이다.
      -->
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

    <!--
      문법 힌트 한 줄 — 문구 사이사이에 `<code>` 가 끼므로 **마크업에 맞춰 키를 쪼갰다**
      (문자열에 HTML 을 넣지 않는다 · docs/log/2026-09-17-i18n.md). 자세한 규칙(칩 지우기 ·
      `#명령` 과 `@타일` 섞기 · 맨 앞 공백)은 docs/user/shortcuts.md 의 "찾기" 절.
    -->
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

  /* 범위 모드 — 덮지 않고 위쪽에 붙는다 (결과가 타일 안에 있다) */
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
    /* 팔레트와 같은 중 층 뜬 면(10-29) — 평면은 불투명(`--surface-raised-solid` — 범위 모드는 덮개가 없어 터미널 글자
       바로 위다), 글래스는 `--glass-float` 판 + `.glass-raised` 의 흐림 · 흰 선(theme.css 재질 절). 판 자신은
       굴리지 않는다(목록은 안쪽 `.results` 가 굴린다) — 흐림 판(`::before`)이 내용과 함께 굴러가지 않게 */
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--border);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-modal);
  }

  /* 범위 모드의 패널은 작다 — 가리는 면적이 곧 못 보는 결과다 */
  .panel.bare {
    max-width: 420px;
  }

  .qrow {
    display: flex;
    align-items: center;
    gap: var(--gap);
  }

  /*
   * 테두리·배경·포커스 링은 **감싸는 쪽**에 있다 — 칩과 입력이 한 칸처럼 보여야 하기
   * 때문이다. `input.q` 셀렉터 자체는 그대로 두었다(그 이름으로 찾는 코드가 있다).
   */
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

  /* 범위 칩 — 색은 전부 토큰이라 라이트/다크와 월페이퍼 동적 테마가 저절로 따라온다.
     강조색 저알파 + 배경 블러라 뒤가 비치고, 테두리 알파로 오버레이와 분리돼 보인다 */
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

  /*
   * `#` 칩 — 같은 반투명 결에 **색만** 다르다(`--warn` 계열). 축이 다르다는 사실을 모양으로
   * 말하되, 몸짓(클릭·×·Backspace)은 범위 칩과 하나로 배우게 한다.
   */
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

  /*
   * `UiIcon` 은 `display:block` 이라 글자처럼 `line-height`·`text-align` 으로는 가운데에
   * 서지 않는다 — 16×16 상자를 flex 로 잡는다. 11px 로 줄어든 만큼 굵기는 원본 2 로 둔다
   * (칩 글자와 무게를 맞춘다).
   */
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

  /* 팔레트의 줄과 같은 감각 — 마우스 hover 와 ↑↓ 하이라이트가 **같은 표시**다 */
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

  /* 터미널 한 줄의 미리보기 — 잘라 왔으므로 더 접지 않고 넘치면 감춘다 */
  .line {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }

  .mono {
    font-family: var(--font-mono);
  }

  /* 블록 결과 한 줄 — 위는 `타일 · 시각 · 종료 · 명령줄`, 아래는 흐린 cwd */
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

  /* 0 이 아닌 종료 코드는 눈에 걸려야 한다 — 그걸 찾으려고 블록을 뒤지는 경우가 흔하다 */
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
