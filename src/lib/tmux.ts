/**
 * tmux 세션 목록 · 전환(간이 모드 타일). 목록에는 사람이 만든 세션도 뜨므로 이름 모양을 잠그지 않는다 —
 * 셸에 넣을 때는 언제나 [`shQuote`], 제어문자(개행은 인용으로 못 막는다)는 [`isSafeTmuxName`] 이 막는다.
 * 백엔드에도 같은 규칙이 한 벌 있다(`ssh/remote_cmd.rs` 의 `sh_quote` · `safe_tmux_target`).
 */

import { invoke } from "./ipc";
import { writeSessionById, type Tr } from "$lib/session";

// 문구는 인자로 받는다 — vitest 가 돌리는 순수 모듈이라 `i18n.svelte.ts`(룬)를 들여올 수 없다.
// 기본값은 두지 않는다 — 있으면 인자를 빠뜨린 화면이 조용히 한국어로 남는다.

/** `tmux ls -F` 한 줄 (Rust `TmuxSessionInfo` 와 같은 모양) */
export interface TmuxSessionInfo {
  name: string;
  windows: number;
  attached: number;
  /** Unix epoch 초 */
  created: number;
}

/** POSIX sh 작은따옴표 인용 — `'` 를 `'\''` 로 바꾸고 전체를 감싸면 어떤 문자열도 한 낱말로 들어간다 */
export function shQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/** 모양(`aynx-N`)은 보지 않는다 — 목록에서 고른 남의 세션 이름을 그대로 쓴다. 인용이 못 막는 개행을 여기서 막는다 */
export function isSafeTmuxName(name: string): boolean {
  const t = name.trim();
  // eslint 도 svelte-check 도 제어문자 리터럴을 싫어하므로 코드포인트로 본다.
  return (
    t.length > 0 &&
    t.length <= 128 &&
    ![...t].some((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c < 0x20 || c === 0x7f;
    })
  );
}

/**
 * 타일의 PTY 에 써 넣을 전환 한 줄. `attach` 가 아니라 `switch-client` — 이미 붙은 클라이언트 안에서 tmux 를 또 열면 거절당한다.
 * 엔터는 `\r` — 접속 한 줄(`tmux_bootstrap`)과 같은, 사람이 친 것과 같은 바이트다.
 * 알고 받은 한계: 그 순간 전체 화면 프로그램(vim · less · top)이 돌면 그 프로그램이 이 입력을 받는다.
 * prefix 키를 대신 보내는 길은 쓰지 않는다 — 사용자가 prefix 를 바꿨으면 조용히 엉뚱한 키가 된다.
 * 사람이 누른 항목이 내는, 앱이 조립한 고정 한 줄이다 — 원시 문자열을 PTY 에 미는 길이 아니다(AGENTS.md 보안 제약).
 */
export function tmuxSwitchCommand(name: string): string {
  return `tmux switch-client -t ${shQuote(name)}\r`;
}

/** 못 읽으면(세션 · tmux · 서버 없음) 오류가 아니라 빈 배열이다(Rust `ssh_tmux_list` 의 계약) */
export async function listTmuxSessions(sessionId: number): Promise<TmuxSessionInfo[]> {
  return await invoke<TmuxSessionInfo[]>("ssh_tmux_list", { id: sessionId });
}

/**
 * 프런트는 이름만 준다 — 명령 조립(`tmux_kill_command` — `-t '=<이름>'` 정확 일치) · 이름 검사(`killable_tmux_name`)는 Rust 한 곳이다.
 * 목록과 달리 실패는 오류다.
 */
export async function killTmuxSession(sessionId: number, name: string): Promise<void> {
  await invoke<void>("ssh_tmux_kill", { id: sessionId, name });
}

/** `here` = 이 타일이 지금 붙어 있는 세션(`PaneSpec.tmux`) — 붙은 클라이언트 수에서 자기 몫 1 을 뺀다 */
export function tmuxKillPrompt(
  s: Pick<TmuxSessionInfo, "name" | "attached" | "windows">,
  here: boolean,
  tr: Tr,
): { title: string; body: string; okLabel: string; points: string[] } {
  const others = Math.max(0, s.attached - (here ? 1 : 0));
  const points: string[] = [];
  if (here) points.push(tr("pane.tmux.kill.here"));
  if (others > 0) points.push(tr("pane.tmux.kill.others", { n: others }));
  points.push(tr("pane.tmux.kill.windows", { n: s.windows }));
  return {
    title: here ? tr("pane.tmux.kill.title_here") : tr("pane.tmux.kill.title"),
    body: tr("pane.tmux.kill.body", { name: s.name }),
    okLabel: here ? tr("pane.tmux.kill.ok_here") : tr("pane.tmux.kill.ok"),
    points,
  };
}

/** 여느 입력과 같은 `write_session`(이 창의 임대를 싣는다)으로 쓴다 — 사람이 직접 쳐도 같은 한 줄이라 따로 통로를 만들지 않는다 */
export async function switchTmuxSession(
  sessionId: number,
  name: string,
  tr: Tr,
): Promise<void> {
  if (!isSafeTmuxName(name)) throw new Error(tr("pane.tmux.bad_name"));
  await writeSessionById("ssh", sessionId, tmuxSwitchCommand(name.trim()));
}

/** `created` 는 초(Unix epoch) · `now` 는 밀리초 — tmux 와 `Date.now()` 의 단위를 그대로 받는다 */
export function relativeCreated(
  created: number,
  now: number,
  tr: Tr,
): string {
  const sec = Math.floor(now / 1000) - created;
  if (!Number.isFinite(sec)) return "";
  // 서버 시계가 앞서면 음수가 나온다 — "방금" 으로 접는다
  if (sec < 60) return tr("pane.tmux.ago.now");
  const min = Math.floor(sec / 60);
  if (min < 60) return tr("pane.tmux.ago.minutes", { n: min });
  const hour = Math.floor(min / 60);
  if (hour < 24) return tr("pane.tmux.ago.hours", { n: hour });
  return tr("pane.tmux.ago.days", { n: Math.floor(hour / 24) });
}

export function tmuxSummary(list: readonly TmuxSessionInfo[]): { attached: number; empty: number } {
  const attached = list.filter((s) => s.attached > 0).length;
  return { attached, empty: list.length - attached };
}
