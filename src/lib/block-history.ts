/**
 * 블록 이력 저장소 — OSC 133 `C`/`D` 로 쌓는 타일별 명령 블록 링 버퍼(docs/log/2026-09-08-block-history-design.md).
 *
 * - 마커를 들지 않는다 — `IMarker` 는 xterm 버퍼 좌표라 쥐면 직렬화도 이관도 못 한다. 그래서 마커가 죽어도 블록은 남는다.
 * - 메모리만이다 — 디스크 지속은 세션 로깅이고 "기본 꺼짐 · 세션별 옵트인" 에 묶여 있다.
 * - 저장소가 모듈 전역인 것은 이관 · 재연결로 `Terminal.svelte` 가 죽었다 태어날 때 이력이 함께 사라지지 않게다.
 */

// ── 상한 ──
// 단위는 UTF-16 코드 유닛(`String.length`)이다 — 정확한 바이트가 아니라 "무한히 자라지 않는다" 를 보장하는 자다.

export interface BlockCaps {
  headLines: number;
  tailLines: number;
  /** 논리 줄 하나의 길이 클램프 */
  lineUnits: number;
  headUnits: number;
  tailUnits: number;
  paneBlocks: number;
  paneUnits: number;
}

export const BLOCK_CAPS: BlockCaps = {
  headLines: 20,
  tailLines: 500,
  lineUnits: 4 * 1024,
  headUnits: 16 * 1024,
  tailUnits: 48 * 1024,
  paneBlocks: 200,
  paneUnits: 4 * 1024 * 1024,
};

// ── 모양 ──

/** 머리와 꼬리만 남기고 가운데를 버린다. */
export interface BlockExcerpt {
  head: string[];
  /** 머리와 겹치지 않는다 */
  tail: string[];
  /** 무언가를 버렸는가(마커 유실 포함) — MCP 응답이 그대로 달고 나간다. */
  truncated: boolean;
  /** `"unavailable"` = 출력을 아예 못 읽었다(또는 아직 실행 중) — "출력이 없었다"(`complete`)와 헷갈리면 안 된다. */
  capture: "complete" | "partial" | "unavailable";
  units: number;
}

/** 직렬화되는 부분만 있다 — 마커는 xterm 쪽에 남는다. */
export interface CommandBlock {
  /** 타일별 단조 증가 번호 — 축출된 번호는 재사용하지 않는다(지목한 뒤 링이 돌면 엉뚱한 블록을 짚는다). */
  id: number;
  paneId: string;
  /** `CommandSnapshot.commandLine` 과 같은 값 · 같은 추출이다. */
  commandLine: string;
  cwd: string | null;
  startedAt: number;
  /** `null` 이면 아직 실행 중 */
  endedAt: number | null;
  exit: number | null;
  /** 파생값(`endedAt === null`)이지만 Rust 거울 · MCP 응답이 명시하는 계약이라 필드로 둔다 — 늘 `endedAt` 과 함께 쓴다. */
  running: boolean;
  excerpt: BlockExcerpt;
}

interface PaneHistory {
  blocks: CommandBlock[];
  nextId: number;
  units: number;
}

// ── 발췌 만들기 ──

function unitsOf(lines: readonly string[]): number {
  let n = 0;
  for (const line of lines) n += line.length + 1;
  return n;
}

/** 첫 줄 하나가 이미 상한보다 커도 그 한 줄은 남긴다 — 빈 발췌보다 잘린 한 줄이 낫다. */
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

export function makeExcerpt(lines: readonly string[], caps: BlockCaps = BLOCK_CAPS): BlockExcerpt {
  let truncated = false;

  const clamped = lines.map((line) => {
    if (line.length <= caps.lineUnits) return line;
    truncated = true;
    return line.slice(0, caps.lineUnits);
  });

  // 꼬리의 시작을 머리 끝 아래로 내리지 않는다 — 짧은 출력은 한 줄도 버리지 않는다.
  const headCount = Math.min(caps.headLines, clamped.length);
  const head = clamped.slice(0, headCount);
  const tailStart = Math.max(headCount, clamped.length - caps.tailLines);
  if (tailStart > headCount) truncated = true;
  const tail = clamped.slice(tailStart);

  const h = fitUnits(head, caps.headUnits, "head");
  const t = fitUnits(tail, caps.tailUnits, "tail");
  if (h.dropped || t.dropped) truncated = true;

  return {
    head: h.lines,
    tail: t.lines,
    truncated,
    // `endBlock` 이 캡처 성공 때만 부른다 — 여기 왔으면 출력을 실제로 읽었다.
    capture: truncated ? "partial" : "complete",
    units: unitsOf(h.lines) + unitsOf(t.lines),
  };
}

function emptyExcerpt(): BlockExcerpt {
  return { head: [], tail: [], truncated: false, capture: "unavailable", units: 0 };
}

function unavailableExcerpt(): BlockExcerpt {
  return { head: [], tail: [], truncated: true, capture: "unavailable", units: 0 };
}

function blockUnits(block: CommandBlock): number {
  return block.excerpt.units + block.commandLine.length + (block.cwd?.length ?? 0);
}

// ── 저장소 ──

const histories = new Map<string, PaneHistory>();

function historyOf(paneId: string): PaneHistory {
  let h = histories.get(paneId);
  if (!h) {
    h = { blocks: [], nextId: 1, units: 0 };
    histories.set(paneId, h);
  }
  return h;
}

function recount(h: PaneHistory): void {
  h.units = h.blocks.reduce((n, b) => n + blockUnits(b), 0);
}

/** 실행 중인 블록도 예외가 아니다 — 예외를 두면 죽은 셸이 남긴 running 블록이 링을 영영 막는다. */
function evict(h: PaneHistory, caps: BlockCaps): void {
  while (h.blocks.length > caps.paneBlocks || (h.units > caps.paneUnits && h.blocks.length > 1)) {
    const dead = h.blocks.shift();
    if (!dead) break;
    h.units -= blockUnits(dead);
  }
  if (h.units < 0) h.units = 0;
}

/**
 * 직전 블록이 아직 실행 중이면 그 자리에서 닫는다(`exit` 는 `null`) — 그대로 두면 "영원히 실행 중" 인 블록이 링에 쌓인다.
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
 * 닫을 것이 없으면 `null` — 반쪽 마커는 실제로 온다(tmux 안 · 훅이 끊긴 세션).
 * `outputCaptured` 가 `false` 면 `unavailable` 로 둔다 — 빈 줄을 `makeExcerpt` 에 넘기면 `complete`(무출력)로 보여 거짓이 된다.
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

/** 시계가 뒤로 간 경우(NTP 보정)는 0 으로 읽는다. */
export function blockDurationMs(block: CommandBlock): number | null {
  if (block.endedAt === null) return null;
  const ms = block.endedAt - block.startedAt;
  return ms > 0 ? ms : 0;
}

export function blocksOf(paneId: string): readonly CommandBlock[] {
  return histories.get(paneId)?.blocks ?? [];
}

export function lastBlock(paneId: string): CommandBlock | null {
  const blocks = histories.get(paneId)?.blocks;
  return blocks && blocks.length > 0 ? blocks[blocks.length - 1] : null;
}

/** 명령문이 빈 블록은 거른다 — 저장해 봐야 빈 글자가 터미널로 나간다. */
export function lastFinishedBlock(paneId: string): CommandBlock | null {
  const blocks = histories.get(paneId)?.blocks ?? [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (!b.running && b.commandLine.trim() !== "") return b;
  }
  return null;
}

/** 줄 번호는 마커를 쥔 `shell-integration.ts`(`CommandApi.lineOfBlock`)가 준다. */
export interface BlockLine {
  id: number;
  /** 그 블록의 프롬프트 줄 (xterm 버퍼의 절대 줄 번호) */
  line: number;
}

/**
 * `row` 이하의 프롬프트 줄 중 가장 큰 것이 그 줄을 품은 블록이다 — 끝 줄을 따로 받지 않아 두 값이 어긋날 자리가 없다.
 * `lines` 는 정렬돼 있지 않아도 된다(마커가 죽어 빠진 자리가 있을 수 있다).
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

/** 이관은 먼저 실어 보낸 뒤 이걸 부른다 */
export function dropHistory(paneId: string): void {
  histories.delete(paneId);
}

/** 복사본을 준다 — 직렬화되는 동안에도 원본 타일은 계속 명령을 돌린다. */
export function exportHistory(paneId: string): CommandBlock[] {
  return blocksOf(paneId).map((b) => ({
    ...b,
    excerpt: { ...b.excerpt, head: [...b.excerpt.head], tail: [...b.excerpt.tail] },
  }));
}

/** id 는 새로 매기지 않는다 — MCP 가 지목한 번호가 이관 한 번으로 다른 블록을 가리키면 안 된다. `paneId` 만 고쳐 심는다. */
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

/** 같은 창 안에서 id 만 다시 매겨질 때(`adoptTab`) — 창을 건너는 이관은 export → import 다. */
export function remapHistory(oldPaneId: string, newPaneId: string): void {
  const h = histories.get(oldPaneId);
  if (!h || oldPaneId === newPaneId) return;
  histories.delete(oldPaneId);
  for (const b of h.blocks) b.paneId = newPaneId;
  histories.set(newPaneId, h);
}

/** 테스트 전용 */
export function resetHistories(): void {
  histories.clear();
}
