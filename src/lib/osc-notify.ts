/**
 * 프로그램이 보낸 데스크톱 알림(OSC 9 · OSC 777) 순수 파서 (docs/log/2026-09-26-osc-notify-inline-images.md).
 * 본문은 원격 프로그램이 정하므로 믿지 않는다 — 알림 제목 칸은 늘 앱이 쥐고, 프로그램이 준 제목은 본문 앞머리로 내린다.
 */

export const NOTIFY_TITLE_MAX = 80;
export const NOTIFY_BODY_MAX = 240;

/** `title` 은 777 에서만 온다(OSC 9 는 늘 빈 문자열) */
export interface ProgramNotice {
  title: string;
  body: string;
}

/** 지우지 않고 공백으로 바꾼다 — 지우면 `a\nb` 가 `ab` 로 붙어 다른 낱말이 된다 */
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

/** ConEmu·Windows Terminal 의 하위 명령(`9;4` 진행률 · `9;9` 현재 폴더) — 숫자 하나뿐인 본문도 알림으로 치지 않는다 */
const OSC9_SUBCOMMAND = /^\d+(;|$)/;

/** `null` 은 "우리 것이 아니다" — 핸들러는 `false` 를 돌려 다른 소비자(9;9 현재 폴더)에게 넘긴다 */
export function parseOsc9Notify(data: string): ProgramNotice | null {
  if (OSC9_SUBCOMMAND.test(data)) return null;
  const body = sanitizeNotifyText(data, NOTIFY_BODY_MAX);
  if (body === "") return null;
  return { title: "", body };
}

/** 첫 두 칸만 가른다 — 본문 안의 `;` 는 그대로 본문이다 */
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

/** 프로그램의 제목을 알림 제목 칸에 올리지 않는다 — 앱 자신의 알림처럼 보이는 한 장을 만들 수 없게 */
export function programNotifyText(n: ProgramNotice): string {
  if (n.title && n.body) return `${n.title} — ${n.body}`;
  return n.title || n.body;
}

export const PROGRAM_NOTIFY_GAP_MS = 2000;

/** 막히면 버린다 — 쌓았다 나중에 띄우면 폭주하는 루프의 알림 천 장이 2초에 한 장씩 나온다 */
export function createRateGate(gapMs: number = PROGRAM_NOTIFY_GAP_MS): (now: number) => boolean {
  let last = -Infinity;
  return (now) => {
    if (now - last < gapMs) return false;
    last = now;
    return true;
  };
}
