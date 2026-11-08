/**
 * **AI CLI 고르기 상자의 줄 짓기** — `Ctrl+Shift+A`(키바인딩 `ai-panel`) · 팔레트의 같은 줄이 여는 상자(`AiLaunchPicker.svelte`)의
 * 순수 층이다. DOM 도 룬도 모른다.
 *
 * - 후보는 부르는 쪽이 `offeredAiClis` 로 걸러 준 그대로다(순서 · 설치된 것만 · 감지가 비면 claude 한 줄 · 끈 에이전트 뺌).
 * - 줄마다 숫자 키 1~9(열째부터는 키 없음) · 설치 여부(감지 목록에 `installed` 로 있어야 참 — 폴백 claude 는 거짓).
 * - 처음 골라진 줄은 마지막으로 연 CLI(`last`), 후보에 없으면 첫 줄.
 * - 후보가 하나면 상자 없이 곧바로 연다(`direct`), 없으면 `none`.
 */

export interface AiLaunchCli {
  command: string;
  id: string;
  name: string;
}

export interface AiLaunchRow {
  cli: AiLaunchCli;
  /** 이 기기에 설치돼 있는가 — 아니면 흐리게 + "설치 안 됨" (골라도 열고 설치 안내) */
  installed: boolean;
  /** 곧바로 여는 숫자 키(`"1"`…`"9"`) — 열째부터는 `null` */
  digit: string | null;
}

export type AiLaunchPlan =
  | { mode: "none" }
  | { mode: "direct"; cli: AiLaunchCli }
  | { mode: "pick"; rows: AiLaunchRow[]; selected: number };

export function planAiLaunch(
  offered: readonly AiLaunchCli[],
  detected: readonly { id: string; installed: boolean }[],
  last: string | null,
): AiLaunchPlan {
  if (offered.length === 0) return { mode: "none" };
  if (offered.length === 1) return { mode: "direct", cli: offered[0] };
  const rows = offered.map((cli, i) => ({
    cli,
    installed: detected.some((d) => d.id === cli.id && d.installed),
    digit: i < 9 ? String(i + 1) : null,
  }));
  const at = last === null ? -1 : rows.findIndex((r) => r.cli.id === last);
  return { mode: "pick", rows, selected: at === -1 ? 0 : at };
}

/**
 * 숫자 키가 가리키는 줄 — `ev.code`(물리 키 · IME 안전)로 본다: `Digit1`…`Digit9` · `Numpad1`…`Numpad9`.
 * 줄이 없거나 숫자 키가 아니면 `null`.
 */
export function digitRowIndex(code: string, rowCount: number): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (!m) return null;
  const i = Number(m[1]) - 1;
  return i < rowCount && i < 9 ? i : null;
}

/**
 * 돌림판 자리 — 줄 `i` 가 골라진 줄 `sel` 에서 몇 칸 떨어졌나(왼쪽 음수 · 오른쪽 양수). 끝과 처음은 이어져 있어 가까운 쪽으로 센다
 * (`AiLaunchPicker` 가 이만큼 옆으로 민다). 반 바퀴 딱 맞는 줄(짝수 개의 맞은편)은 왼쪽에 둔다.
 */
export function carouselOffset(i: number, sel: number, n: number): number {
  if (n <= 0) return 0;
  let d = (((i - sel) % n) + n) % n;
  if (d >= n / 2) d -= n;
  return d;
}
