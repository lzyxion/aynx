/**
 * **명령 블록을 AI 타일에 넘기기** — 순수 규칙 셋 (docs/log/2026-09-28-ask-ai-block.md).
 *
 * 셸 타일의 끝난 블록(OSC 133 — `$lib/block-history`)을 한 번의 클릭으로 AI CLI 타일(Claude Code ·
 * Codex)의 입력 줄에 **붙여 넣기만** 한다(Enter 는 사람이 누른다). 이 파일은 그 길의 판단만 든다:
 *
 * | 무엇 | 함수 |
 * | --- | --- |
 * | 넘길 글 — 부탁 한 문장 + 호스트·폴더 + 명령·종료 코드·시간 + 출력 끝부분 | [`buildAskText`] · [`askOutputTail`] |
 * | 받을 타일 — 곧장 · 고르기 상자 · 새로 열기 | [`planAskTarget`] |
 * | 새로 연 AI 타일이 붙여 넣을 준비가 됐는가 | [`readyForPaste`] |
 * | 붙여 넣는 바이트 (괄호 붙여넣기) | [`pasteBytes`] |
 *
 * 받을 타일의 **판정은 새로 짓지 않는다** — 타일 헤더·탭의 AI 로고가 쓰는 `pane-identity`(시작 명령 →
 * 셸 통합이 알려 준 도는 명령 → 제목)를 부르는 쪽이 이미 거쳐 [`AskTile`] 로 넘긴다.
 *
 * Svelte 를 import 하지 않는다 — vitest 대상이다 (`pane-identity.ts` 와 같은 이유).
 */

import type { AgentStatus } from "$lib/agent-status";
import { formatDuration } from "$lib/finish-notify";
import type { Tr } from "$lib/session";

// ---------------------------------------------------------------------------
// 출력 끝부분
// ---------------------------------------------------------------------------

/**
 * 넘길 출력의 상한 — **기본 40줄 · 8 KB**(설계 노트). 오류는 대개 끝에 있으므로 넘치면 **앞을** 버린다.
 * 바이트는 UTF-8 로 잰다(AI 대화에 실리는 양이 기준이다 — 블록 이력의 UTF-16 단위와 다른 이유).
 */
export interface AskCaps {
  tailLines: number;
  tailBytes: number;
}

export const ASK_CAPS: AskCaps = { tailLines: 40, tailBytes: 8 * 1024 };

/**
 * 블록의 출력 — 부르는 쪽이 **어디서 읽었는가**에 따라 앞에서 이미 버린 것이 있을 수 있다.
 *
 * - xterm 버퍼의 마커 사이(`CommandApi.blockOutput`)에서 읽었으면 전부다 — `droppedBefore: 0`.
 * - 블록 이력의 발췌가 `complete` 면 머리+꼬리가 곧 전부다 — `0`.
 * - 발췌가 `partial` 이면(가운데를 버렸다) 꼬리만 넘기고 **몇 줄을 버렸는지는 모른다** — `"some"`.
 */
export interface AskOutput {
  lines: readonly string[];
  droppedBefore: number | "some";
}

/** [`askOutputTail`] 의 답 — `omitted` 는 앞에서 버린 줄 수 (모르면 `"some"`) */
export interface AskTail {
  lines: string[];
  omitted: number | "some";
}

const encoder = new TextEncoder();
const bytesOf = (s: string): number => encoder.encode(s).length;

/**
 * 출력 → **끝부분** — 줄 수 상한을 먼저, 그다음 바이트 상한을 **뒤에서부터** 채운다.
 *
 * 끝의 빈 줄은 버린다(프롬프트 직전의 개행 — 셸 통합의 `readLineArray` 와 같은 규칙). 한 줄이 이미 바이트
 * 상한보다 길면 그 줄의 **끝**만 남긴다 — 빈 출력보다 잘린 한 줄이 낫고, 오류 문장은 대개 줄 끝에 있다.
 */
export function askOutputTail(output: AskOutput, caps: AskCaps = ASK_CAPS): AskTail {
  const all = [...output.lines];
  while (all.length > 0 && all[all.length - 1].trim() === "") all.pop();

  const byLines = all.slice(Math.max(0, all.length - caps.tailLines));
  const kept: string[] = [];
  let used = 0;
  for (let i = byLines.length - 1; i >= 0; i--) {
    const line = byLines[i];
    const next = used + bytesOf(line) + 1;
    if (next > caps.tailBytes) {
      if (kept.length === 0) kept.unshift(clipTail(line, caps.tailBytes));
      break;
    }
    kept.unshift(line);
    used = next;
  }
  const droppedHere = all.length - kept.length;
  const omitted = output.droppedBefore === "some" ? "some" : output.droppedBefore + droppedHere;
  return { lines: kept, omitted };
}

/** 한 줄의 끝 `max` 바이트 안쪽만 (코드 포인트를 반으로 자르지 않는다) */
function clipTail(line: string, max: number): string {
  const chars = [...line];
  let n = 0;
  let i = chars.length;
  while (i > 0) {
    const b = bytesOf(chars[i - 1]);
    if (n + b > max) break;
    n += b;
    i -= 1;
  }
  return chars.slice(i).join("");
}

// ---------------------------------------------------------------------------
// 넘길 글
// ---------------------------------------------------------------------------

/** [`buildAskText`] 가 보는 것 — 전부 블록(`CommandBlock`)과 그 타일에서 온다 */
export interface AskInput {
  /** 명령문 (여러 줄일 수 있다) */
  commandLine: string;
  /** 종료 코드 — `null` 이면 못 읽었다 */
  exit: number | null;
  /** 걸린 시간 — `null` 이면 모른다 */
  durationMs: number | null;
  /** 호스트 이름 — SSH 별칭, 로컬이면 부르는 쪽이 "이 PC" 류의 말을 넣는다 */
  host: string;
  /** 셸이 알려 준 폴더 (모르면 `null`) */
  cwd: string | null;
  /** 출력 — `null` 이면 **못 읽었다**(마커가 밀려났다 · 이력이 `unavailable`) */
  output: AskOutput | null;
}

/**
 * 붙여 넣을 수 없는 글자를 걷는다 — 탭·줄바꿈만 남기고 C0·DEL·C1 제어 문자를 뺀다.
 *
 * 화면에서 읽은 글자라 대개 이미 깨끗하지만 **명령문과 출력은 남의 것**이다. ESC 한 글자가 살아 있으면
 * `ESC[201~` 로 괄호 붙여넣기를 스스로 닫고 그 뒤의 글자를 키 입력으로 만들 수 있다 — 그 길을 여기서 막는다.
 */
export function sanitizeForPaste(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

/**
 * **붙여 넣을 글** — 첫 줄은 짧은 부탁 한 문장, 그 아래가 사실이다(목업 그대로):
 *
 * ```text
 * 이 명령이 실패했어. 원인을 봐 줘.
 * 호스트 dev-01 · 폴더 ~/app
 * $ npm run build  → 종료 코드 2 · 3.1초
 * 출력 끝 12줄:
 * (앞 312줄 생략)
 * …
 * ```
 *
 * 성공한 블록(우클릭·단축키로만 온다)과 종료 코드를 모르는 블록은 중립 문장("이 명령의 결과를 봐 줘.")이다.
 * **끝은 줄바꿈 하나**다 — 커서가 다음 줄 첫 칸에 서서 사람이 한마디 보탠 뒤 Enter 를 누른다.
 */
export function buildAskText(input: AskInput, tr: Tr, caps: AskCaps = ASK_CAPS): string {
  const failed = input.exit !== null && input.exit !== 0;
  const out: string[] = [];
  out.push(tr(failed ? "pane.askai.lead.fail" : "pane.askai.lead.ok"));
  const cwd = input.cwd?.trim() ?? "";
  out.push(
    cwd !== ""
      ? tr("pane.askai.where", { host: input.host, cwd })
      : tr("pane.askai.where.host", { host: input.host }),
  );

  const outcome =
    input.exit === null ? tr("pane.askai.exit.unknown") : tr("pane.askai.exit", { exit: input.exit });
  const took =
    input.durationMs !== null && Number.isFinite(input.durationMs)
      ? tr("pane.askai.took", { took: formatDuration(input.durationMs, tr) })
      : "";
  out.push(tr("pane.askai.command", { command: input.commandLine.trim(), outcome: outcome + took }));

  if (input.output === null) {
    out.push(tr("pane.askai.output.unavailable"));
  } else {
    const tail = askOutputTail(input.output, caps);
    if (tail.lines.length === 0 && tail.omitted === 0) {
      out.push(tr("pane.askai.output.none"));
    } else {
      out.push(tr("pane.askai.output.tail", { n: tail.lines.length }));
      if (tail.omitted === "some") out.push(tr("pane.askai.output.omitted.some"));
      else if (tail.omitted > 0) out.push(tr("pane.askai.output.omitted", { n: tail.omitted }));
      out.push(...tail.lines);
    }
  }
  return sanitizeForPaste(out.join("\n")) + "\n";
}

/**
 * 고르기 상자 머리의 짧은 요약 — `npm run build · 종료 2`. 명령은 **첫 줄만**, 길면 말줄임.
 */
export function askSummary(commandLine: string, exit: number | null, tr: Tr, max = 32): string {
  const first = commandLine.trim().split("\n")[0] ?? "";
  const cmd = [...first].length > max ? [...first].slice(0, max - 1).join("") + "…" : first;
  return exit === null ? cmd : tr("pane.askai.summary", { command: cmd, exit });
}

// ---------------------------------------------------------------------------
// 받을 타일
// ---------------------------------------------------------------------------

/**
 * 고르기 상자가 서는 자리 (화면 좌표). `y` 는 상자의 위 가장자리, `x` 는 `align` 쪽 가장자리다 — 실패 줄 단추는
 * 단추 오른쪽 끝에 맞춰(`right`) 그 아래에, 메뉴·단축키는 누른 자리·블록 줄 왼쪽에 맞춰(`left`) 선다.
 */
export interface AskAnchor {
  x: number;
  y: number;
  align: "left" | "right";
}

/** 블록 하나를 가리키는 손잡이 — 우클릭 메뉴가 누른 순간에 붙든다 */
export interface AskBlockRef {
  blockId: number;
  /** 누른 **그 줄**의 블록인가 — `false` 면 이 타일의 마지막 끝난 블록으로 물러섰다(라벨이 다르다) */
  fromRow: boolean;
}

/** AI 타일 하나 — 부르는 쪽이 `agentKindOf`·`agentStatusOf`·탭 목록에서 뽑아 넘긴다 */
export interface AskTile {
  paneId: string;
  tabId: string;
  /** 로고 이름 (`"claude"` · `"codex"`) */
  ai: string;
  /** 표시 이름 (`Claude Code`) */
  name: string;
  /** 타일 코드 (`p2`) — 헤더와 같은 글자 */
  code: string;
  /** 그 탭의 이름 (다른 탭 줄에만 붙인다) */
  tabTitle: string;
  /** 그 탭의 순번 (1부터) — 다른 탭 줄의 부연 "탭 2" */
  tabIndex: number;
  /** 에이전트 점(없으면 `null`) — 실행 중이면 "답 쓰는 중" */
  status: AgentStatus | null;
  /** 사람이 마지막으로 이 타일에 포커스를 둔 시각 (없으면 `null`) */
  lastFocusedAt: number | null;
}

/** 새로 열 수 있는 AI CLI 한 줄 (`offeredAiClis` 의 모양) */
export interface AskCli {
  id: string;
  name: string;
  command: string;
}

/** 고르기 상자의 한 줄 */
export type AskRow =
  | {
      kind: "tile";
      tile: AskTile;
      /** 이 탭 · 다른 탭 */
      group: "here" | "other";
      /** "답 쓰는 중" — 표시만 한다(막지 않는다) */
      busy: boolean;
      /** "마지막에 씀" */
      last: boolean;
    }
  | {
      kind: "new";
      cli: AskCli;
      /** "기본" — 열린 AI 타일이 없을 때만 부연으로 적는다 */
      isDefault: boolean;
    }
  | {
      /** **사이드 채팅**(v2 5단계 — 결정 11) — 지금 채팅의 입력 칸에 채우기만 하고 그 타일을 연결 칩에 건다(주 창만) */
      kind: "sideChat";
      /** 지금 채팅 제목 */
      title: string;
    };

/** [`planAskTarget`] 의 답 */
export type AskPlan =
  | { mode: "direct"; tile: AskTile }
  | { mode: "pick"; rows: AskRow[]; selected: number; hasTiles: boolean };

/**
 * **받을 타일을 정한다** — 설계 노트의 표 그대로다.
 *
 * | 상황 | 답 |
 * | --- | --- |
 * | 이 탭에 AI 타일이 **정확히 하나** | `direct` — 묻지 않고 그 타일로 |
 * | 이 탭에 여럿 · 다른 탭에만 있음 | `pick` — 이 탭 먼저, 그다음 다른 탭, 끝에 새로 열기 줄 |
 * | 어디에도 없음 | `pick` — 새로 열기 줄만 |
 *
 * 무리 안에서는 **최근에 쓴 것이 위**다(포커스 시각 내림차순, 모르는 것은 화면 순서 그대로 뒤에). 골라진
 * 줄은 마지막에 포커스했던 AI 타일(없으면 첫 타일 줄), 타일이 하나도 없으면 기본 CLI 의 새로 열기 줄이다.
 * 기본 CLI 는 `defaultCli`(상태바 `>_` 메뉴에서 마지막에 쓴 것) → Claude Code → 첫 줄 순이다.
 *
 * 받는 쪽이 **원본 타일 자신**이면 뺀다(셸로 돌아온 타일이 제목 때문에 AI 로 읽히는 경우 따위).
 */
export function planAskTarget(input: {
  tiles: readonly AskTile[];
  currentTabId: string | null;
  sourcePaneId: string;
  clis: readonly AskCli[];
  defaultCli: string | null;
}): AskPlan {
  const tiles = input.tiles.filter((t) => t.paneId !== input.sourcePaneId);
  const here = tiles.filter((t) => t.tabId === input.currentTabId);
  if (here.length === 1) return { mode: "direct", tile: here[0] };

  const byRecent = (list: AskTile[]) =>
    list
      .map((t, i) => ({ t, i }))
      .sort((a, b) => {
        const fa = a.t.lastFocusedAt;
        const fb = b.t.lastFocusedAt;
        if (fa !== null && fb !== null && fa !== fb) return fb - fa;
        if (fa !== null && fb === null) return -1;
        if (fa === null && fb !== null) return 1;
        return a.i - b.i;
      })
      .map((x) => x.t);

  let lastId: string | null = null;
  let lastAt = -Infinity;
  for (const t of tiles) {
    if (t.lastFocusedAt !== null && t.lastFocusedAt > lastAt) {
      lastAt = t.lastFocusedAt;
      lastId = t.paneId;
    }
  }

  const rows: AskRow[] = [];
  const tileRow = (tile: AskTile, group: "here" | "other"): AskRow => ({
    kind: "tile",
    tile,
    group,
    busy: tile.status === "running",
    last: tile.paneId === lastId,
  });
  for (const t of byRecent(here)) rows.push(tileRow(t, "here"));
  for (const t of byRecent(tiles.filter((t) => t.tabId !== input.currentTabId))) rows.push(tileRow(t, "other"));

  const hasTiles = rows.length > 0;
  const defId = defaultCliId(input.clis, input.defaultCli);
  const clis = [...input.clis].sort((a, b) => Number(b.id === defId) - Number(a.id === defId));
  for (const cli of clis) rows.push({ kind: "new", cli, isDefault: !hasTiles && cli.id === defId });

  let selected = 0;
  if (hasTiles) {
    const at = rows.findIndex((r) => r.kind === "tile" && r.last);
    selected = at >= 0 ? at : 0;
  } else {
    const at = rows.findIndex((r) => r.kind === "new" && r.cli.id === defId);
    selected = at >= 0 ? at : 0;
  }
  return { mode: "pick", rows, selected, hasTiles };
}

/**
 * 고르기 상자에 **"사이드 채팅" 줄**을 더한다(v2 5단계 — 결정 11) — 열린 AI 타일 줄 뒤 · 새로 열기 줄 앞. 골라진 줄은 그대로(타일 줄 · 기본 CLI
 * 줄 — 사이드 채팅은 사람이 골라 간다). `title` 이 `null` 이면(주 창이 아님 · 쓸 CLI 도 채팅도 없음) 그대로. 곧장 넘기는 답(`direct`)은
 * 건드리지 않는다 — 그때는 상자가 뜨지 않는다.
 */
export function withSideChatRow(plan: AskPlan, title: string | null): AskPlan {
  if (plan.mode !== "pick" || title === null) return plan;
  const at = plan.rows.findIndex((r) => r.kind === "new");
  const pos = at < 0 ? plan.rows.length : at;
  const rows: AskRow[] = [...plan.rows.slice(0, pos), { kind: "sideChat", title }, ...plan.rows.slice(pos)];
  return { ...plan, rows, selected: plan.selected >= pos ? plan.selected + 1 : plan.selected };
}

/** 기본 CLI — 마지막에 쓴 것이 목록에 있으면 그것, 아니면 claude, 그것도 없으면 첫 줄 */
export function defaultCliId(clis: readonly AskCli[], last: string | null): string | null {
  if (last !== null && clis.some((c) => c.id === last)) return last;
  if (clis.some((c) => c.id === "claude")) return "claude";
  return clis[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// 새로 연 AI 타일 — 준비됐는가
// ---------------------------------------------------------------------------

/** 새 AI 타일을 기다리는 상한 (ms) — 넘기면 넣지 않고 알린다 */
export const ASK_READY_TIMEOUT_MS = 20_000;

/**
 * CLI 가 그린 뒤 **이만큼 조용하면** 첫 화면을 다 그렸다고 본다(ms). 예전에는 에이전트 상태 점의 "미상"
 * (출력이 3초 멎음)을 빌렸으나 점이 훅 신호만 보게 되며(docs/log/2026-10-01-agent-status-three.md) 여기로 옮겼다.
 */
export const ASK_QUIET_MS = 3000;

/** [`readyForPaste`] 가 보는 신호 */
export interface ReadySignals {
  /** 지금 시각 (`Date.now()`) */
  now: number;
  /** 셸이 그 CLI 를 **시작한** 시각(OSC 133 `C`) — 모르면 `null` */
  commandStartedAt: number | null;
  /** 그 타일의 마지막 출력 시각 */
  lastOutputAt: number | null;
  /** 그 터미널이 지금 괄호 붙여넣기 모드(DECSET 2004)인가 */
  bracketedPaste: boolean;
}

/**
 * 새로 연 AI 타일이 **붙여 넣기를 받을 준비가 됐는가** — 프로그램이 뜨기 전에 넣으면 글이 셸로 샌다.
 *
 * 세 가지가 모두 서야 한다:
 *
 * 1. 셸이 그 CLI 를 **시작했다**(`C`) — 그 전의 출력·모드는 셸의 것이다.
 * 2. 터미널이 **괄호 붙여넣기 모드**다 — TUI 가 입력을 받을 틀을 세웠다는 가장 직접적인 신호이고, 이것이
 *    없으면 여러 줄이 줄마다 Enter 로 들어간다(넣으면 안 된다).
 * 3. CLI 가 그린 **뒤에 조용해졌다** — 출력이 `C` 뒤에 있고 [`ASK_QUIET_MS`] 동안 멎었다. 그리는 중에 넣으면
 *    첫 화면이 덮어쓴다.
 */
export function readyForPaste(s: ReadySignals): boolean {
  if (s.commandStartedAt === null || !s.bracketedPaste) return false;
  return s.lastOutputAt !== null && s.lastOutputAt > s.commandStartedAt && s.now - s.lastOutputAt >= ASK_QUIET_MS;
}

// ---------------------------------------------------------------------------
// 붙여 넣는 바이트
// ---------------------------------------------------------------------------

/**
 * 터미널로 보낼 바이트 — xterm 의 `paste()` 와 **같은 변환**이다: 줄바꿈은 `\r`, 모드가 켜져 있으면
 * `ESC[200~ … ESC[201~` 로 감싼다. 모드가 꺼져 있으면 `null` — 여러 줄이 줄마다 보내지므로 넣지 않는다
 * (이 기능은 **보내지 않는다**가 약속이다).
 *
 * `paste()` 를 그대로 부르지 않는 이유는 그 길이 `onData` 를 지나 **동시 입력**에도 실리기 때문이다 — 사람이
 * 고른 AI 타일 하나에 넣는 것이지 그 탭의 모든 타일에 넣는 것이 아니다.
 */
export function pasteBytes(text: string, bracketed: boolean): string | null {
  if (!bracketed) return null;
  const body = sanitizeForPaste(text).replace(/\n/g, "\r");
  return `\x1b[200~${body}\x1b[201~`;
}
