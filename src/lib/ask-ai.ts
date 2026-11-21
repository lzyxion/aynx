/**
 * 명령 블록을 AI 타일에 넘기는 순수 규칙 — 입력 줄에 붙여 넣기만 한다(Enter 는 사람이 누른다).
 * Svelte 를 import 하지 않는다 — vitest 대상이다.
 */

import type { AgentStatus } from "$lib/agent-status";
import { formatDuration } from "$lib/finish-notify";
import type { Tr } from "$lib/session";

// ── 출력 끝부분 ──

/** 넘치면 앞을 버린다(오류는 대개 끝에 있다). 바이트는 UTF-8 로 잰다 — 블록 이력의 UTF-16 단위와 다르다. */
export interface AskCaps {
  tailLines: number;
  tailBytes: number;
}

export const ASK_CAPS: AskCaps = { tailLines: 40, tailBytes: 8 * 1024 };

/** 블록 이력의 발췌가 `partial` 이면 몇 줄을 버렸는지 모른다 — `"some"`. */
export interface AskOutput {
  lines: readonly string[];
  droppedBefore: number | "some";
}

export interface AskTail {
  lines: string[];
  omitted: number | "some";
}

const encoder = new TextEncoder();
const bytesOf = (s: string): number => encoder.encode(s).length;

/** 한 줄이 이미 바이트 상한보다 길면 그 줄의 끝만 남긴다 — 빈 출력보다 잘린 한 줄이 낫다. */
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

/** 코드 포인트를 반으로 자르지 않는다 */
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

// ── 넘길 글 ──

export interface AskInput {
  commandLine: string;
  exit: number | null;
  durationMs: number | null;
  host: string;
  cwd: string | null;
  /** `null` 이면 못 읽었다 */
  output: AskOutput | null;
}

/**
 * 명령문과 출력은 남의 것이다 — ESC 한 글자가 살아 있으면 `ESC[201~` 로 괄호 붙여넣기를 스스로 닫고 그 뒤를 키 입력으로 만든다.
 * 탭 · 줄바꿈만 남기고 제어 문자를 뺀다.
 */
export function sanitizeForPaste(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

/** 끝은 줄바꿈 하나다 — 커서가 다음 줄 첫 칸에 서서 사람이 한마디 보탠 뒤 Enter 를 누른다. */
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

export function askSummary(commandLine: string, exit: number | null, tr: Tr, max = 32): string {
  const first = commandLine.trim().split("\n")[0] ?? "";
  const cmd = [...first].length > max ? [...first].slice(0, max - 1).join("") + "…" : first;
  return exit === null ? cmd : tr("pane.askai.summary", { command: cmd, exit });
}

// ── 받을 타일 ──

/** `x` 는 `align` 쪽 가장자리 · `y` 는 상자의 위 가장자리 */
export interface AskAnchor {
  x: number;
  y: number;
  align: "left" | "right";
}

export interface AskBlockRef {
  blockId: number;
  /** `false` 면 이 타일의 마지막 끝난 블록으로 물러섰다 */
  fromRow: boolean;
}

export interface AskTile {
  paneId: string;
  tabId: string;
  ai: string;
  name: string;
  code: string;
  tabTitle: string;
  /** 1부터 */
  tabIndex: number;
  status: AgentStatus | null;
  lastFocusedAt: number | null;
}

export interface AskCli {
  id: string;
  name: string;
  command: string;
}

export type AskRow =
  | {
      kind: "tile";
      tile: AskTile;
      group: "here" | "other";
      /** 표시만 한다(막지 않는다) */
      busy: boolean;
      last: boolean;
    }
  | {
      kind: "new";
      cli: AskCli;
      isDefault: boolean;
    }
  | {
      /** 사이드 채팅 — 입력 칸에 채우기만 한다(주 창만) */
      kind: "sideChat";
      title: string;
    };

export type AskPlan =
  | { mode: "direct"; tile: AskTile }
  | { mode: "pick"; rows: AskRow[]; selected: number; hasTiles: boolean };

/**
 * 이 탭에 AI 타일이 정확히 하나면 묻지 않고 그 타일로(`direct`), 아니면 고르기 상자(`pick`).
 * 원본 타일 자신은 뺀다 — 셸로 돌아온 타일이 제목 때문에 AI 로 읽히는 경우.
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

/** 골라진 줄은 그대로 둔다 — 사이드 채팅은 사람이 골라 간다. */
export function withSideChatRow(plan: AskPlan, title: string | null): AskPlan {
  if (plan.mode !== "pick" || title === null) return plan;
  const at = plan.rows.findIndex((r) => r.kind === "new");
  const pos = at < 0 ? plan.rows.length : at;
  const rows: AskRow[] = [...plan.rows.slice(0, pos), { kind: "sideChat", title }, ...plan.rows.slice(pos)];
  return { ...plan, rows, selected: plan.selected >= pos ? plan.selected + 1 : plan.selected };
}

export function defaultCliId(clis: readonly AskCli[], last: string | null): string | null {
  if (last !== null && clis.some((c) => c.id === last)) return last;
  if (clis.some((c) => c.id === "claude")) return "claude";
  return clis[0]?.id ?? null;
}

// ── 새로 연 AI 타일 — 준비됐는가 ──

export const ASK_READY_TIMEOUT_MS = 20_000;

export const ASK_QUIET_MS = 3000;

export interface ReadySignals {
  now: number;
  /** OSC 133 `C` */
  commandStartedAt: number | null;
  lastOutputAt: number | null;
  /** DECSET 2004 */
  bracketedPaste: boolean;
}

/**
 * 프로그램이 뜨기 전에 넣으면 글이 셸로 샌다 — 셋 다 서야 한다: 셸이 그 CLI 를 시작했다(`C`) · 괄호 붙여넣기 모드다
 * (없으면 여러 줄이 줄마다 Enter 로 들어간다) · `C` 뒤에 그리고 [`ASK_QUIET_MS`] 동안 조용했다(그리는 중에 넣으면 첫 화면이 덮어쓴다).
 */
export function readyForPaste(s: ReadySignals): boolean {
  if (s.commandStartedAt === null || !s.bracketedPaste) return false;
  return s.lastOutputAt !== null && s.lastOutputAt > s.commandStartedAt && s.now - s.lastOutputAt >= ASK_QUIET_MS;
}

// ── 붙여 넣는 바이트 ──

/**
 * xterm `paste()` 와 같은 변환이다. 모드가 꺼져 있으면 `null` — 여러 줄이 줄마다 보내지므로 넣지 않는다(보내지 않는 것이 약속이다).
 * `paste()` 를 부르지 않는다 — 그 길은 `onData` 를 지나 동시 입력에도 실린다.
 */
export function pasteBytes(text: string, bracketed: boolean): string | null {
  if (!bracketed) return null;
  const body = sanitizeForPaste(text).replace(/\n/g, "\r");
  return `\x1b[200~${body}\x1b[201~`;
}
