/**
 * **tmux 세션 목록·전환** — 간이 모드 타일이 "서버에 뭐가 있나" 를 묻고 그 사이를 옮겨 다니는
 * 길 (docs/log/2026-09-16-tmux-toggle.md).
 *
 * 이 파일은 **순수 규칙 + 얇은 invoke** 다. 그리는 일은 `pane/TmuxMenu.svelte` 가 하고,
 * 어느 타일이 대상인지는 `PaneHost` 가 안다.
 *
 * ## 이름은 서버가 준다
 *
 * 타일이 물고 있는 `aynx-N` 은 앱이 만든 이름이라 모양을 잠글 수 있었다(`valid_tmux_name`).
 * 목록에는 **사람이 손으로 만든 세션**이 함께 뜨고, 그 이름에는 공백·한글·따옴표가 들어 있다.
 * 그래서 이쪽의 안전 규칙은 모양이 아니라 **위험**이다:
 *
 * - 셸에 넣을 때는 언제나 [`shQuote`] — 작은따옴표 안에서는 `$`·백틱·백슬래시가 전부 글자다.
 * - 제어문자(개행 포함)는 [`isSafeTmuxName`] 이 막는다. 개행은 `'…'` 안에서도 **새 명령줄**이
 *   되는 유일한 탈출구라, 인용만으로는 못 막는다.
 *
 * 백엔드에도 같은 규칙이 한 벌 있다 (`ssh.rs` 의 `sh_quote`·`safe_tmux_target`) — 그쪽은
 * 접속 줄(`new-session -s …`)과 폴더 질의를, 이쪽은 PTY 로 쓰는 전환 명령을 맡는다.
 */

import { invoke } from "./ipc";
import { writeSessionById, type Tr } from "$lib/session";

// 문구는 **인자로** 들어온다 — 이 파일은 vitest 가 그대로 돌리는 순수 모듈이라
// `i18n.svelte.ts`(룬)를 들여올 수 없다 (`i18n/ko/pane.ts` 머리말). 기본값은 두지 않는다:
// 있으면 인자를 빠뜨린 화면이 조용히 한국어로 남는다.

/** `tmux ls -F` 한 줄 (Rust `TmuxSessionInfo` 와 같은 모양) */
export interface TmuxSessionInfo {
  /** 세션 이름 — 서버가 준 값 그대로다 */
  name: string;
  /** 창 개수 */
  windows: number;
  /** 붙어 있는 클라이언트 수 — 0 이면 비어 있다 */
  attached: number;
  /** 만든 시각 (Unix epoch 초) */
  created: number;
}

/**
 * POSIX sh 의 작은따옴표 인용 — `'` 하나를 `'\''` 로 바꾸고 전체를 `'…'` 로 감싼다.
 *
 * (닫기 · 이스케이프된 따옴표 · 다시 열기). 작은따옴표 안에서는 나머지가 전부 글자이므로
 * 이 한 가지 치환만 제대로 하면 **어떤 문자열도 한 낱말**로 들어간다.
 */
export function shQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/**
 * 이 이름을 셸 명령에 실어도 되는가 — **제어문자가 없고 비어 있지 않은가**.
 *
 * 모양(`aynx-N`)은 보지 않는다: 목록에서 고른 남의 세션 이름을 그대로 쓰기 때문이다.
 * 인용([`shQuote`])이 못 막는 것은 개행 하나뿐이고, 그것을 여기서 막는다.
 */
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
 * 타일의 PTY 에 그대로 써 넣을 **전환 한 줄** — `tmux switch-client -t '<name>'` + 엔터.
 *
 * `switch-client` 인 이유: 이 타일의 tmux **클라이언트는 이미 붙어 있다**. 새 세션에 붙는 것이
 * 아니라 **보고 있는 세션만 갈아 끼우는** 것이라, 붙어 있는 화면이 그 자리에서 바뀐다
 * (`attach` 를 쓰면 tmux 안에서 tmux 를 여는 꼴이라 거절당한다).
 *
 * 엔터가 `\r` 인 이유는 접속 한 줄(`tmux_bootstrap`)과 같다 — **사람이 친 것과 같은 바이트**다.
 *
 * ## 한계 (정직하게)
 *
 * 이것은 **타일의 입력 큐에 들어가는 글자들**이다. 그 순간 tmux 패널에서 전체 화면 프로그램
 * (vim·less·top)이 돌고 있으면 **그 프로그램이 이 입력을 받는다** — 셸의 프롬프트가 아니라.
 * 앱이 그것을 미리 알 방법은 없다(간이 모드라 도는 명령을 모른다). 대신 결과가 **화면에 그대로
 * 보이므로** 사용자가 즉시 알아채고 되돌릴 수 있다. 프롬프트에서 누르는 것이 맞다.
 *
 * (tmux 의 prefix 키를 대신 보내는 길도 있지만 — `Ctrl+B` `:` — 그것은 사용자가 prefix 를
 * 바꿨을 때 조용히 엉뚱한 키를 보낸다. 모르는 값을 짐작하느니 보이는 자리에서 실패한다.)
 *
 * ⚠ 이것은 **AI 가 아니라 사람이 누른 항목**이 내는 입력이다. 원시 문자열을 PTY 에 밀어 넣는
 * 길을 새로 여는 것이 아니라, 앱이 조립한 고정된 한 줄이 나간다 (CLAUDE.md 의 보안 제약).
 */
export function tmuxSwitchCommand(name: string): string {
  return `tmux switch-client -t ${shQuote(name)}\r`;
}

/**
 * 서버에 있는 tmux 세션 목록. 못 읽으면(세션이 없다·tmux 가 없다·서버가 안 떴다) **빈 배열**이다
 * — 오류가 아니라 "없음" 이다 (Rust `ssh_tmux_list` 의 계약).
 */
export async function listTmuxSessions(sessionId: number): Promise<TmuxSessionInfo[]> {
  return await invoke<TmuxSessionInfo[]>("ssh_tmux_list", { id: sessionId });
}

/**
 * 서버의 tmux 세션 하나를 **끈다**(`tmux kill-session`) — 목록 팝오버의 끄기 단추가 확인 대화 뒤에 부른다.
 *
 * 프런트는 **이름만** 준다. 명령은 Rust 의 고정 조립 함수(`tmux_kill_command` — `-t '=<이름>'` 정확 일치)가 짓고,
 * 이름의 모양 검사(`killable_tmux_name`)도 그쪽 한 곳이다 — 여기서 글자를 짓거나 같은 규칙을 두 벌 두지 않는다.
 * 목록과 달리 **실패는 오류**다(꺼지지 않았으면 그렇게 말한다).
 */
export async function killTmuxSession(sessionId: number, name: string): Promise<void> {
  await invoke<void>("ssh_tmux_kill", { id: sessionId, name });
}

/**
 * 끄기 확인 대화의 글 — **순수**(vitest). `here` = 이 타일이 지금 붙어 있는 세션(`PaneSpec.tmux`).
 *
 * - 이 타일의 세션이면 제목 · 확인 단추부터 다르게 말하고 "이 타일의 연결도 끝난다" 를 첫 점으로 든다 — 붙은 타일의
 *   tmux 클라이언트가 함께 끝나 그 타일의 셸(`exec tmux …`)이 사라진다.
 * - 다른 클라이언트가 붙어 있으면(`attached` — 이 타일이 붙은 세션이면 자기 몫 1 을 뺀다) 그 화면도 끝난다고 든다.
 * - 늘: 창 수와 "되돌릴 수 없다".
 */
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

/**
 * 이 타일이 보고 있는 tmux 세션을 바꾼다 — PTY 에 [`tmuxSwitchCommand`] 한 줄을 쓴다.
 *
 * 쓰는 길은 **여느 입력과 같은 `write_session`**(이 창의 임대를 싣는다)다. 따로 통로를 만들지 않는 이유는, 이 명령이
 * 사람이 직접 쳤어도 똑같이 동작하는 한 줄이기 때문이다.
 */
export async function switchTmuxSession(
  sessionId: number,
  name: string,
  tr: Tr,
): Promise<void> {
  if (!isSafeTmuxName(name)) throw new Error(tr("pane.tmux.bad_name"));
  // 이 창 손잡이의 임대를 싣는다(세션 코어 — `writeSessionById`).
  await writeSessionById("ssh", sessionId, tmuxSwitchCommand(name.trim()));
}

/**
 * 만든 시각을 **짧은 나이 한 마디**로 — 목록 줄의 꼬리 칸이다 (`2시간` · `5일` · `방금`).
 *
 * 절대 시각을 쓰지 않는 이유: 사람이 목록에서 찾는 것은 "언제 만들었나" 가 아니라 "아까 그
 * 세션이 어느 것인가" 다. 줄이 한 줄로 접히면서(2026-10-05) `전` 도 뗐다 — 좁은 꼬리 칸에
 * 숫자와 단위만 선다. 일주일이 넘어도 날짜로 바꾸지 않고 날 수로 센다(칸 폭이 일정하다).
 *
 * `created` 는 **초**(Unix epoch)이고 `now` 는 **밀리초**다 — tmux 와 `Date.now()` 의 단위를
 * 그대로 받아 이 안에서 맞춘다.
 */
export function relativeCreated(
  created: number,
  now: number,
  tr: Tr,
): string {
  const sec = Math.floor(now / 1000) - created;
  if (!Number.isFinite(sec)) return "";
  // 서버 시계가 앞서 있으면 음수가 나온다 — "방금" 으로 접는다(틀린 미래를 말하지 않는다).
  if (sec < 60) return tr("pane.tmux.ago.now");
  const min = Math.floor(sec / 60);
  if (min < 60) return tr("pane.tmux.ago.minutes", { n: min });
  const hour = Math.floor(min / 60);
  if (hour < 24) return tr("pane.tmux.ago.hours", { n: hour });
  return tr("pane.tmux.ago.days", { n: Math.floor(hour / 24) });
}

/** 붙어 있는 세션 수 · 비어 있는 세션 수 — 팝오버 머리글과 칩 카드의 `●n ○m` 요약 */
export function tmuxSummary(list: readonly TmuxSessionInfo[]): { attached: number; empty: number } {
  const attached = list.filter((s) => s.attached > 0).length;
  return { attached, empty: list.length - attached };
}
