/**
 * 블록 이력 저장소 — **스트림 위의 데이터** (docs/log/2026-09-08-block-history-design.md).
 *
 * OSC 133 상태 기계(`$lib/shell-integration`)는 지금까지 **마지막 한 건**만 쥐고 있었다
 * (`CommandApi.last()`). 그 위에 서야 할 것들 — 관리뷰 · `#명령어` 검색 · MCP 읽기 확장 —
 * 이 전부 그 한 건에 막혀 있어서, 명령 블록을 **타일별 링 버퍼**로 쌓는 자리를 하나 만든다.
 *
 * ```text
 *   OSC 133 ; C   →  beginBlock  (명령문 · cwd · 시작 시각)
 *   OSC 133 ; D;n →  endBlock    (종료 코드 · 끝 시각 · 출력 발췌)
 * ```
 *
 * ## 이 모듈이 지키는 세 가지
 *
 * 1. **화면을 그리지 않는다.** 블록 크롬(상자·헤더·접기)은 만들지 않는 것이 설계 결정 ①이다.
 *    터미널은 평범한 xterm 스트림으로 남고, 블록은 거터·점프·검색·MCP 라는 **다른 표면**으로만
 *    드러난다.
 * 2. **마커를 들지 않는다.** `IMarker` 는 xterm 버퍼 좌표라 이 모듈이 쥐면 직렬화도 이관도
 *    못 한다. 마커는 `shell-integration.ts` 의 `CommandRecord` 에 그대로 남고 (점프는
 *    지금까지처럼 그쪽이 한다), 여기에는 **발췌 텍스트**만 온다. 그래서 스크롤백 밖으로 밀려
 *    마커가 죽어도 **블록은 남는다** — 오늘의 `prune()` 과의 결정적 차이다.
 * 3. **메모리만.** 세션이 사는 동안만 산다 (설계 결정 ②). 디스크 지속은 이미 세션 로깅이고
 *    "기본 꺼짐 · 세션별 옵트인" 제약에 묶여 있다.
 *
 * ## 저장소가 모듈 전역인 이유
 *
 * `Terminal.svelte` 안에 두면 **이관·재연결로 컴포넌트가 죽었다 다시 태어날 때** 이력이 함께
 * 사라진다. 그래서 `shell-integration.ts` 의 `registerCommands` · `sync.svelte.ts` 의
 * `registerInput` 과 같은 **레지스트리 패턴**을 쓴다 — 키는 타일 id, 값은 그 타일의 링이다.
 *
 * 순수 모듈이다(반응형 아님). 화면에 그리는 소비자가 생기면 그때 `app/blocks.svelte.ts` 를
 * 얹는다 — **재발을 보기 전에 기계를 늘리지 않는다**(CLAUDE.md).
 */

// ---------------------------------------------------------------------------
// 상한 — **전부 나중에 설정값이 된다** (설계 문서 "3의 상한 (전부 설정값)" 표)
//
// 단위는 **UTF-16 코드 유닛**(`String.length`)이다. ASCII 면 힙 사용량과 거의 같고 한글이면
// 대략 두 배다 — 정확한 바이트가 아니라 "무한히 자라지 않는다" 를 보장하는 자가 목적이다.
//
// 지금은 한곳에 박아 둔다. 설정으로 빼는 것은 **소비자(관리뷰·MCP)가 실제로 붙어 상한이
// 아쉬운 것을 본 뒤**다 (미리 늘린 손잡이는 되돌리기가 더 어렵다).
// ---------------------------------------------------------------------------

/** 발췌·링의 상한 한 벌. [`makeExcerpt`] 가 받는 값이라 테스트가 작은 값으로 바꿔 넣는다 */
export interface BlockCaps {
  /** 발췌 머리 줄 수 */
  headLines: number;
  /** 발췌 꼬리 줄 수 — 머리보다 훨씬 큰 이유는 **오류가 끝에 나오기 때문**이다 */
  tailLines: number;
  /** 논리 줄 하나의 길이 클램프 (긴 한 줄이 블록 전체를 먹지 않게) */
  lineUnits: number;
  /** 머리 전체의 상한 */
  headUnits: number;
  /** 꼬리 전체의 상한 */
  tailUnits: number;
  /** 타일당 블록 수 */
  paneBlocks: number;
  /** 타일당 총량 */
  paneUnits: number;
}

/**
 * 기본 상한 (설계 문서의 표 그대로).
 *
 * `headUnits + tailUnits = 64K` 가 **블록당 상한**이다 — 따로 재지 않는 이유는 발췌가
 * 블록에서 유일하게 큰 값이라 둘의 합이 곧 블록의 크기이기 때문이다.
 * `paneBlocks × 블록당 상한` 은 12.8MB 지만 실제 블록은 대개 수백 바이트라,
 * 실질 상한은 [`paneUnits`](4MB) 가 정한다.
 */
export const BLOCK_CAPS: BlockCaps = {
  headLines: 20,
  tailLines: 500,
  lineUnits: 4 * 1024,
  headUnits: 16 * 1024,
  tailUnits: 48 * 1024,
  paneBlocks: 200,
  paneUnits: 4 * 1024 * 1024,
};

// ---------------------------------------------------------------------------
// 모양
// ---------------------------------------------------------------------------

/**
 * 명령 하나의 출력 발췌 — **머리와 꼬리만 남기고 가운데를 버린다**.
 *
 * 가운데를 버리는 것은 의도된 손해다: 시작(무엇을 했나)과 끝(어떻게 끝났나)이 답의 거의
 * 전부이고, `npm install` 의 진행 표시 3천 줄은 아무에게도 필요하지 않다.
 */
export interface BlockExcerpt {
  /** 첫 [`BlockCaps.headLines`] 논리 줄 */
  head: string[];
  /** 마지막 [`BlockCaps.tailLines`] 논리 줄 (머리와 겹치지 않는다) */
  tail: string[];
  /**
   * 무언가를 버렸는가 — 가운데 줄 · 길이 상한을 넘은 줄 · 총량 상한 · **마커 유실**.
   *
   * 이 깃발이 있어야 소비자가 "이게 전부인가" 를 **추측하지 않는다**. MCP 응답이 그대로
   * 달고 나가는 값이다 (설계 문서 4절). `capture:"unavailable"`(마커 유실)이면 전부를 못
   * 담은 것이므로 이 값도 `true` 다.
   */
  truncated: boolean;
  /**
   * 발췌를 어떻게 담았는가 — `truncated` 만으로는 "무출력" 과 "못 읽음" 이 구분되지 않아 둔다.
   *
   * - `"complete"` — 출력을 전부 담았다(잘린 것이 없다).
   * - `"partial"` — 출력을 읽었으나 가운데·길이·총량에서 잘렸다.
   * - `"unavailable"` — 마커가 스크롤백 밖으로 밀려 출력을 **아예 못 읽었다**(또는 아직
   *   실행 중이라 출력이 없다). "출력이 없었다" 와 헷갈리면 안 되는 경우다.
   */
  capture: "complete" | "partial" | "unavailable";
  /** 실제로 보관 중인 양 (UTF-16 코드 유닛) — 링의 축출 계산에 쓴다 */
  units: number;
}

/**
 * 명령 블록 하나 — **직렬화되는 부분만** 있다 (마커는 [`BlockMarkers`] 로 xterm 쪽에 남는다).
 */
export interface CommandBlock {
  /**
   * 타일별 **단조 증가** 번호. MCP 는 `(session, id)` 로 블록 하나를 지목한다.
   *
   * 축출된 번호는 재사용하지 않는다 — 지목한 뒤 답이 오기까지 사이에 링이 돌면 엉뚱한
   * 블록을 짚게 된다.
   */
  id: number;
  paneId: string;
  /**
   * 사용자가 친 **명령문**(화면에서 읽은 것) — `B`(프롬프트 끝)부터 `C` 직전까지라 프롬프트
   * 문자열은 빠져 있다. `B` 를 안 보내는 훅에서만 프롬프트가 앞에 붙는다
   * (`CommandSnapshot.commandLine` 과 **같은 값·같은 추출**이다).
   */
  commandLine: string;
  /** `A` 시점에 셸이 말한 폴더 (OSC 7 · OSC 9;9). 한 번도 못 봤으면 `null` */
  cwd: string | null;
  /** `C` 를 본 시각 (epoch ms) */
  startedAt: number;
  /** `D` 를 본 시각 (epoch ms). `null` 이면 아직 실행 중 */
  endedAt: number | null;
  /** `D;n` 의 종료 코드. 못 읽었거나 아직 안 끝났으면 `null` */
  exit: number | null;
  /**
   * 지금 실행 중인가.
   *
   * 사실 **파생값**이다(`endedAt === null`). 그런데도 필드로 두는 이유는 이 모양이 그대로
   * **밖으로 나가기** 때문이다 — Rust 거울과 MCP 응답이 `running` 을 명시하는 계약이고
   * (`get_last_command` 가 이미 그렇다), 경계마다 다시 계산하면 한 곳이 어긋난다.
   * 이 모듈 안에서는 둘을 **언제나 함께** 쓴다.
   */
  running: boolean;
  /** 출력 발췌 (`C..D` 구간). 실행 중이면 비어 있다 */
  excerpt: BlockExcerpt;
}

/** 타일 하나의 링 */
interface PaneHistory {
  blocks: CommandBlock[];
  /** 다음에 매길 [`CommandBlock.id`] */
  nextId: number;
  /** 지금 보관 중인 총량 (UTF-16 코드 유닛) — 매번 다시 세지 않으려고 들고 있다 */
  units: number;
}

// ---------------------------------------------------------------------------
// 순수 헬퍼 — 발췌 만들기 (테스트 대상)
// ---------------------------------------------------------------------------

/** 논리 줄들의 양 (줄 사이 개행 한 칸씩 포함) */
function unitsOf(lines: readonly string[]): number {
  let n = 0;
  for (const line of lines) n += line.length + 1;
  return n;
}

/**
 * 줄 배열을 총량 상한에 맞춘다. `keep` 이 `"head"` 면 **뒤에서부터** 버리고(앞이 머리다),
 * `"tail"` 이면 **앞에서부터** 버린다(뒤가 꼬리다).
 *
 * 한 줄도 못 넣는 경우(첫 줄 하나가 이미 상한보다 크다)에도 **그 한 줄은 남긴다** —
 * 빈 발췌보다 잘린 한 줄이 낫고, 줄 자체는 이미 [`BlockCaps.lineUnits`] 로 클램프돼 있다.
 */
function fitUnits(
  lines: readonly string[],
  cap: number,
  keep: "head" | "tail",
): { lines: string[]; dropped: boolean } {
  if (unitsOf(lines) <= cap) return { lines: [...lines], dropped: false };
  const out: string[] = [];
  let n = 0;
  const order = keep === "head" ? lines : [...lines].reverse();
  for (const line of order) {
    const next = n + line.length + 1;
    if (out.length > 0 && next > cap) break;
    out.push(line);
    n = next;
  }
  return { lines: keep === "head" ? out : out.reverse(), dropped: out.length < lines.length };
}

/**
 * 출력 줄들 → 발췌 — **순수 함수**다 (`endBlock` 이 이것만 부른다).
 *
 * 순서: ①줄마다 길이 클램프 ②머리/꼬리로 자르기(겹치지 않게) ③총량 상한.
 * 어느 단계에서든 무언가를 버렸으면 [`BlockExcerpt.truncated`] 가 선다.
 */
export function makeExcerpt(lines: readonly string[], caps: BlockCaps = BLOCK_CAPS): BlockExcerpt {
  let truncated = false;

  // ① 줄 하나가 블록 전체를 먹지 않게 (`docker build` 의 한 줄 진행 표시가 그렇다).
  const clamped = lines.map((line) => {
    if (line.length <= caps.lineUnits) return line;
    truncated = true;
    return line.slice(0, caps.lineUnits);
  });

  // ② 머리와 꼬리. 둘이 겹치지 않게 꼬리의 시작을 머리 끝 아래로 내리지 않는다 —
  //    짧은 출력(≤ 머리+꼬리)은 한 줄도 버리지 않고 전부 담긴다.
  const headCount = Math.min(caps.headLines, clamped.length);
  const head = clamped.slice(0, headCount);
  const tailStart = Math.max(headCount, clamped.length - caps.tailLines);
  if (tailStart > headCount) truncated = true; // 가운데를 버렸다
  const tail = clamped.slice(tailStart);

  // ③ 총량. 머리는 앞이, 꼬리는 뒤가 살아남는다.
  const h = fitUnits(head, caps.headUnits, "head");
  const t = fitUnits(tail, caps.tailUnits, "tail");
  if (h.dropped || t.dropped) truncated = true;

  return {
    head: h.lines,
    tail: t.lines,
    truncated,
    // 여기 왔다는 것은 출력을 **실제로 읽었다**는 뜻이다 (`endBlock` 이 캡처 성공 때만 부른다).
    capture: truncated ? "partial" : "complete",
    units: unitsOf(h.lines) + unitsOf(t.lines),
  };
}

/**
 * 실행 중인 블록의 빈 발췌 (아직 `D` 를 못 봤다).
 *
 * 출력이 아직 없으므로 `capture:"unavailable"` 이다 — 그래도 주 신호는 `running:true` 다.
 * 아직 아무것도 잘리지 않았으니 `truncated` 는 `false`.
 */
function emptyExcerpt(): BlockExcerpt {
  return { head: [], tail: [], truncated: false, capture: "unavailable", units: 0 };
}

/**
 * 마커 유실로 출력을 **못 읽은** 블록의 발췌 (`D` 는 봤지만 시작/끝 마커가 스크롤백 밖).
 *
 * "출력이 없었다" 가 아니라 "담지 못했다" 이므로 `truncated:true` · `capture:"unavailable"`.
 */
function unavailableExcerpt(): BlockExcerpt {
  return { head: [], tail: [], truncated: true, capture: "unavailable", units: 0 };
}

/** 블록 하나가 차지하는 양 — 발췌가 거의 전부지만 명령문·경로도 센다 */
function blockUnits(block: CommandBlock): number {
  return block.excerpt.units + block.commandLine.length + (block.cwd?.length ?? 0);
}

// ---------------------------------------------------------------------------
// 저장소 (레지스트리 패턴 — `registerCommands` 와 같은 자리)
// ---------------------------------------------------------------------------

const histories = new Map<string, PaneHistory>();

function historyOf(paneId: string): PaneHistory {
  let h = histories.get(paneId);
  if (!h) {
    h = { blocks: [], nextId: 1, units: 0 };
    histories.set(paneId, h);
  }
  return h;
}

/** 총량을 다시 센다 (import 처럼 통째로 갈아 끼운 뒤) */
function recount(h: PaneHistory): void {
  h.units = h.blocks.reduce((n, b) => n + blockUnits(b), 0);
}

/**
 * 상한을 넘은 만큼 **오래된 블록부터** 버린다 (링).
 *
 * 두 상한 중 하나만 넘어도 돈다: 블록 수(200)는 "목록이 읽을 만한가", 총량(4MB)은
 * "메모리가 안전한가" 를 각각 지킨다. 실행 중인 블록도 예외가 아니다 — 예외를 두면
 * 죽은 셸이 남긴 running 블록이 링을 영영 막는다.
 */
function evict(h: PaneHistory, caps: BlockCaps): void {
  while (h.blocks.length > caps.paneBlocks || (h.units > caps.paneUnits && h.blocks.length > 1)) {
    const dead = h.blocks.shift();
    if (!dead) break;
    h.units -= blockUnits(dead);
  }
  if (h.units < 0) h.units = 0;
}

/**
 * 새 블록을 연다 (`OSC 133 ; C`). 돌려주는 것은 **저장소 안의 그 객체**다 —
 * 부르는 쪽이 `id` 를 들고 있다가 `D` 에서 짝을 맞춘다.
 *
 * 직전 블록이 아직 실행 중이면 **그 자리에서 닫는다**(`endedAt = now`, `exit = null`).
 * `D` 를 못 본 채 새 프롬프트가 온 경우(셸이 죽었다 · 훅이 반쪽이다)이고, 그대로 두면
 * "영원히 실행 중" 인 블록이 링에 쌓인다 — 없는 정보를 지어내지 않되(`exit` 는 `null`)
 * 사실(끝났다)은 적는다.
 */
export function beginBlock(
  paneId: string,
  init: { commandLine: string; cwd: string | null; startedAt: number },
  caps: BlockCaps = BLOCK_CAPS,
): CommandBlock {
  const h = historyOf(paneId);
  const prev = h.blocks[h.blocks.length - 1];
  if (prev && prev.running) {
    prev.running = false;
    prev.endedAt = init.startedAt;
  }
  const block: CommandBlock = {
    id: h.nextId++,
    paneId,
    commandLine: init.commandLine,
    cwd: init.cwd,
    startedAt: init.startedAt,
    endedAt: null,
    exit: null,
    running: true,
    excerpt: emptyExcerpt(),
  };
  h.blocks.push(block);
  h.units += blockUnits(block);
  evict(h, caps);
  return block;
}

/**
 * 열린 블록을 닫는다 (`OSC 133 ; D;n`) — 여기서 **발췌가 만들어진다**.
 *
 * 닫을 것이 없으면(= `C` 없이 `D` 가 왔거나 그 블록이 이미 축출됐다) `null`. 그것을 오류로
 * 만들지 않는 이유는 반쪽 마커가 실제로 온다는 것이다 (tmux 안 · 훅이 중간에 끊긴 세션).
 *
 * `outputCaptured` 는 부르는 쪽(`shell-integration`)이 마커로 출력을 **실제로 읽었는지**를
 * 알려 준다. `false`(마커가 스크롤백 밖)면 발췌를 만들지 않고 `unavailable` 로 둔다 —
 * 빈 `outputLines` 를 `makeExcerpt` 에 넘기면 `complete`(=무출력)로 보여 거짓이 된다.
 */
export function endBlock(
  paneId: string,
  end: {
    exit: number | null;
    endedAt: number;
    outputLines: readonly string[];
    outputCaptured: boolean;
  },
  caps: BlockCaps = BLOCK_CAPS,
): CommandBlock | null {
  const h = histories.get(paneId);
  if (!h) return null;
  const block = h.blocks[h.blocks.length - 1];
  if (!block || !block.running) return null;

  h.units -= blockUnits(block);
  block.running = false;
  block.endedAt = end.endedAt;
  block.exit = end.exit;
  block.excerpt = end.outputCaptured ? makeExcerpt(end.outputLines, caps) : unavailableExcerpt();
  h.units += blockUnits(block);
  evict(h, caps);
  return block;
}

/**
 * 블록 하나가 **걸린 시간**(ms) — 아직 실행 중이면 `null`.
 *
 * 파생값이라 필드로 두지 않는다 ([`CommandBlock.running`] 과 반대 판단이다 — 저쪽은 밖으로
 * 나가는 계약이라 명시하고, 이쪽은 **읽는 쪽이 셋**뿐이라 함수 하나면 된다: 거터 표식 ·
 * 긴 명령 알림 · MCP 응답). 시계가 뒤로 간 경우(NTP 보정)는 0 으로 읽는다 — 음수 지속
 * 시간은 어느 소비자에게도 뜻이 없다.
 */
export function blockDurationMs(block: CommandBlock): number | null {
  if (block.endedAt === null) return null;
  const ms = block.endedAt - block.startedAt;
  return ms > 0 ? ms : 0;
}

/** 그 타일의 블록들 (오래된 것부터). 없으면 빈 배열 */
export function blocksOf(paneId: string): readonly CommandBlock[] {
  return histories.get(paneId)?.blocks ?? [];
}

/** 그 타일의 마지막 블록 (없으면 `null`) */
export function lastBlock(paneId: string): CommandBlock | null {
  const blocks = histories.get(paneId)?.blocks;
  return blocks && blocks.length > 0 ? blocks[blocks.length - 1] : null;
}

/**
 * 그 타일의 마지막 **끝난** 블록 중 명령문이 있는 것 (없으면 `null`).
 *
 * [`lastBlock`] 과 나눠 두는 이유는 부르는 쪽의 물음이 다르기 때문이다. 저쪽은 "이 칸에서
 * 마지막에 벌어진 일" 이라 실행 중인 것도 답이지만, 이쪽은 **"스니펫으로 남길 만한 명령"**
 * 이라 둘을 걸러야 한다: 아직 도는 명령은 결말을 모르고, 명령문이 빈 블록(`B`~`C` 를 못 읽은
 * 자리)은 저장해 봐야 빈 글자가 터미널로 나간다.
 */
export function lastFinishedBlock(paneId: string): CommandBlock | null {
  const blocks = histories.get(paneId)?.blocks ?? [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (!b.running && b.commandLine.trim() !== "") return b;
  }
  return null;
}

/**
 * [`blockAtRow`] 가 받는 한 칸 — **블록 하나가 시작한 줄**.
 *
 * 줄 번호가 이 모듈에 없는 것이 요점이다(머리말 ②: 이 모듈은 마커를 들지 않는다). 그 값을
 * 아는 것은 마커를 쥔 `shell-integration.ts`(`CommandApi.lineOfBlock`)뿐이라, 부르는 쪽이
 * 거기서 받아다 이 모양으로 넘긴다.
 */
export interface BlockLine {
  /** [`CommandBlock.id`] */
  id: number;
  /** 그 블록의 프롬프트 줄 (xterm 버퍼의 절대 줄 번호) */
  line: number;
}

/**
 * **그 줄이 속한 블록** — 없으면 `null` (순수 함수).
 *
 * 블록의 끝을 따로 받지 않는 이유는 **다음 블록이 곧 끝**이기 때문이다: 프롬프트 줄들은
 * 버퍼에서 오름차순으로 서므로, `row` 이하의 줄 중 **가장 큰 것**이 그 줄을 품은 블록이다.
 * 끝 줄을 따로 실어 보내면 두 값이 어긋날 자리가 생기고(마커는 각자 죽는다), 이 규칙은
 * 어긋날 수 없다.
 *
 * 마지막 블록보다 **아래**를 누른 경우(= 지금 살아 있는 프롬프트 줄)도 그 마지막 블록으로
 * 떨어진다. 그래도 맞다 — 그 자리에서 사람이 가리킨 "방금 그 명령" 은 정확히 그것이고,
 * 우클릭 메뉴의 폴백("마지막 명령을 …")과도 같은 답이다.
 *
 * `lines` 는 **정렬돼 있지 않아도 된다** (마커가 죽어 빠진 자리가 있을 수 있다).
 */
export function blockAtRow(row: number, lines: readonly BlockLine[]): number | null {
  if (!Number.isFinite(row)) return null;
  let best: BlockLine | null = null;
  for (const entry of lines) {
    if (entry.line > row) continue;
    if (best === null || entry.line > best.line) best = entry;
  }
  return best === null ? null : best.id;
}

/** 타일이 사라졌다 — 이력을 버린다 (터미널 언마운트). 이관은 **먼저 실어 보낸 뒤** 이걸 부른다 */
export function dropHistory(paneId: string): void {
  histories.delete(paneId);
}

/**
 * 이관 페이로드에 실을 사본 (`buildTear`) — **복사본**을 준다.
 *
 * 사본인 이유: 이 값은 `JSON.stringify` 되어 창을 떠나고, 그 사이에도 원본 타일은 계속
 * 명령을 돌린다. 살아 있는 객체를 그대로 실으면 직렬화 시점에 따라 내용이 흔들린다.
 */
export function exportHistory(paneId: string): CommandBlock[] {
  return blocksOf(paneId).map((b) => ({
    ...b,
    excerpt: { ...b.excerpt, head: [...b.excerpt.head], tail: [...b.excerpt.tail] },
  }));
}

/**
 * 넘어온 이력을 이 창의 타일 id 로 심는다 (`restoreTab`) — **id 는 새로 매기지 않는다.**
 *
 * `CommandBlock.id` 는 타일 안에서만 뜻이 있는 번호라 창을 건너도 그대로 두는 편이 맞다
 * (MCP 가 지목한 번호가 이관 한 번으로 다른 블록을 가리키면 안 된다). 대신 `paneId` 필드는
 * 새 id 로 고쳐 심는다 — 그 값은 **이 창의** 타일을 가리켜야 한다.
 */
export function importHistory(
  paneId: string,
  blocks: readonly CommandBlock[],
  caps: BlockCaps = BLOCK_CAPS,
): void {
  const copy = blocks.map((b) => ({
    ...b,
    paneId,
    excerpt: { ...b.excerpt, head: [...b.excerpt.head], tail: [...b.excerpt.tail] },
  }));
  const nextId = copy.reduce((n, b) => Math.max(n, b.id + 1), 1);
  const h: PaneHistory = { blocks: copy, nextId, units: 0 };
  recount(h);
  evict(h, caps);
  histories.set(paneId, h);
}

/**
 * 같은 창 안에서 타일 id 가 바뀌었다 — 이력을 그 이름으로 옮긴다.
 *
 * 창을 **건너는** 이관은 이 길이 아니다 (저쪽 창의 맵은 다른 웹뷰에 있다 — 그쪽은
 * [`exportHistory`] → 페이로드 → [`importHistory`]). 이것은 이 창 안에서 id 만 다시
 * 매겨지는 경우(`adoptTab`)를 위한 문이다.
 */
export function remapHistory(oldPaneId: string, newPaneId: string): void {
  const h = histories.get(oldPaneId);
  if (!h || oldPaneId === newPaneId) return;
  histories.delete(oldPaneId);
  for (const b of h.blocks) b.paneId = newPaneId;
  histories.set(newPaneId, h);
}

/** 테스트 전용 — 모듈 전역 맵을 비운다 (테스트끼리 이력을 물려받지 않게) */
export function resetHistories(): void {
  histories.clear();
}
