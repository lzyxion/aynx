/**
 * 코드 블록의 [터미널에 넣기] — 셸 타일의 입력 줄에 넣기만 하고 실행하지 않는다(Enter 는 사람이 친다).
 * Svelte 를 import 하지 않는다 — vitest 대상이다.
 */

import { ASK_READY_TIMEOUT_MS, pasteBytes, sanitizeForPaste } from "$lib/ask-ai";

// ---------------------------------------------------------------------------
// 셸 계열 언어
// ---------------------------------------------------------------------------

const SHELL_LANGS: ReadonlySet<string> = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "ksh",
  "shell",
  "shellsession",
  "console",
  "terminal",
  "powershell",
  "ps1",
  "pwsh",
  "cmd",
  "bat",
  "batch",
]);

/** 언어 없는 펜스도 셸로 본다 — 명령을 적은 문서는 대개 언어를 생략한다 */
export function isShellLang(lang: string | null | undefined): boolean {
  const head = langHead(lang);
  return head === "" || SHELL_LANGS.has(head);
}

function langHead(lang: string | null | undefined): string {
  return (lang ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

// ---------------------------------------------------------------------------
// 넣을 글 — 주석 줄 · 빈 줄 빼기
// ---------------------------------------------------------------------------

const CMD_LANGS: ReadonlySet<string> = new Set(["cmd", "bat", "batch"]);

/**
 * 줄 전체가 주석인 줄과 빈 줄을 뺀다 — 줄 안의 `#` 는 해석하지 않는다(문자열 · URL 조각 · `$#` 를 깨지 않게).
 * 알고 받은 한계: 여러 줄 문자열 · heredoc 안의 `#` 줄도 뺀다(사람이 입력 줄에서 보고 고친다).
 */
export function codeForTerm(code: string, lang: string | null | undefined): string {
  const comment = CMD_LANGS.has(langHead(lang)) ? /^\s*(?:rem(?:\s|$)|::)/i : /^\s*#/;
  return code
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== "" && !comment.test(line))
    .join("\n");
}

// ---------------------------------------------------------------------------
// 넣는 바이트
// ---------------------------------------------------------------------------

export type CodeInsert =
  | { ok: true; bytes: string }
  /** `multiline` = 여러 줄인데 괄호 붙여넣기가 꺼져 있다(줄마다 Enter 로 실행된다) */
  | { ok: false; why: "empty" | "multiline" };

/**
 * 약속은 "실행하지 않는다" 하나다. 정화는 남의 글(AI 가 썼을 수 있다)의 ESC 가 `ESC[201~` 로 괄호 붙여넣기를 닫는 길을 막는다.
 * 끝 줄바꿈을 남기면 마지막 줄이 실행된다. 여러 줄은 모드가 꺼져 있으면 넣지 않는다 — 말없이 모양을 바꾸지 않는다.
 */
export function codeInsertBytes(code: string, bracketed: boolean): CodeInsert {
  const body = sanitizeForPaste(code).replace(/\n\s*$/, "");
  if (body.trim() === "") return { ok: false, why: "empty" };
  if (!body.includes("\n")) return { ok: true, bytes: bracketed ? `\x1b[200~${body}\x1b[201~` : body };
  const bytes = pasteBytes(body, bracketed);
  return bytes === null ? { ok: false, why: "multiline" } : { ok: true, bytes };
}

// ---------------------------------------------------------------------------
// 받을 셸 타일
// ---------------------------------------------------------------------------

/** 부르는 쪽이 세션 타일이면서 AI 타일이 아닌 것(`isAgentPane`)만 넘긴다 */
export interface TermTile {
  paneId: string;
  tabId: string;
  name: string;
  /** 원격 타일의 호스트 별칭 — 로컬이면 `null` */
  host: string | null;
  code: string;
  tabTitle: string;
  /** 1부터 */
  tabIndex: number;
  /** 표시만 한다(막지 않는다) */
  busy: boolean;
  lastFocusedAt: number | null;
}

export type TermRow =
  | {
      kind: "tile";
      tile: TermTile;
      group: "here" | "other";
      last: boolean;
    }
  | { kind: "new" };

export type TermPlan =
  | { mode: "direct"; tile: TermTile }
  | { mode: "pick"; rows: TermRow[]; selected: number; hasTiles: boolean };

/** `planAskTarget`(블록 → AI 타일)과 같은 표다 */
export function planTermTarget(input: { tiles: readonly TermTile[]; currentTabId: string | null }): TermPlan {
  const here = input.tiles.filter((t) => t.tabId === input.currentTabId);
  if (here.length === 1) return { mode: "direct", tile: here[0] };

  const byRecent = (list: readonly TermTile[]) =>
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
  for (const t of input.tiles) {
    if (t.lastFocusedAt !== null && t.lastFocusedAt > lastAt) {
      lastAt = t.lastFocusedAt;
      lastId = t.paneId;
    }
  }

  const rows: TermRow[] = [];
  for (const t of byRecent(here)) rows.push({ kind: "tile", tile: t, group: "here", last: t.paneId === lastId });
  for (const t of byRecent(input.tiles.filter((t) => t.tabId !== input.currentTabId))) {
    rows.push({ kind: "tile", tile: t, group: "other", last: t.paneId === lastId });
  }
  const hasTiles = rows.length > 0;
  rows.push({ kind: "new" });

  let selected = 0;
  if (hasTiles) {
    const at = rows.findIndex((r) => r.kind === "tile" && r.last);
    selected = at >= 0 ? at : 0;
  }
  return { mode: "pick", rows, selected, hasTiles };
}

// ---------------------------------------------------------------------------
// 새로 연 셸 — 준비됐는가
// ---------------------------------------------------------------------------

export const TERM_READY_TIMEOUT_MS = ASK_READY_TIMEOUT_MS;

/** 첫 화면을 그린 뒤 이만큼 화면이 그대로면 입력을 받을 자리에 섰다고 본다(ms) */
export const TERM_QUIET_MS = 1000;

export interface ShellReadySignals {
  now: number;
  attached: boolean;
  drawn: boolean;
  changedAt: number | null;
  busy: boolean;
}

/**
 * 프롬프트가 서기 전에 넣으면 글이 시작 출력에 섞이거나 프로필 스크립트의 입력으로 먹힌다.
 * 괄호 붙여넣기 모드는 여기서 보지 않는다 — cmd.exe 처럼 모드를 켜지 않는 셸이 시한까지 기다리지 않게.
 */
export function shellReadyForInsert(s: ShellReadySignals): boolean {
  if (!s.attached || !s.drawn || s.busy || s.changedAt === null) return false;
  return s.now - s.changedAt >= TERM_QUIET_MS;
}
