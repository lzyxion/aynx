// 터미널 한 장의 검색 창구 — addon-search 와 질의 · 매치 번호 · 남긴 강조 상태, 창 전역 오버레이가 두드리는 `SearchTarget`.
// 애드온도 상태도 세션이 아니라 **터미널(버퍼)과 같은 수명**이다 — 세션 수명에 걸면 재접속마다 창구가 끊겨 오버레이가 이 타일을 못 본다.
import type { IBufferRange, IDisposable, Terminal } from "@xterm/xterm";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import type { ShellIntegration } from "$lib/shell-integration";
import { stepKept, type KeptEvent, type KeptState, type SearchHit, type SearchTarget } from "$lib/search-registry";
import { matchesInLine } from "$lib/search-query";
import { cellColumns } from "$lib/triggers";
import { sameRange, searchColors, selectionRows, type SearchColors } from "./search-paint";

export interface SearchHost {
  readonly term: Terminal | null;
  readonly disposed: boolean;
  /** tmux 타일 · 마운트 전에는 `null` */
  readonly shell: ShellIntegration | null;
}

export interface SearchTargetInfo {
  paneId: string;
  name: () => string;
  /** 게터로 준다(아래 `target` 의 `screenOnly`) */
  screenOnly: () => boolean;
}

export class TermSearch {
  #h: SearchHost;

  constructor(h: SearchHost) {
    this.#h = h;
  }

  #search: SearchAddon | null = null;
  /** `null` 이면 지금 강조가 없다. 애드온의 캐시는 밖에서 읽을 수 없어 따로 든다 */
  #searchQuery: { term: string; opts: ISearchOptions } | null = null;
  /** 1-기반, 0 = 없음 */
  #searchIndex = 0;
  #searchCount = 0;
  #searchResults: { dispose(): void } | null = null;

  /** 룬 상태가 아니다 — `$state` 로 두면 `Terminal` 의 `$effect` 가 자기가 쓴 값을 다시 읽어 스스로를 깨운다. */
  #kept: KeptState = "idle";

  #colors: SearchColors | null = null;
  #active: IDisposable[] = [];
  /** 지울 때 지금 선택이 이것과 같을 때만 선택을 푼다 — 사람이 다른 곳을 골랐으면 남는다 */
  #searchSel: IBufferRange | null = null;

  keptEvent(ev: KeptEvent): void {
    const next = stepKept(this.#kept, ev);
    this.#kept = next.state;
    if (next.clear) this.clearSearch();
  }

  /**
   * 부를 때마다 새로 만든다. `buildMatcher` 의 정규식은 세 옵션을 소스에 녹였으니 `regex: true` · `wholeWord: false` 로 준다(되돌리면 어긋난다).
   * 색은 매번 토큰에서 다시 읽는다 — 테마가 바뀌어도 다음 검색부터 따라온다. 면 색 둘은 불투명으로 풀어 넘긴다(`term/search-paint.ts` 머리말).
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
      regex: true,
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
   * `limit` 에 닿으면 거기서 멈춘다(스크롤백이 수만 줄일 수 있다). 알려진 한계: 행 단위라 줄바꿈된 논리 줄의 경계에 걸친 매치는 못 찾는다
   * — `reveal(line)` 이 이 행 번호를 그대로 `scrollToLine` 에 넘긴다.
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
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /** `clearDecorations` 는 이벤트를 쏘지 않는다 — 직접 리셋한다. `kept` 는 `keptEvent` 를 거치지 않고 직접 대입한다(재진입을 끊는다). */
  clearSearch(): void {
    this.#searchQuery = null;
    this.#searchIndex = 0;
    this.#searchCount = 0;
    this.#kept = "idle";
    // 애드온이 건 선택도 걷는다 — 남으면 강조가 사라진 뒤에도 골라진 채라 복사된다.
    const t = this.#h.term;
    if (t && !this.#h.disposed && sameRange(t.getSelectionPosition(), this.#searchSel)) t.clearSelection();
    this.#searchSel = null;
    this.#unpaintActive();
    this.#search?.clearDecorations();
    // 블록 띠도 함께 — 같은 점프가 남긴 것이라 수명이 하나여야 한다
    this.#h.shell?.clearBand();
  }

  /**
   * 다음 `findNext` 가 `at` 의 매치에서 서게 한다. 애드온에 그런 API 가 없어 캐시를 비우고(같은 질의면 선택 끝 다음으로 건너뛴다)
   * 그 매치의 첫 칸을 한 칸 선택해 둔다. 문자 인덱스는 `cellColumns` 로 셀 좌표로 옮긴다.
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
   * 현재 매치를 위층(`top`)에 다시 그린다 — 두 렌더러 모두 선택을 아래층 데코레이션 뒤에 칠해 `activeMatchBackground` 가 보이지 않는다.
   * 선택은 걷을 수 없다 — 애드온의 F3 · 출력 뒤 다시 찾기가 선택 자리부터 찾는다. 자리는 애드온이 방금 건 선택에서 읽는다.
   */
  #paintActive(found: boolean): void {
    this.#unpaintActive();
    this.#searchSel = null;
    const t = this.#h.term;
    // 매치가 없으면 애드온은 고르지 않는다 — 그때 남은 선택은 사람의 것이다
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

  #highlightSearch(re: RegExp | null, at?: { line: number; col: number }): number {
    if (!this.#search || !this.#h.term || this.#h.disposed) return 0;
    if (re === null) {
      this.clearSearch();
      return 0;
    }
    const opts = this.#searchOptions(re);
    // 점프는 `highlight()` → `closeSearchKeeping()` → `keep()` 순서로 온다 — 순서가 뒤집히면 남긴 강조가 곧바로 잊힌다.
    this.#kept = "idle";
    // 앞 블록의 띠를 걷는다 — 오버레이가 highlight → reveal → band 순으로 부른다.
    this.#h.shell?.clearBand();
    this.#searchQuery = { term: re.source, opts };
    if (at) this.#startAt(at);
    this.#search.findNext(re.source, opts);
    // `findNext` 는 `onDidChangeResults` 를 동기로 쏜다 — 이 시점의 `searchCount` 는 방금 값이다.
    return this.#searchCount;
  }

  #stepSearch(dir: -1 | 1): void {
    if (!this.#search || !this.#h.term || this.#h.disposed || !this.#searchQuery) return;
    this.#h.shell?.clearBand();
    const { term: q, opts } = this.#searchQuery;
    if (dir === 1) this.#search.findNext(q, opts);
    else this.#search.findPrevious(q, opts);
  }

  // ── 검색 창구 (`$lib/search-registry`) ──
  // 등록하는 순간에는 애드온이 아직 null 이다 — 이 함수들은 `attach` 보다 나중에 불린다.
  target(info: SearchTargetInfo): SearchTarget {
    return {
      paneId: info.paneId,
      // 함수다 — 별칭이 바뀌면 결과 목록의 이름도 따라 바뀌어야 한다.
      name: info.name,
      scan: (re, limit) => this.#scanBuffer(re, limit),
      highlight: (re, at) => this.#highlightSearch(re, at),
      position: () => ({ index: this.#searchIndex, count: this.#searchCount }),
      next: () => this.#stepSearch(1),
      prev: () => this.#stepSearch(-1),
      clear: () => this.clearSearch(),
      reveal: (line) => this.#h.term?.scrollToLine(line),
      keep: () => this.keptEvent("keep"),
      // 게터다 — `pane.tmux` 는 첫 접속의 답이 온 뒤에야 채워진다. 값으로 박으면 그 타일이 블록 검색에 남아 늘 0건을 낸다.
      get screenOnly() {
        return info.screenOnly();
      },
    };
  }

  // ── 검색 애드온 ──
  // `t.open` 뒤에 붙인다 — 데코레이션은 렌더러와 DOM 이 서 있어야 생긴다(앞에 붙이면 조용히 아무것도 안 그려진다).
  attach(t: Terminal): void {
    const sa = new SearchAddon();
    t.loadAddon(sa);
    this.#search = sa;
    this.#searchResults = sa.onDidChangeResults(({ resultIndex, resultCount }) => {
      this.#searchIndex = resultIndex >= 0 ? resultIndex + 1 : 0;
      this.#searchCount = resultCount ?? 0;
      this.#paintActive(this.#searchCount > 0);
    });
  }

  /** 터미널보다 먼저 놓는다 */
  dispose(): void {
    this.#searchResults?.dispose();
    this.#searchResults = null;
    this.#search = null; // 애드온 자체는 `t.dispose()` 가 거둔다
    this.#searchQuery = null;
    this.#searchIndex = 0;
    this.#searchCount = 0;
    this.#kept = "idle";
    this.#unpaintActive();
    this.#searchSel = null;
    this.#colors = null;
  }
}
