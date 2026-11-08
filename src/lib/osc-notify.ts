/**
 * **프로그램이 보낸 데스크톱 알림 — OSC 9 · OSC 777** · 순수 파서
 * (docs/log/2026-09-26-osc-notify-inline-images.md).
 *
 * 빌드 스크립트·테스트 러너·장기 작업이 끝에 `printf '\e]9;build done\a'` 를 찍으면, 그것을
 * 받은 터미널이 사람에게 알린다. 두 갈래가 있다:
 *
 * ```
 * OSC 9 ; <본문> ST                      ← iTerm2 식 (본문만)
 * OSC 777 ; notify ; <제목> ; <본문> ST   ← rxvt-unicode · foot · WezTerm · Ghostty 식
 * ```
 *
 * ## OSC 9 의 숫자 하위 명령은 알림이 **아니다**
 *
 * ConEmu·Windows Terminal 은 같은 번호에 하위 명령을 얹었다 — `9;4;…`(진행률) ·
 * `9;9;…`(현재 폴더 — `shell-integration.ts` 가 따로 받는다). 본문이 `숫자` 또는
 * `숫자;` 로 시작하면 [`parseOsc9Notify`] 는 `null` 을 주고, 핸들러는 `false` 를 돌려
 * **다음 소비자에게 넘긴다**. 그래서 딱 숫자 하나뿐인 본문(`9;42`)도 알림으로 치지 않는다 —
 * 그것이 하위 명령인지 문구인지 가를 길이 없고, 틀렸을 때 싼 쪽이 "안 띄운다" 다.
 *
 * ## 원격 프로그램은 믿지 않는다 — 글자를 다듬는다
 *
 * 본문은 서버에서 도는 아무 프로그램이 정한다. 그래서 [`sanitizeNotifyText`] 가 제어 문자
 * (C0·C1)와 양방향 재배치 문자(글자 순서를 뒤집어 보이게 하는 U+202A–202E · U+2066–2069)를
 * 걷고, 공백을 한 칸으로 접고, 길이를 자른다(제목 [`NOTIFY_TITLE_MAX`] · 본문
 * [`NOTIFY_BODY_MAX`]). **알림 제목은 이 모듈이 정하지 않는다** — 늘 앱과 타일 이름
 * (`aynx · web-01`)이고 그것은 `app/osc-notify.ts` 가 붙인다. 프로그램이 준 제목(777)은
 * [`programNotifyText`] 가 **본문 앞머리**로 내린다: 프로그램이 앱 자신의 알림처럼 보이는
 * 한 장을 만들 수 없게.
 *
 * 룬도 DOM 도 Tauri 도 없다 — `osc52.ts` 와 같은 모양이고 vitest 로 그대로 돈다
 * (`osc-notify.test.ts`).
 */

/** 프로그램이 준 제목(777)의 최대 글자 수 — 넘으면 `…` 로 자른다 */
export const NOTIFY_TITLE_MAX = 80;
/** 본문의 최대 글자 수 — 넘으면 `…` 로 자른다 (OS 알림 한 장이 담는 분량) */
export const NOTIFY_BODY_MAX = 240;

/**
 * 프로그램 알림 한 장. `title` 은 777 에서만 온다(OSC 9 는 늘 빈 문자열).
 * 둘 다 이미 [`sanitizeNotifyText`] 를 거친 값이다.
 */
export interface ProgramNotice {
  title: string;
  body: string;
}

/**
 * 한 줄로 다듬는다 — 제어 문자·양방향 재배치 문자는 공백으로, 공백 뭉치는 한 칸으로,
 * 앞뒤는 잘라 내고, `max` 글자(코드 포인트 기준 — 서로게이트 쌍을 가르지 않는다)를 넘으면
 * 끝을 `…` 로 바꾼다.
 *
 * 공백으로 **바꾸는** 이유: 그냥 지우면 `a\nb` 가 `ab` 로 붙어 다른 낱말이 된다.
 */
export function sanitizeNotifyText(raw: string, max: number): string {
  const flat = raw
    // C0 (0x00–0x1F) · DEL (0x7F) · C1 (0x80–0x9F) · 양방향 재배치(LRE…RLO · LRI…PDI)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  return chars.slice(0, Math.max(0, max - 1)).join("").trimEnd() + "…";
}

/** ConEmu·Windows Terminal 의 하위 명령 모양 — `4;…` · `9;…` · 숫자 하나 */
const OSC9_SUBCOMMAND = /^\d+(;|$)/;

/**
 * `OSC 9` 의 본문(`9;` 를 뗀 나머지) → 알림, 아니면 `null`.
 *
 * `null` 은 "우리 것이 아니다" 다 — 핸들러는 `false` 를 돌려 다른 소비자(9;9 현재 폴더)에게
 * 넘긴다. OSC 52 와 달리 이 번호는 뜻이 여럿이다 (머리말).
 */
export function parseOsc9Notify(data: string): ProgramNotice | null {
  if (OSC9_SUBCOMMAND.test(data)) return null;
  const body = sanitizeNotifyText(data, NOTIFY_BODY_MAX);
  if (body === "") return null;
  return { title: "", body };
}

/**
 * `OSC 777` 의 본문(`777;` 를 뗀 나머지) → 알림, 아니면 `null`.
 *
 * `notify;<제목>;<본문>` 만 받는다. 본문 안의 `;` 는 **그대로 둔다** — 첫 두 칸만 가르고
 * 나머지는 전부 본문이다(`make: done; 3 warnings` 가 잘리지 않게). 제목만 있고 본문 칸이
 * 없는 것(`notify;Title`)도 받는다. 둘 다 비면 `null`. 다른 하위 명령(`777;preexec` 등)은
 * `null` — 핸들러가 `false` 로 넘긴다.
 */
export function parseOsc777Notify(data: string): ProgramNotice | null {
  const first = data.indexOf(";");
  if (first < 0 || data.slice(0, first) !== "notify") return null;
  const rest = data.slice(first + 1);
  const second = rest.indexOf(";");
  const rawTitle = second < 0 ? rest : rest.slice(0, second);
  const rawBody = second < 0 ? "" : rest.slice(second + 1);
  const title = sanitizeNotifyText(rawTitle, NOTIFY_TITLE_MAX);
  const body = sanitizeNotifyText(rawBody, NOTIFY_BODY_MAX);
  if (title === "" && body === "") return null;
  return { title, body };
}

/**
 * 알림 한 장 → 사람에게 보일 **본문 한 줄**. 프로그램의 제목이 있으면 `제목 — 본문`,
 * 한쪽만 있으면 그쪽만.
 *
 * 제목을 알림의 제목 칸에 올리지 않는 것이 요점이다 (머리말) — 제목 칸은 앱이 쥔다.
 */
export function programNotifyText(n: ProgramNotice): string {
  if (n.title && n.body) return `${n.title} — ${n.body}`;
  return n.title || n.body;
}

/** 한 타일에서 알림을 띄우는 최소 간격 — 원격 복사 토스트와 같은 2초 */
export const PROGRAM_NOTIFY_GAP_MS = 2000;

/**
 * 속도 제한 한 벌 — 부를 때마다 "지금 띄워도 되나" 를 답한다. 통과하면 시계를 그 자리로
 * 옮기고, 막히면 **버린다**(쌓아 두었다 나중에 띄우지 않는다 — 폭주하는 루프가 보낸 알림
 * 천 장을 2초에 한 장씩 꺼내 주는 것은 제한이 아니다).
 *
 * 타일마다 한 벌을 만든다(`term/osc-handlers.ts` 의 `attachProgramNotify` 지역 — 타일마다 한 번 건다) — 그것이 곧 "타일당" 이다.
 */
export function createRateGate(gapMs: number = PROGRAM_NOTIFY_GAP_MS): (now: number) => boolean {
  let last = -Infinity;
  return (now) => {
    if (now - last < gapMs) return false;
    last = now;
    return true;
  };
}
