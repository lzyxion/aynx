/**
 * **터미널 검색의 창구 레지스트리** — 패널 id → 그 터미널을 훑고 강조하는 손잡이 한 벌.
 *
 * 맵 하나가 전부다. `Terminal` 이 마운트에서 자기 [`SearchTarget`] 을 등록하고, 창 전역의
 * 검색 오버레이가 그것을 불러 **모든 터미널을 한꺼번에** 훑는다.
 *
 * ## 왜 레지스트리인가 (프롭이 아니라)
 *
 * `reconnect-registry.ts` 와 **같은 모양이고 같은 이유**다: 버퍼를 실제로 읽고 강조를 얹는
 * 코드는 `Terminal.svelte`(몸통은 `term/search.ts`) 안에만 있다 — xterm 인스턴스와 addon-search 가 그 컴포넌트의
 * 지역 상태이기 때문이다. 반대로 "전부 찾아라" 를 명령하는 곳은 창 전역이라 그 사이를 잇는
 * 길이 필요하고, 프롭으로 내려보내면 탭·타일 트리마다 구멍을 뚫어야 한다.
 *
 * ## 여기서 Svelte 도 `Terminal.svelte` 도 임포트하지 않는다
 *
 * 이 파일은 아무것도 임포트하지 않는다 — [`SearchHit`] 조차 여기서 정의한다
 * (`search-query.ts` 의 [`matchesInLine`] 결과에 줄 번호와 줄 내용을 얹은 모양이다).
 * 컴포넌트를 임포트하는
 * 순간 `Terminal → search-registry → Terminal` 순환이 생기고, 커밋 게이트의
 * `npm run check:cycles` 가 그것을 막는다. 손잡이는 **함수 묶음**으로만 오간다 — 그래서 이
 * 파일의 집계 로직([`scanTargets`])을 가짜 대상으로 통째로 테스트할 수 있다.
 *
 * `$state` 가 아니다 — 렌더에 쓰이지 않고 오직 호출만 된다.
 */

/** 한 줄에서 찾은 것 하나 (`line` = 버퍼 줄 번호, `col` = 0-기반 문자 인덱스) */
export interface SearchHit {
  line: number;
  /** 그 줄 전체 — 결과 목록에 미리보기로 그대로 그린다 */
  text: string;
  col: number;
  len: number;
}

/**
 * 터미널 하나를 검색에 내놓는 창구. `Terminal.svelte` 가 xterm 위에 이 여섯을 얹어 등록한다(손잡이는 `term/search.ts` 의 `target`).
 *
 * `name` 이 값이 아니라 **함수**인 것이 중요하다 — 타일 이름은 살아 있는 동안 바뀌고
 * (셸 통합이 프롬프트에서 읽어 오거나 사용자가 고친다), 등록해 둔 문자열을 그대로 쓰면
 * 결과 목록에 옛 이름이 남는다. 부를 때마다 `paneName(pane)` 의 지금 값을 읽는다.
 *
 * ## 탭 id(`tabId`)는 **여기 없다**
 *
 * 한때 있었고 뺐다. 패널은 탭 찢기·창 간 이관으로 **탭 사이를 옮겨 다닌다** —
 * 등록 시점에 굳힌 `tabId` 는 그 순간부터 낡기 시작하고, 그 값을 믿은 "결과로 점프" 는
 * 검색 결과가 없는 탭으로 화면을 날려 버린다. 소비자가 `tabOfPane(paneId)` 로
 * **그때그때** 풀면 옮겨 다닌 뒤에도 언제나 맞는다.
 *
 * 값을 하나 뺀 것에 그치지 않는다 — 이 파일이 탭 모듈을 **임포트하지 않아도**
 * 되게 만드는 것이 진짜 이유다. 머리말대로 이 파일의 임포트는 **하나도 없어야** 하고
 * (그래야 순환 위험이 0 이다), 탭을 아는 순간 그 성질이 무너진다.
 */
export interface SearchTarget {
  paneId: string;
  name(): string;
  /** 버퍼(화면 + 스크롤백)를 훑는다. `limit` 개까지만 모으고 멈춘다 */
  scan(re: RegExp, limit: number): SearchHit[];
  /**
   * addon-search 하이라이트를 얹는다(`null` 이면 지운다). 돌려주는 값은 매치 수.
   *
   * `at`(결과 하나의 `line` · `col` — [`SearchHit`] 그대로)을 주면 **그 매치**가 현재 매치(진한 강조 · 선택)가 된다 — 전체 검색의
   * 결과 점프가 쓴다. 없으면 애드온의 기본대로 버퍼 맨 위부터 첫 매치다(범위 모드 · 블록 점프). 같은 글이 명령 줄과 출력 줄에 둘 다
   * 있을 때 `at` 없이 칠하면 고른 줄이 아니라 위쪽 명령 줄이 현재 매치가 되고, 이어지는 `reveal` 이 그 줄을 화면 위로 밀어내면 진한
   * 강조가 아예 안 보였다(2026-11-15).
   */
  highlight(re: RegExp | null, at?: { line: number; col: number }): number;
  /**
   * 지금 몇 번째 매치인가 — `{ index, count }`, **1-기반**이고 없으면 둘 다 `0`.
   *
   * 범위 모드(`@이름`)의 "3/17" 표시가 이것 하나로 산다. [`highlight`] 가 돌려주는 매치 수와
   * 겹쳐 보이지만 뜻이 다르다: 저쪽은 "방금 칠한 결과", 이쪽은 [`next`]·[`prev`] 로 커서를
   * 옮긴 **뒤**의 현재 위치다 — 표시를 갱신하려면 걸음마다 다시 물어야 한다.
   */
  position(): { index: number; count: number };
  next(): void;
  prev(): void;
  clear(): void;
  /** 그 줄이 보이도록 스크롤한다 (결과 목록에서 항목을 골랐을 때) */
  reveal(line: number): void;
  /**
   * "지금 얹혀 있는 이 강조는 **점프가 일부러 남긴 것**이다" 를 타일에 알린다.
   *
   * [`clear`] 의 짝(`keep` = 안 지움)이 아니라 **별개의 사건**이다. `clear` 는 "지워라" 라는
   * 명령이고 이쪽은 "지우지 말고 **기억해 둬라**" 라는 통보다 — 그 기억이 있어야 타일이
   * 스스로 [`stepKept`] 의 규칙(키 입력·포커스 이탈에 사라진다)을 돌릴 수 있다. `clear` 를
   * 안 부르는 것만으로는 타일 쪽에 아무 흔적도 남지 않아, 남은 색칠이 언제 사라져야 하는지
   * 아는 코드가 세상 어디에도 없게 된다 (그게 이 창구를 늘린 이유 전부다).
   */
  keep(): void;
  /**
   * **이 타일은 화면만 있는가** (간이 모드 — tmux 타일 · docs/log/2026-09-16-tmux-toggle.md).
   *
   * 참이면 **블록 검색(`#`)의 대상에서 빠진다** — 그 타일에는 OSC 133 파서가 아예 붙지 않아
   * 블록이 영영 생기지 않으므로, 훑어 봐야 늘 0건이고 그 0건이 "이 타일엔 없다"(사실)가
   * 아니라 "아직 못 찾았다"(오해)로 읽힌다. **화면 검색은 그대로 대상**이다 — 버퍼는 여느
   * 타일과 똑같이 있다.
   *
   * 없으면(옛 등록·보통 타일) `false` 로 본다.
   */
  screenOnly?: boolean;
}

/** 패널 id → 창구. 이름을 `targets` 로 두지 않는 것은 [`scanTargets`] 의 인자와 겹치지 않게 하려는 것뿐이다 */
const entries = new Map<string, SearchTarget>();

/**
 * 터미널 하나를 검색 대상으로 등록한다 (마운트 시 1회). 돌려주는 함수로 해제한다.
 *
 * 해제는 **내가 넣은 그 대상일 때만** 지운다 (`registerConnect` 와 같은 이유 — 같은 패널 id 로
 * 새 인스턴스가 먼저 등록한 뒤 옛 인스턴스의 정리가 늦게 돌아도 새 등록을 지우지 않게).
 */
export function registerSearch(target: SearchTarget): () => void {
  entries.set(target.paneId, target);
  return () => {
    if (entries.get(target.paneId) === target) entries.delete(target.paneId);
  };
}

/** 지금 등록된 대상 전부 — **등록 순서**다 (`Map` 이 삽입 순서를 지킨다) */
export function searchTargets(): SearchTarget[] {
  return [...entries.values()];
}

export function searchTarget(paneId: string): SearchTarget | undefined {
  return entries.get(paneId);
}

/**
 * 한 터미널에서 모을 매치의 상한. 스크롤백이 수만 줄인 터미널에서 전부 모으면 목록을 그리는
 * 쪽이 먼저 죽는다 — 사람이 실제로 훑어보는 개수는 이보다 훨씬 적다.
 */
export const HITS_PER_TERMINAL = 200;

/**
 * 전체 상한. 터미널이 스무 개면 터미널당 상한만으로는 4000 개가 되므로 위에서 한 번 더 끊는다.
 * 여기에 닿으면 **더 훑지 않고 멈춘다** — 나머지 터미널을 읽어 버리고 나서 잘라내면 상한을
 * 둔 뜻(느려지지 않게)이 사라진다.
 */
export const HITS_TOTAL = 2000;

/**
 * 같은 이름이 여러 개면 두 번째부터 `이름/2`·`이름/3` 으로 구분한다 (**등록 순서** 기준).
 *
 * 타일 이름은 유일하지 않다 — `pwsh` 셸을 셋 열면 셋 다 `pwsh` 다. 그런데 `@이름` 범위는
 * 이름으로 타일을 고르므로, 결과 목록과 `@` 자동완성이 셋을 구분해 부를 이름이 필요하다.
 *
 * 구분자로 `/` 를 쓴 이유: 이름에 잘 안 나오면서 `@pwsh/2` 라고 쳤을 때 눈에 자연스러운
 * 글자여야 한다. 파서는 `@` 뒤를 공백 전까지 통째로 읽으므로(`search-query.ts`) `/2` 가
 * 옵션으로 오해받을 자리는 없다.
 *
 * 번호는 **1 이 아니라 2 부터**다 — 이름이 하나뿐인 흔한 경우에 `pwsh/1` 같은 군더더기가
 * 붙지 않아야 하고, 뒤늦게 같은 이름이 하나 더 생겨도 **먼저 있던 타일의 이름은 안 바뀐다**.
 */
export function disambiguateNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const nth = (seen.get(n) ?? 0) + 1;
    seen.set(n, nth);
    return nth === 1 ? n : `${n}/${nth}`;
  });
}

/** 한 터미널의 결과 묶음 */
export interface TerminalHits {
  /** 탭은 소비자가 `tabOfPane(paneId)` 로 그때그때 푼다 ([`SearchTarget`] 머리말) */
  paneId: string;
  /** [`disambiguateNames`] 를 거친 이름 — 화면에 보이고 `@` 범위로 다시 칠 수 있는 그 이름 */
  label: string;
  hits: SearchHit[];
  /** 상한에 걸려 잘렸는가 (목록 끝에 "더 있음" 을 적는다) */
  truncated: boolean;
}

export interface SearchAllResult {
  groups: TerminalHits[];
  total: number;
  truncated: boolean;
}

/**
 * 대상들을 훑어 **터미널별로** 묶는다.
 *
 * `targets` 를 인자로 받는 이유는 하나다 — 테스트가 가짜 대상을 넣을 수 있게. 등록된 전부를
 * 훑는 실제 호출은 [`searchAll`] 이고, 이 함수 자체는 xterm 도 맵도 모르는 순수 집계다.
 *
 * 규칙 넷:
 *
 * - **매치가 0 인 터미널은 `groups` 에서 뺀다** — 열려 있기만 한 타일이 목록을 채우면 결과를
 *   읽을 수가 없다.
 * - 라벨은 **매치와 무관하게** 대상 전부에 대해 계산한다. 0 매치 터미널을 뺀 뒤에 번호를
 *   매기면 같은 타일의 이름이 질의에 따라 `pwsh/2` ↔ `pwsh` 로 흔들린다.
 * - 터미널당 [`HITS_PER_TERMINAL`] 을 **넘으면** 그 그룹이 `truncated` 다. 정확히 채운 것과
 *   더 있는 것을 가르려고 한 개를 더 달라고 해서(`limit + 1`) 넘치는지 보고 잘라낸다.
 * - 전체 [`HITS_TOTAL`] 에 닿으면 결과가 `truncated` 이고 **남은 대상은 훑지 않는다**.
 */
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

/** 등록된 전부를 훑는다 */
export function searchAll(re: RegExp): SearchAllResult {
  return scanTargets(searchTargets(), re);
}

// ---------------------------------------------------------------------------
// `#` — 블록 검색 (docs/log/2026-09-08-block-search.md)
//
// 텍스트 검색이 **버퍼의 줄**을 훑는다면 이쪽은 **명령 블록**(`block-history.ts`)을 훑는다.
// 훑는 대상이 다를 뿐 상한(200/2000)과 라벨 규칙은 그대로 쓴다.
// ---------------------------------------------------------------------------

/**
 * 블록에서 **이 파일이 보는 부분만** — `block-history.ts` 를 임포트하지 않으려고 구조적
 * 타입으로 적는다 (머리말의 "여기서 아무것도 임포트하지 않는다"). `CommandBlock` 은 이
 * 모양의 상위집합이라 그대로 들어온다.
 */
export interface BlockLike {
  id: number;
  commandLine: string;
  cwd: string | null;
  startedAt: number;
  exit: number | null;
  running: boolean;
  excerpt: { head: readonly string[]; tail: readonly string[] };
}

/** 블록 결과 한 줄 — 오버레이가 그대로 그리고, 점프는 `(paneId, blockId)` 로 한다 */
export interface BlockHit {
  paneId: string;
  /** [`disambiguateNames`] 를 거친 타일 이름 (텍스트 결과의 그룹 머리글과 같은 이름) */
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

/** `g` 정규식 하나를 여러 문자열에 재사용한다 — `lastIndex` 를 양쪽에서 되돌린다 */
function hits(re: RegExp, s: string): boolean {
  re.lastIndex = 0;
  const ok = re.test(s);
  re.lastIndex = 0;
  return ok;
}

/** 발췌를 한 덩어리로 (머리 + 꼬리) — `text` 필터가 보는 것이 이것이다 */
function excerptText(b: BlockLike): string {
  return [...b.excerpt.head, ...b.excerpt.tail].join("\n");
}

/**
 * 대상들의 블록을 훑는다 — **최신 블록이 위**다.
 *
 * 인자 셋의 뜻이 각각 다르다:
 *
 * - `term` — `#` 의 항. `null` 이면 **거르지 않는다**(`#` 하나만 친 경우 = 전부). 맞춰 보는
 *   대상은 `commandLine` 과 **부차적으로** `cwd` 다. cwd 를 넣은 것은 "그 폴더에서 돌린
 *   명령" 을 찾는 몸짓이 실제로 흔해서이고, 대신 결과 줄에 cwd 를 **보여 줘서** 왜 걸렸는지가
 *   화면에 남는다.
 * - `text` — `#` 뒤에 더 친 검색어. 고른 블록들의 **출력 발췌**(머리 + 꼬리)를 거른다
 *   (`#build 실패` = build 블록 중 출력에 '실패' 가 있는 것). 마커가 살아 있는 버퍼 전문이
 *   아니라 발췌를 보는 것은 이 함수가 xterm 을 모르기 때문이고, 밀려난 블록에서도 같은
 *   답이 나온다는 뜻이기도 하다.
 * - `blocksOf` — 타일 id → 그 타일의 블록들(오래된 것부터). 저장소를 인자로 받는 이유는
 *   [`scanTargets`] 가 `targets` 를 받는 이유와 같다 — 테스트가 가짜를 넣는다.
 *
 * 상한은 텍스트 검색과 같은 둘([`HITS_PER_TERMINAL`] · [`HITS_TOTAL`])이다. 타일별로 먼저
 * 잘라 낸 뒤 **시작 시각 내림차순**으로 합쳐 전체 상한을 다시 건다 — 타일 하나가 목록을
 * 독차지하지 않으면서도 "가장 최근에 돌린 명령" 이 맨 위에 오게 하려는 것이다.
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

// ---------------------------------------------------------------------------
// 남긴 강조의 수명 (점프가 남긴 색칠은 언제 사라지는가)
// ---------------------------------------------------------------------------

/**
 * 점프가 남긴 강조를 그 타일이 아직 들고 있는가.
 *
 * `"kept"` 는 **오직 [`SearchTarget.keep`] 로만** 들어간다 — 오버레이가 평범하게 칠한 강조
 * (범위 모드의 실시간 하이라이트)는 오버레이 자신이 정리하므로 여기 낄 일이 없다.
 */
export type KeptState = "idle" | "kept";

/**
 * 남긴 강조에게 일어날 수 있는 일 넷.
 *
 * - `keep` — 점프가 "이건 남긴 것" 이라고 표시했다.
 * - `input` — 그 터미널에 **키 입력**이 들어왔다 (xterm `onData`).
 * - `blur` — 그 타일이 **포커스를 잃었다** (다른 타일 · 탭 전환).
 * - `clear` — 강조가 **다른 이유로** 이미 지워졌거나 다시 칠해졌다는 통보.
 */
export type KeptEvent = "keep" | "input" | "blur" | "clear";

/**
 * 남긴 강조의 상태 기계 — **순수 함수**다 (그래서 xterm 없이 전이표를 통째로 테스트한다).
 *
 * ## 규칙 한 줄: 남긴 강조는 **사용자가 다음 행동을 하면** 사라진다
 *
 * 점프해서 도착한 화면의 색칠은 "무엇을 찾았는지" 를 말해 주므로 도착 직후에는 남아야 한다.
 * 그런데 그 뒤로 영원히 남으면 사용자에게 걷을 길이 없다 — 강조를 얹은 것은 창 전역 오버레이고
 * 타일에는 그것을 끄는 손잡이가 없다. 그래서 "읽기를 끝냈다" 는 신호 둘(키를 쳤다 · 다른 데를
 * 봤다)을 지우는 계기로 삼는다.
 *
 * **타이머는 쓰지 않는다.** 시간으로 지우면 읽는 도중에 사라지고, 그건 "찾은 것을 보여 준다"
 * 는 점프의 목적을 정확히 반대로 뒤집는다. 사용자의 몸짓만이 계기다.
 *
 * | 상태 | 사건 | 다음 | `clear` |
 * | --- | --- | --- | --- |
 * | 아무거나 | `keep` | **kept** | false |
 * | idle | `input`·`blur`·`clear` | idle | false |
 * | kept | `input` | idle | **true** |
 * | kept | `blur` | idle | **true** |
 * | kept | `clear` | idle | false |
 *
 * `keep` 이 **상태와 무관하게** `kept` 로 가는 것이 이 표의 유일한 진입로다 — 점프 말고는
 * 아무도 `kept` 를 세우지 않고, 세워지지 않으면 아래 두 계기가 영원히 아무 일도 안 한다.
 *
 * 돌려주는 `clear` 는 **"호출자가 지금 `clearSearch()` 를 불러야 하는가"** 다. `clear` 사건에서
 * `false` 인 것이 핵심이다 — 그 사건의 뜻이 이미 "지워졌다/다시 칠했다" 이므로 다시 지우면
 * 방금 새로 얹은 강조를 스스로 걷어 낸다. `idle` 에서 오는 모든 사건도 `false` 다: 지울 것이
 * 없는데 지우라고 하면 오버레이가 지금 칠하고 있는 강조를 엉뚱하게 걷는다.
 */
export function stepKept(state: KeptState, ev: KeptEvent): { state: KeptState; clear: boolean } {
  if (ev === "keep") return { state: "kept", clear: false };
  if (state !== "kept") return { state: "idle", clear: false };
  // `clear` 는 통보라 지우라고 하지 않는다 — 나머지 둘(사용자의 다음 행동)만 지운다.
  return { state: "idle", clear: ev !== "clear" };
}

// ---------------------------------------------------------------------------
// 결과 그룹 머리글의 탭 제목
// ---------------------------------------------------------------------------

/**
 * 전체 모드 결과의 그룹 머리글에 **탭 제목을 붙일까** — 붙일 문자열, 감출 때는 `""`.
 *
 * 머리글은 `타일이름 · 탭 · n개` 로 읽힌다. 그런데 탭의 **자동 제목은 그
 * 안의 타일 이름들을 이어 붙인 것**이라, 타일 하나짜리 탭에서는
 * `로컬 · 로컬 · 4개` 처럼 같은 낱말이 두 번 나온다 (실제로 그렇게 보였다).
 *
 * 규칙 셋:
 *
 * - **열린 탭이 하나뿐이면 붙이지 않는다.** 갈 곳이 하나인데 "어디로 가는지" 를
 *   말하는 것은 정보가 아니라 잡음이다.
 * - 붙일 때도 제목이 **타일 이름과 같으면** 생략한다 (위의 중복이 정확히 이 경우다).
 * - 제목이 비어 있으면(패널이 어느 탭에도 없다 — 훑은 뒤에 옮겨졌다) 생략.
 *
 * 자동완성 드롭다운은 이 규칙을 **쓰지 않는다** — 거기서는 같은 이름의 타일 중 하나를
 * 고르는 것이 목적이라, 탭 제목이 겹쳐 보이더라도 구분에 쓰인다.
 */
export function headerTabTitle(label: string, tabTitle: string, tabCount: number): string {
  if (tabCount < 2) return "";
  if (tabTitle === "" || tabTitle === label) return "";
  return tabTitle;
}
