// 터미널 한 장의 검색 창구 — addon-search 와 질의·매치 번호·남긴 강조(`stepKept`) 상태, 창 전역 오버레이가 두드리는 `SearchTarget`.
// `Terminal.svelte` 가 옛 상태 자리에서 하나 만들고 `mount()` 가 등록(`registerSearch`)·애드온 부착(`attach`)·정리(`dispose`)를 부른다.
// 룬이 없어 평범한 `.ts` 다(`kept` 가 룬이 아닌 까닭은 아래 주석). 포커스를 잃으면 지우는 `$effect` 는 `Terminal` 에 있다.
// 현재 매치는 애드온의 데코레이션이 아니라 **이 파일이 위층(`layer: "top"`)에 따로 그린다**(`#paintActive` — 애드온이 거는 선택이 아래층을 덮는다).
import type { IBufferRange, IDisposable, Terminal } from "@xterm/xterm";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import type { ShellIntegration } from "$lib/shell-integration";
import { stepKept, type KeptEvent, type KeptState, type SearchHit, type SearchTarget } from "$lib/search-registry";
import { matchesInLine } from "$lib/search-query";
import { cellColumns } from "$lib/triggers";
import { sameRange, searchColors, selectionRows, type SearchColors } from "./search-paint";

/** 검색이 타일에서 읽는 것 — 게터라 그때그때의 값이다 */
export interface SearchHost {
  readonly term: Terminal | null;
  readonly disposed: boolean;
  /** 블록 띠(`clearBand`)를 쥔 셸 통합 — tmux 타일·마운트 전에는 `null` */
  readonly shell: ShellIntegration | null;
}

/** `SearchTarget` 중 타일이 주는 몫 — 나머지(스캔·강조·이동·남기기)는 컨트롤러가 채운다 */
export interface SearchTargetInfo {
  paneId: string;
  name: () => string;
  /** 간이 모드 — **게터로** 준다(아래 `target` 주석) */
  screenOnly: () => boolean;
}

// ---------------------------------------------------------------------------
// 터미널 검색 (addon-search) — 창 전역 오버레이가 `search-registry` 로 두드리는 창구
//
// 애드온도 상태도 **터미널과 같은 수명**이다. OSC 133·트리거와 같은 이유다 — 검색은
// 세션이 아니라 **버퍼**에 붙은 일이고, 세션이 끝나거나 재연결돼도(`startSession(true)`)
// xterm 인스턴스와 버퍼는 그대로 남는다. 그래서 세션 수명에 걸 이유가 없고, 걸면 오히려
// 재접속마다 창구가 끊겼다 붙어 그동안 오버레이가 이 타일을 못 보게 된다.
//
// 애드온을 `t.open()` **뒤에** 붙이는 이유는 WebLinks·트리거와 같다 (`attach` 주석 참고).
// ---------------------------------------------------------------------------
export class TermSearch {
  #h: SearchHost;

  constructor(h: SearchHost) {
    this.#h = h;
  }

  #search: SearchAddon | null = null;
  /**
   * 마지막 질의 — `next`/`prev` 가 되풀이할 재료다. `null` 이면 "지금 강조가 없다".
   * 애드온이 자체 캐시(`cachedSearchTerm`)를 갖지만 그건 밖에서 읽을 수 없어 따로 들고 있다.
   */
  #searchQuery: { term: string; opts: ISearchOptions } | null = null;
  /** 현재 매치 번호 — **1-기반**, 0 = 없음 (애드온의 0-기반 `resultIndex` 를 여기서 옮긴다) */
  #searchIndex = 0;
  #searchCount = 0;
  /** `onDidChangeResults` 구독 해제 — cleanup 에서 반드시 부른다 */
  #searchResults: { dispose(): void } | null = null;

  /**
   * 점프가 **일부러 남긴** 강조를 지금 들고 있는가 (`stepKept` 의 상태 한 칸).
   *
   * 룬 상태가 아니다 — 화면에 그리지 않고 오직 이 파일 안의 판단에만 쓴다 (`shownPane` 과 같은
   * 이유: `$state` 로 두면 `Terminal` 의 `$effect` 가 자기가 쓴 값을 다시 읽어 스스로를 깨운다).
   */
  #kept: KeptState = "idle";

  /** 마지막 `#searchOptions` 가 푼 색 — 위층 현재 매치(`#paintActive`)가 같은 색을 쓴다 */
  #colors: SearchColors | null = null;
  /** 위층에 그린 현재 매치(마커 · 데코레이션) — 다음 매치로 가거나 지울 때 걷는다 */
  #active: IDisposable[] = [];
  /**
   * 애드온이 현재 매치에 건 선택의 범위 — 지울 때 **지금 선택이 이것과 같을 때만** 선택을 푼다(`clearSearch`).
   * 사람이 마우스로 다른 곳을 골랐으면 범위가 달라 그 선택은 남는다.
   */
  #searchSel: IBufferRange | null = null;

  /**
   * 남긴 강조의 사건 하나를 처리한다 — 규칙은 전부 순수 함수 [`stepKept`] 에 있고 여기서는
   * 그 판정을 **실행**만 한다 (`clear` 면 지운다).
   */
  keptEvent(ev: KeptEvent): void {
    const next = stepKept(this.#kept, ev);
    this.#kept = next.state;
    if (next.clear) this.clearSearch();
  }

  /**
   * 애드온에 넘길 검색 옵션. **부를 때마다 새로 만든다** — 두 가지 이유가 있다.
   *
   * ## 1. `RegExp` 하나를 세 옵션으로 되돌리지 않는다
   *
   * `buildMatcher`(`$lib/search-query`)가 만든 정규식은 이미 세 옵션을 **소스 안에 녹여** 놓았다:
   * `/re` 가 아니면 검색어를 이스케이프해 넣고, `/word` 면 `\b(?:…)\b` 로 감싼다. 남은 것은
   * 대소문자뿐이라 플래그 `i` 로 판별한다. 그래서 애드온에는 `regex: true` + `wholeWord: false`
   * 로 주면 **뜻이 똑같다** — 소스를 다시 뜯어 원래 검색어를 복원하려 들면 두 곳이 어긋난다.
   *
   * ## 2. 색은 하드코딩하지 않고 매번 토큰에서 다시 읽는다
   *
   * 애드온은 `var(--accent)` 같은 CSS 변수를 못 받는다(데코레이션 색을 그대로 인라인 스타일로
   * 쓴다). 그래서 `getComputedStyle` 로 지금 값을 뽑아 넘기는데, `--accent`·`--accent-soft`·
   * `--border` 는 라이트/다크와 **월페이퍼 추출 동적 테마**가 모두 갈아 끼우는 토큰이다.
   * 부를 때마다 다시 읽으면 테마가 바뀌어도 **다음 검색부터 저절로 따라온다** — 마운트 때 한 번
   * 읽어 두면 테마를 바꾼 뒤의 강조만 옛 색으로 남는다.
   *
   * **면 색 둘은 불투명 `#RRGGBB` 로 풀어 넘긴다**(`searchColors` — 까닭은 `term/search-paint.ts` 머리말): 현재 매치 = `--accent`
   * 그대로 · 나머지 = `--accent` 를 **터미널 바탕에** 옅게 섞은 색. `--accent-soft` 토큰을 그대로 넘기지 않는다 — 크롬 면 위의
   * 색이라 글래스에서는 반투명 `color-mix` 식이고(xterm 이 못 받는다), 크롬 라이트 · 터미널 다크면 밝은 면이 돼 현재 매치보다 눈에 띈다.
   * 테두리 · 개요 눈금은 CSS 가 그대로 그리므로(outline · 캔버스 fillStyle) 토큰 그대로다.
   */
  #searchOptions(re: RegExp): ISearchOptions {
    const css = getComputedStyle(document.documentElement);
    const tok = (n: string, fb: string) => css.getPropertyValue(n).trim() || fb;
    const colors = searchColors(
      { accent: tok("--accent", "#22e0ff"), onAccent: tok("--on-accent", "#000000") },
      this.#h.term?.options.theme?.background,
    );
    this.#colors = colors;
    return {
      regex: true, // `re.source` 는 언제나 정규식 문법이다
      caseSensitive: !re.flags.includes("i"), // `buildMatcher` 는 무시일 때만 `i` 를 붙인다
      wholeWord: false, // `\b` 는 이미 source 안에 들어 있다
      decorations: {
        matchBackground: colors.soft,
        matchBorder: tok("--border", "#1d2740"),
        matchOverviewRuler: tok("--accent", "#22e0ff"),
        activeMatchBackground: colors.active,
        activeMatchBorder: tok("--accent", "#22e0ff"),
        activeMatchColorOverviewRuler: tok("--accent", "#22e0ff"),
      },
    };
  }

  /**
   * 버퍼(화면 + 스크롤백)를 훑어 매치 위치를 모은다. `limit` 에 닿으면 **거기서 멈춘다** —
   * 스크롤백이 수만 줄일 수 있어 끝까지 훑고 나서 자르면 상한을 둔 뜻이 사라진다.
   *
   * `translateToString(true)` 는 오른쪽 공백을 떼어 낸다. xterm 의 줄은 언제나 `cols` 칸이
   * 꽉 찬 배열이라 떼지 않으면 모든 미리보기 뒤에 공백이 수십 칸 붙고, `$` 같은 정규식이
   * 실제 글자 끝이 아니라 줄 끝(공백 뒤)에만 맞는다.
   *
   * **한계(1단계): 줄바꿈된 논리 줄은 버퍼 행 여러 개로 쪼개져 보인다.** 창보다 긴 한 줄은
   * `isWrapped` 행으로 이어지는데 여기서는 행 단위로만 보므로, 경계에 걸친 매치는 못 찾고
   * 미리보기도 잘린 조각이 된다. 그대로 두는 이유는 `reveal(line)` 이 **이 행 번호를 그대로**
   * `scrollToLine` 에 넘기기 때문이다 — 논리 줄로 합치려면 합친 줄 ↔ 행 번호 대응표를 따로
   * 들고 있어야 하고, 그건 이 기능이 실제로 쓰이는 걸 본 뒤에 붙일 일이다.
   */
  #scanBuffer(re: RegExp, limit: number): SearchHit[] {
    const t = this.#h.term;
    if (!t || this.#h.disposed || limit <= 0) return [];
    const buf = t.buffer.active;
    const out: SearchHit[] = [];
    for (let i = 0; i < buf.length; i++) {
      const text = buf.getLine(i)?.translateToString(true) ?? "";
      if (text === "") continue;
      for (const m of matchesInLine(text, re)) {
        out.push({ line: i, text, col: m.col, len: m.len });
        if (out.length >= limit) return out; // 상한에 닿았다 — 나머지 줄은 읽지도 않는다
      }
    }
    return out;
  }

  /**
   * 강조를 지우고 질의·번호를 비운다 (`clearDecorations` 는 이벤트를 쏘지 않는다 — 직접 리셋한다).
   *
   * `kept` 도 여기서 `"idle"` 로 되돌린다 — 지워진 강조는 더 이상 "남긴 것" 이 아니다. 다만
   * [`keptEvent`] 를 부르지 않고 **직접 대입한다**: `keptEvent("clear")` 가 다시 이 함수를
   * 부를 수 있는 모양이라(지금 표로는 안 부르지만, 표가 바뀌면 곧바로 재진입이 된다) 상태 대입
   * 한 줄로 끊어 둔다.
   */
  clearSearch(): void {
    this.#searchQuery = null;
    this.#searchIndex = 0;
    this.#searchCount = 0;
    this.#kept = "idle";
    // 애드온이 현재 매치에 건 선택도 걷는다 — 남으면 강조가 사라진 뒤에도 그 글자가 골라진 채라 복사된다.
    // **지금 선택이 그 범위 그대로일 때만**이다: 사람이 마우스로 다른 곳을 골랐으면 건드리지 않는다.
    const t = this.#h.term;
    if (t && !this.#h.disposed && sameRange(t.getSelectionPosition(), this.#searchSel)) t.clearSelection();
    this.#searchSel = null;
    this.#unpaintActive();
    this.#search?.clearDecorations();
    // 블록 띠도 함께 걷는다 — 같은 점프가 남긴 것이라 수명이 하나여야 한다
    // (`keptEvent("input")`·`("blur")` 가 이리로 오고, 오버레이의 `clear()` 도 그렇다).
    this.#h.shell?.clearBand();
  }

  /**
   * 다음 `findNext` 가 `at`(버퍼 줄 · [`#scanBuffer`] 의 문자 인덱스)의 매치에서 서게 한다 — 결과 점프(`SearchTarget.highlight` 의 `at`).
   *
   * 애드온에는 "이 매치를 현재로" 라는 API 가 없고, `findNext` 는 **선택이 있으면 그 자리부터**(질의가 캐시와 다르면 선택 시작부터) 찾는다.
   * 그래서 캐시된 질의를 비우고(`clearDecorations` — 같은 질의면 선택 **끝** 다음 매치로 건너뛴다) 그 매치의 첫 칸을 한 칸 선택해 둔다.
   * 문자 인덱스는 셀 좌표가 아니라(넓은 글자 · 결합 문자) `cellColumns` 로 옮긴다. 그 줄이 사라졌으면(스크롤백 밖) 아무것도 하지 않는다 —
   * 기본대로 맨 위부터다.
   */
  #startAt(at: { line: number; col: number }): void {
    const t = this.#h.term;
    const line = t?.buffer.active.getLine(at.line);
    const x = line ? cellColumns(line)[at.col] : undefined;
    if (!t || !this.#search || x === undefined) return;
    this.#search.clearDecorations();
    t.select(x, at.line, 1);
  }

  /**
   * 현재 매치를 **위층**에 다시 그린다 — 애드온이 결과를 알릴 때마다(`onDidChangeResults` · 우리 `findNext`/`findPrevious` 와
   * 출력 뒤 애드온 스스로의 다시 찾기 둘 다) 부른다.
   *
   * 애드온은 현재 매치를 `term.select()` 로 **고르고** 그 위에 아래층(`bottom`) 데코레이션을 얹는다. 그런데 두 렌더러 모두 선택을
   * 아래층 데코레이션 **뒤에** 칠한다(WebGL `CellColorResolver` 는 선택 칸이면 데코레이션 바탕을 버리고 선택 색으로 · DOM
   * `DomRendererRowFactory` 는 `top` 이 아니면 선택 색으로 덮는다). 그래서 `activeMatchBackground` 는 끝내 보이지 않고 현재 매치만
   * 옅은 선택 색 + 테두리로 남았다. 선택을 걷을 수는 없다 — 애드온의 F3 · Shift+F3 · 출력 뒤 다시 찾기가 **선택 자리부터** 찾는다
   * ([`#startAt`] 도 그 성질을 쓴다). 그래서 선택은 두고, 위층 데코레이션(선택보다 나중에 칠한다)으로 강조색 면 + 강조색 위 글자를 덮는다.
   *
   * 자리는 애드온이 방금 건 선택에서 읽는다(애드온은 현재 매치를 밖에 내주지 않는다 — 알림은 `select` 바로 뒤에 온다). `found` = 매치 수가 1 이상.
   */
  #paintActive(found: boolean): void {
    this.#unpaintActive();
    this.#searchSel = null;
    const t = this.#h.term;
    // 매치가 없으면 애드온은 고르지 않는다 — 그때 남은 선택은 사람의 것이라 현재 매치로 읽지 않는다
    if (!found || !t || this.#h.disposed || !this.#searchQuery || !this.#colors) return;
    const sel = t.getSelectionPosition() ?? null;
    this.#searchSel = sel;
    if (!sel) return;
    const buf = t.buffer.active;
    for (const r of selectionRows(sel, t.cols)) {
      const marker = t.registerMarker(r.y - (buf.baseY + buf.cursorY));
      if (!marker) continue;
      this.#active.push(marker);
      const d = t.registerDecoration({
        marker,
        x: r.x,
        width: r.width,
        backgroundColor: this.#colors.active,
        foregroundColor: this.#colors.onActive,
        layer: "top",
      });
      if (d) this.#active.push(d);
    }
  }

  #unpaintActive(): void {
    for (const d of this.#active) d.dispose();
    this.#active = [];
  }

  /** 하이라이트를 얹는다(`null` 이면 지운다). 돌려주는 값은 매치 수 · `at` 이면 그 매치가 현재 매치([`#startAt`]) */
  #highlightSearch(re: RegExp | null, at?: { line: number; col: number }): number {
    if (!this.#search || !this.#h.term || this.#h.disposed) return 0;
    if (re === null) {
      this.clearSearch();
      return 0;
    }
    const opts = this.#searchOptions(re);
    // 새로 칠한 강조는 **남긴 것이 아니다** — 오버레이가 지금 그리고 있는 것이라 오버레이가
    // 거둔다. 점프는 `highlight()` → `closeSearchKeeping()` → `keep()` 순서로 오므로 이 리셋이
    // 그 뒤의 `keep()` 을 지우지 않는다 (순서가 뒤집히면 남긴 강조가 곧바로 잊힌다).
    this.#kept = "idle";
    // 새 질의·다음 결과로의 점프는 **앞 블록의 띠를 걷는다** — 블록 점프면 착지 직후
    // `bandBlock` 이 새 띠를 두른다 (오버레이가 highlight → reveal → band 순으로 부른다).
    this.#h.shell?.clearBand();
    this.#searchQuery = { term: re.source, opts };
    if (at) this.#startAt(at);
    this.#search.findNext(re.source, opts);
    // `findNext` 는 `onDidChangeResults` 를 **동기로** 쏜다 — 이 시점의 `searchCount` 는 방금 값이다.
    return this.#searchCount;
  }

  /** 저장해 둔 질의로 한 칸 이동한다. 질의가 없으면 아무 일도 하지 않는다 */
  #stepSearch(dir: -1 | 1): void {
    if (!this.#search || !this.#h.term || this.#h.disposed || !this.#searchQuery) return;
    this.#h.shell?.clearBand(); // F3 로 다음 매치에 갔다 = 그 블록을 보고 있지 않다
    const { term: q, opts } = this.#searchQuery;
    if (dir === 1) this.#search.findNext(q, opts);
    else this.#search.findPrevious(q, opts);
  }

  // ── 검색 창구 (`$lib/search-registry`) ──────────────────────────────────
  // 창 전역 검색 오버레이가 이 손잡이로 **모든 터미널을 한꺼번에** 훑는다. 명령·터미널 조작
  // 창구와 같은 패턴이고, 등록하는 순간에는 애드온이 아직 null 이다 — 애드온은 `t.open()` 뒤에
  // 붙고(`attach`) 이 함수들은 전부 그보다 나중에 불린다.
  //
  // 등록을 `startSession` 이 아니라 **마운트 수명**에 건다: 세션이 끝나거나 재연결돼도
  // 검색 대상인 xterm 버퍼는 그대로이므로 이 한 번의 등록이 패널이 사는 내내 유효하다.
  target(info: SearchTargetInfo): SearchTarget {
    return {
      paneId: info.paneId,
      // 값이 아니라 **함수**다 — 별칭이 바뀌면 결과 목록의 이름도 따라 바뀌어야 한다.
      name: info.name,
      scan: (re, limit) => this.#scanBuffer(re, limit),
      highlight: (re, at) => this.#highlightSearch(re, at),
      position: () => ({ index: this.#searchIndex, count: this.#searchCount }),
      next: () => this.#stepSearch(1),
      prev: () => this.#stepSearch(-1),
      clear: () => this.clearSearch(),
      // 범위를 벗어난 값은 xterm 이 알아서 클램프한다 — 여기서 다시 재지 않는다.
      reveal: (line) => this.#h.term?.scrollToLine(line),
      // 점프가 남긴 색칠 — 이제부터 이 타일이 그 수명을 쥔다 (`stepKept`).
      keep: () => this.keptEvent("keep"),
      // 간이 모드 표식 — `#` 블록 검색이 이 타일을 건너뛴다(화면 검색은 그대로 대상).
      // **게터다**: 이 창구는 마운트에서 한 번 등록되는데 `pane.tmux` 는 첫 접속의 **답이
      // 돌아온 뒤에야** 채워진다(이름을 고르는 쪽이 백엔드다). 값으로 박아 두면 그 타일은
      // 이번 실행 내내 블록 검색에 남아 늘 0건을 낸다.
      get screenOnly() {
        return info.screenOnly();
      },
    };
  }

  // ── 검색 애드온 ──────────────────────────────────────────────────────────
  //
  // **`t.open` 뒤에 붙인다** — WebLinks·OSC 133·트리거와 정확히 같은 이유다. 이 애드온은
  // 매치마다 xterm 데코레이션을 얹고 개요 눈금(overview ruler)에도 칠하는데, 데코레이션은
  // 렌더러와 DOM 이 서 있어야 생긴다. `t.open` 앞에 붙이면 조용히 아무것도 안 그려진다.
  //
  // 먼저 등록해 둔 창구(`target`)가 이 인스턴스를 통해 일한다 (그때는 아직 null 이었다).
  attach(t: Terminal): void {
    const sa = new SearchAddon();
    t.loadAddon(sa);
    this.#search = sa;
    // 매치 번호는 애드온만 안다 — 이벤트로 받아 두고 `position()` 이 그대로 낸다.
    // `resultIndex` 는 0-기반이고 매치가 없으면 -1 이라 여기서 1-기반(없으면 0)으로 옮긴다.
    this.#searchResults = sa.onDidChangeResults(({ resultIndex, resultCount }) => {
      this.#searchIndex = resultIndex >= 0 ? resultIndex + 1 : 0;
      this.#searchCount = resultCount ?? 0;
      this.#paintActive(this.#searchCount > 0);
    });
  }

  /** 정리 — 터미널보다 먼저 놓는다 (데코레이션·이벤트 구독을 들고 있다) */
  dispose(): void {
    this.#searchResults?.dispose();
    this.#searchResults = null;
    this.#search = null; // 애드온 자체는 `t.dispose()` 가 거둔다 (`loadAddon` 이 수명을 묶어 둔다)
    this.#searchQuery = null;
    this.#searchIndex = 0;
    this.#searchCount = 0;
    this.#kept = "idle"; // 남긴 강조의 기억도 버퍼와 함께 사라진다
    this.#unpaintActive();
    this.#searchSel = null;
    this.#colors = null;
  }
}
