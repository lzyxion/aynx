/**
 * **문서 코드 블록을 셸 타일에 넣기** — 순수 규칙 넷.
 *
 * 문서 타일(마크다운 보기 · 편집 중 미리 보기)의 코드 블록 머리 띠의 [터미널에 넣기]가 블록 글을 셸 타일의 **입력 줄에 넣기만**
 * 한다(Enter 는 사람이 친다). 명령 블록 → AI 타일(`$lib/ask-ai` · docs/log/2026-09-28-ask-ai-block.md)과 같은 결의 형제다 —
 * 이 파일은 그 길의 판단만 든다:
 *
 * | 무엇 | 함수 |
 * | --- | --- |
 * | 이 블록에 [터미널에 넣기]를 세우나 (셸 계열 언어) | [`isShellLang`] |
 * | 넣는 바이트 — 괄호 붙여넣기 · 한 줄 그대로 · 여러 줄은 모드가 켜졌을 때만 | [`codeInsertBytes`] |
 * | 받을 셸 타일 — 곧장 · 고르기 상자 · 새 터미널 | [`planTermTarget`] |
 * | 새로 연 셸이 입력을 받을 준비가 됐는가 | [`shellReadyForInsert`] |
 *
 * 받을 타일의 **판정은 새로 짓지 않는다** — 부르는 쪽이 세션 타일(`hasSession`)이면서 AI 타일이 아닌 것(`isAgentPane` — 탭 점 ·
 * [AI에게 묻기] 와 같은 판정)만 [`TermTile`] 로 넘긴다.
 *
 * Svelte 를 import 하지 않는다 — vitest 대상이다 (`ask-ai.ts` 와 같은 이유).
 */

import { ASK_READY_TIMEOUT_MS, pasteBytes, sanitizeForPaste } from "$lib/ask-ai";

// ---------------------------------------------------------------------------
// 셸 계열 언어
// ---------------------------------------------------------------------------

/**
 * [터미널에 넣기]를 세울 펜스 언어 — 셸 · 콘솔 · PowerShell · cmd 계열. 언어 없는 펜스도 셸로 본다(명령을 적은 문서는 대개 언어를
 * 생략한다). 그 밖(`python` · `json` …)은 [복사]만이다 — 셸에 넣어도 뜻이 없다.
 */
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

/**
 * 이 펜스 언어가 셸 계열인가 — 첫 낱말만 소문자로 본다(```` ```bash title=x ```` · ```` ```Bash ````). 없거나 빈 언어도 참.
 */
export function isShellLang(lang: string | null | undefined): boolean {
  const head = (lang ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return head === "" || SHELL_LANGS.has(head);
}

// ---------------------------------------------------------------------------
// 넣는 바이트
// ---------------------------------------------------------------------------

/** [`codeInsertBytes`] 의 답 — 넣을 바이트, 또는 넣지 않는 까닭 */
export type CodeInsert =
  | { ok: true; bytes: string }
  /** `empty` = 넣을 글이 없다 · `multiline` = 여러 줄인데 괄호 붙여넣기가 꺼져 있다(줄마다 Enter 로 실행된다) */
  | { ok: false; why: "empty" | "multiline" };

/**
 * **셸 입력 줄에 넣을 바이트** — 약속은 "실행하지 않는다" 하나다.
 *
 * 1. 글자를 정화한다(`sanitizeForPaste` — 탭 · 줄바꿈만 남기고 C0 · DEL · C1 제어 문자를 걷는다). 문서는 남의 글(AI 가 썼을 수
 *    있다)이라 ESC 한 글자가 `ESC[201~` 로 괄호 붙여넣기를 스스로 닫는 길을 막는다.
 * 2. 끝의 줄바꿈(과 그 뒤 빈 줄)을 뗀다 — 남기면 마지막 줄이 Enter 와 함께 실행된다.
 * 3. **한 줄**이면 모드가 켜져 있을 때 `ESC[200~ … ESC[201~` 로 감싸고, 꺼져 있으면 글자 그대로다(줄바꿈이 없으니 실행되지 않는다).
 * 4. **여러 줄**이면 괄호 붙여넣기 모드가 켜져 있을 때만 감싸 넣는다(줄바꿈은 `\r` — xterm `paste()` 와 같은 변환,
 *    [`pasteBytes`]). 꺼져 있으면 넣지 않는다 — 한 줄로 접는 등 말없이 모양을 바꾸지 않는다.
 *
 * `$ ` 프롬프트 글자를 떼는 가공은 하지 않는다 — 글자 그대로다(사람이 입력 줄에서 보고 고친다).
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

/** 셸 타일 하나 — 부르는 쪽이 탭 목록 · 표시 이름 · 도는 명령에서 뽑아 넘긴다 */
export interface TermTile {
  paneId: string;
  tabId: string;
  /** 표시 이름 — 로컬은 셸 이름(PowerShell …), 원격은 타일 이름(대개 호스트 별칭) */
  name: string;
  /** 원격(SSH) 타일의 호스트 별칭 — 로컬이면 `null`. 어느 서버에 넣는지 줄이 보인다 */
  host: string | null;
  /** 타일 코드 (`p2`) — 헤더와 같은 글자 */
  code: string;
  /** 그 탭의 이름 (다른 탭 줄에만 붙인다) */
  tabTitle: string;
  /** 그 탭의 순번 (1부터) — 다른 탭 줄의 부연 "탭 2" */
  tabIndex: number;
  /** 셸 통합(OSC 133)이 알려 준 **도는 명령**이 있다 — 표시만 한다(막지 않는다) */
  busy: boolean;
  /** 사람이 마지막으로 이 타일에 포커스를 둔 시각 (없으면 `null`) */
  lastFocusedAt: number | null;
}

/** 고르기 상자의 한 줄 */
export type TermRow =
  | {
      kind: "tile";
      tile: TermTile;
      /** 이 탭 · 다른 탭 */
      group: "here" | "other";
      /** "마지막에 씀" — 마지막에 포커스했던 셸 타일 */
      last: boolean;
    }
  /** 문서 타일 옆에 이 창의 기본 셸을 새로 열어 넣는다 — 늘 맨 끝 */
  | { kind: "new" };

/** [`planTermTarget`] 의 답 */
export type TermPlan =
  | { mode: "direct"; tile: TermTile }
  | { mode: "pick"; rows: TermRow[]; selected: number; hasTiles: boolean };

/**
 * **받을 셸 타일을 정한다** — `planAskTarget`(블록 → AI 타일)과 같은 표다.
 *
 * | 상황 | 답 |
 * | --- | --- |
 * | 이 탭에 셸 타일이 **정확히 하나** | `direct` — 묻지 않고 그 타일로 (다른 탭에 더 있어도) |
 * | 이 탭에 여럿 · 다른 탭에만 있음 | `pick` — 이 탭 먼저, 그다음 다른 탭, 끝에 새 터미널 줄 |
 * | 어디에도 없음 | `pick` — 새 터미널 줄만 |
 *
 * 무리 안에서는 **최근에 쓴 것이 위**다(포커스 시각 내림차순, 모르는 것은 화면 순서 그대로 뒤에). 골라진 줄은 마지막에 포커스했던
 * 셸 타일(없으면 첫 타일 줄), 타일이 하나도 없으면 새 터미널 줄이다.
 */
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

/** 새 셸을 기다리는 상한 (ms) — [AI에게 묻기] 의 새 타일 대기와 같다. 넘기면 넣지 않고 알린다 */
export const TERM_READY_TIMEOUT_MS = ASK_READY_TIMEOUT_MS;

/**
 * 셸이 첫 화면(배너 · 프롬프트)을 그린 뒤 **이만큼 화면이 그대로면** 입력을 받을 자리에 섰다고 본다(ms). AI CLI(3초 —
 * `ASK_QUIET_MS`)보다 짧다 — 셸 프롬프트는 TUI 처럼 한참 그리지 않는다. 프로필이 느린 셸은 그만큼 늦게 넣을 뿐이다.
 */
export const TERM_QUIET_MS = 1000;

/** [`shellReadyForInsert`] 가 보는 신호 */
export interface ShellReadySignals {
  /** 지금 시각 (`Date.now()`) */
  now: number;
  /** 터미널 창구가 섰고 세션이 붙었다(넣으면 `closed` 가 아니다) */
  attached: boolean;
  /** 지금 화면에 글자가 있다 — 셸이 무언가(프롬프트)를 그렸다 */
  drawn: boolean;
  /** 화면 글자가 마지막으로 바뀐 시각 — 모르면 `null` */
  changedAt: number | null;
  /** 셸 통합이 알려 준 도는 명령이 있다(프로필 · 시작 스크립트가 아직 돈다) */
  busy: boolean;
}

/**
 * 새로 연 셸이 **입력 줄에 글을 받을 준비가 됐는가** — 프롬프트가 서기 전에 넣으면 글이 시작 출력에 섞이거나 프로필 스크립트의
 * 입력으로 먹힌다. 넷이 모두 서야 한다: 세션이 붙었다 · 화면에 글자가 있다 · 도는 명령이 없다 · [`TERM_QUIET_MS`] 동안 화면이 그대로다.
 *
 * 괄호 붙여넣기 모드는 여기서 보지 않는다 — 한 줄은 모드 없이도 넣을 수 있고, 여러 줄인데 모드가 꺼져 있으면 넣는 순간
 * [`codeInsertBytes`] 가 거절해 그 까닭을 알린다(cmd.exe 처럼 모드를 켜지 않는 셸이 시한까지 기다리지 않게).
 */
export function shellReadyForInsert(s: ShellReadySignals): boolean {
  if (!s.attached || !s.drawn || s.busy || s.changedAt === null) return false;
  return s.now - s.changedAt >= TERM_QUIET_MS;
}
