/** 터미널 검색의 창구 레지스트리 — 패널 id → 그 터미널을 훑고 강조하는 손잡이. 렌더에 쓰이지 않아 `$state` 가 아니다. */

/** `line` = 버퍼 줄 번호, `col` = 0-기반 문자 인덱스 */
export interface SearchHit {
  line: number;
  text: string;
  col: number;
  len: number;
}

/**
 * `name` 은 함수다 — 타일 이름은 살아 있는 동안 바뀐다.
 * 탭 id 는 여기 없다 — 패널은 탭 찢기 · 창 간 이관으로 탭 사이를 옮겨 다니므로 소비자가 `tabOfPane(paneId)` 로 그때그때 푼다.
 */
export interface SearchTarget {
  paneId: string;
  name(): string;
  /** `limit` 개까지만 모으고 멈춘다 */
  scan(re: RegExp, limit: number): SearchHit[];
  /**
   * 돌려주는 값은 매치 수. `at` 을 주면 그 매치가 현재 매치가 된다 — 없으면 버퍼 맨 위부터 첫 매치라, 같은 글이 명령 줄과
   * 출력 줄에 둘 다 있을 때 고른 줄이 아닌 명령 줄이 현재 매치가 되고 이어지는 `reveal` 이 진한 강조를 화면 밖으로 민다.
   */
  highlight(re: RegExp | null, at?: { line: number; col: number }): number;
  /** 1-기반 · 없으면 둘 다 `0`. `next` · `prev` 뒤의 위치라 걸음마다 다시 물어야 한다 */
  position(): { index: number; count: number };
  next(): void;
  prev(): void;
  clear(): void;
  reveal(line: number): void;
  /** "점프가 일부러 남긴 강조다" 라는 통보 — 그 기억이 있어야 타일이 `stepKept` 규칙을 돌린다(`clear` 를 안 부르는 것만으로는 흔적이 없다) */
  keep(): void;
  /** 간이 모드(tmux) 타일 — OSC 133 파서가 붙지 않아 블록이 생기지 않으므로 `#` 대상에서 빠진다. 화면 검색은 그대로 대상 */
  screenOnly?: boolean;
}

const entries = new Map<string, SearchTarget>();

/** 해제는 내가 넣은 그 대상일 때만 — 같은 패널 id 로 새 인스턴스가 먼저 등록한 뒤 옛 정리가 늦게 돌아도 새 등록을 지우지 않게 */
export function registerSearch(target: SearchTarget): () => void {
  entries.set(target.paneId, target);
  return () => {
    if (entries.get(target.paneId) === target) entries.delete(target.paneId);
  };
}

/** 등록 순서다 */
export function searchTargets(): SearchTarget[] {
  return [...entries.values()];
}

export function searchTarget(paneId: string): SearchTarget | undefined {
  return entries.get(paneId);
}

export const HITS_PER_TERMINAL = 200;

/** 닿으면 더 훑지 않고 멈춘다 — 다 읽고 나서 자르면 상한을 둔 뜻이 사라진다 */
export const HITS_TOTAL = 2000;

/**
 * 같은 이름의 두 번째부터 `이름/2` · `이름/3` (등록 순서). 파서는 `@` 뒤를 공백 전까지 읽으므로 `/2` 가 옵션으로 오해받지 않는다.
 * 2 부터다 — 뒤늦게 같은 이름이 생겨도 먼저 있던 타일의 이름은 안 바뀐다.
 */
export function disambiguateNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const nth = (seen.get(n) ?? 0) + 1;
    seen.set(n, nth);
    return nth === 1 ? n : `${n}/${nth}`;
  });
}

export interface TerminalHits {
  /** 탭은 소비자가 `tabOfPane(paneId)` 로 그때그때 푼다 ([`SearchTarget`] 머리말) */
  paneId: string;
  /** [`disambiguateNames`] 를 거친 이름 — `@` 범위로 다시 칠 수 있는 그 이름 */
  label: string;
  hits: SearchHit[];
  truncated: boolean;
}

export interface SearchAllResult {
  groups: TerminalHits[];
  total: number;
  truncated: boolean;
}

/** 라벨은 매치와 무관하게 대상 전부에 매긴다 — 0 매치 터미널을 뺀 뒤 매기면 같은 타일의 이름이 질의에 따라 흔들린다 */
export function scanTargets(targets: readonly SearchTarget[], re: RegExp): SearchAllResult {
  const labels = disambiguateNames(targets.map((t) => t.name()));
  const groups: TerminalHits[] = [];
  let total = 0;
  let truncated = false;

  for (let i = 0; i < targets.length; i++) {
    if (total >= HITS_TOTAL) {
      truncated = true; // 아직 볼 대상이 남았는데 자리가 없다
      break;
    }
    const t = targets[i];
    // 한 개를 더 달라고 해서 "딱 채움" 과 "더 있음" 을 가른다
    const probed = t.scan(re, HITS_PER_TERMINAL + 1);
    let hits = probed.slice(0, HITS_PER_TERMINAL);
    let cut = probed.length > HITS_PER_TERMINAL;

    const room = HITS_TOTAL - total;
    if (hits.length > room) {
      hits = hits.slice(0, room);
      cut = true;
      truncated = true;
    }

    if (hits.length === 0) continue;
    groups.push({ paneId: t.paneId, label: labels[i], hits, truncated: cut });
    total += hits.length;
  }

  return { groups, total, truncated };
}

export function searchAll(re: RegExp): SearchAllResult {
  return scanTargets(searchTargets(), re);
}

// ── `#` — 블록 검색 ──

/** `block-history.ts` 를 임포트하지 않으려는 구조 타입 — `CommandBlock` 은 이 모양의 상위집합이다 */
export interface BlockLike {
  id: number;
  commandLine: string;
  cwd: string | null;
  startedAt: number;
  exit: number | null;
  running: boolean;
  excerpt: { head: readonly string[]; tail: readonly string[] };
}

export interface BlockHit {
  paneId: string;
  label: string;
  blockId: number;
  commandLine: string;
  cwd: string | null;
  startedAt: number;
  exit: number | null;
  running: boolean;
}

export interface BlockSearchResult {
  hits: BlockHit[];
  total: number;
  truncated: boolean;
}

function hits(re: RegExp, s: string): boolean {
  re.lastIndex = 0;
  const ok = re.test(s);
  re.lastIndex = 0;
  return ok;
}

function excerptText(b: BlockLike): string {
  return [...b.excerpt.head, ...b.excerpt.tail].join("\n");
}

/**
 * `term` 은 `commandLine` 과 부차적으로 `cwd` 에 맞춘다(결과 줄에 cwd 를 보여 왜 걸렸는지 남긴다). `text` 는 출력 발췌를 거른다.
 * 타일별로 먼저 자른 뒤 시작 시각 내림차순으로 합쳐 전체 상한을 다시 건다 — 한 타일이 목록을 독차지하지 않게.
 */
export function scanBlockTargets(
  targets: readonly SearchTarget[],
  blocksOf: (paneId: string) => readonly BlockLike[],
  term: RegExp | null,
  text: RegExp | null,
): BlockSearchResult {
  const labels = disambiguateNames(targets.map((t) => t.name()));
  const all: BlockHit[] = [];
  let truncated = false;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const blocks = blocksOf(t.paneId);
    let taken = 0;
    // 최신부터 거슬러 올라간다 — 타일당 상한에 걸리면 **오래된 쪽**이 잘린다.
    for (let k = blocks.length - 1; k >= 0; k--) {
      const b = blocks[k];
      if (term && !(hits(term, b.commandLine) || (b.cwd !== null && hits(term, b.cwd)))) continue;
      if (text && !hits(text, excerptText(b))) continue;
      if (taken >= HITS_PER_TERMINAL) {
        truncated = true;
        break;
      }
      taken++;
      all.push({
        paneId: t.paneId,
        label: labels[i],
        blockId: b.id,
        commandLine: b.commandLine,
        cwd: b.cwd,
        startedAt: b.startedAt,
        exit: b.exit,
        running: b.running,
      });
    }
  }

  // 시각이 같으면(같은 밀리초에 두 타일이 시작했다) 블록 번호로 갈라 순서를 안정시킨다.
  all.sort((a, b) => b.startedAt - a.startedAt || b.blockId - a.blockId);
  if (all.length > HITS_TOTAL) {
    all.length = HITS_TOTAL;
    truncated = true;
  }
  return { hits: all, total: all.length, truncated };
}

// ── 남긴 강조의 수명 ──

/** `"kept"` 는 오직 [`SearchTarget.keep`] 로만 들어간다 */
export type KeptState = "idle" | "kept";

/** `clear` — 강조가 다른 이유로 이미 지워졌거나 다시 칠해졌다는 통보 */
export type KeptEvent = "keep" | "input" | "blur" | "clear";

/**
 * 남긴 강조는 사용자가 다음 행동(키 입력 · 포커스 이탈)을 하면 사라진다. 타이머는 쓰지 않는다 — 읽는 도중에 사라진다.
 * `clear` 사건 · `idle` 에서는 지우라고 하지 않는다 — 방금 새로 얹은 강조 · 오버레이가 칠하는 강조를 엉뚱하게 걷는다.
 */
export function stepKept(state: KeptState, ev: KeptEvent): { state: KeptState; clear: boolean } {
  if (ev === "keep") return { state: "kept", clear: false };
  if (state !== "kept") return { state: "idle", clear: false };
  return { state: "idle", clear: ev !== "clear" };
}

// ── 결과 그룹 머리글의 탭 제목 ──

/**
 * 탭의 자동 제목은 안의 타일 이름들을 이은 것이라 `로컬 · 로컬 · 4개` 처럼 겹친다 — 탭이 하나뿐이거나 이름과 같으면 감춘다.
 * 자동완성 드롭다운은 이 규칙을 쓰지 않는다 — 같은 이름의 타일을 구분하는 데 탭 제목이 쓰인다.
 */
export function headerTabTitle(label: string, tabTitle: string, tabCount: number): string {
  if (tabCount < 2) return "";
  if (tabTitle === "" || tabTitle === label) return "";
  return tabTitle;
}
