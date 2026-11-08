// 에이전트 **사용/끔** 판정 — 설정 `[ai] disabled_agents`(끈 에이전트 id 목록). 잎 모듈(형제를 부르지 않는다).
//
// 끈 에이전트는 **새로 띄우거나 고르는 자리에서만** 빠진다(상태바 `>_` 메뉴 · 프로젝트 시작 화면 · 프로젝트 폼 ·
// 블록 넘기기의 "새로 열기" · `ai-panel` 단축키 · 사용량 칩). 설치된 훅 · 추가 인자 · 대화 기록 · 외부 MCP 설정 ·
// 이미 열린 타일 · 훅 신호와 알림은 그대로다 — 다시 켜면 원래대로 돌아온다.

/** 프런트가 아는 에이전트 id — 설정 화면의 순서와 같다 */
export const KNOWN_AGENTS: readonly string[] = ["claude", "codex"];

/** 그 에이전트를 쓰는가 — 목록에 없으면 쓴다(기본 = 모두 사용) */
export function agentEnabled(id: string, disabled: readonly string[] | null | undefined): boolean {
  return !(disabled ?? []).includes(id);
}

/** 끈 에이전트를 뺀 목록 — 순서는 그대로 */
export function withoutDisabled<T>(
  list: readonly T[],
  idOf: (item: T) => string,
  disabled: readonly string[] | null | undefined,
): T[] {
  return list.filter((item) => agentEnabled(idOf(item), disabled));
}

/** 아는 에이전트가 모두 꺼졌는가 — `ai-panel` 처럼 에이전트를 고르지 않는 명령을 숨길 때 */
export function allAgentsDisabled(disabled: readonly string[] | null | undefined): boolean {
  return KNOWN_AGENTS.every((id) => !agentEnabled(id, disabled));
}

/**
 * 끈 목록을 고친다 — `on` 이면 빼고 아니면 더한다. 중복 없이 **아는 순서**로 정렬해 돌려준다(모르는 id 는 뒤에
 * 본 순서대로 남긴다 — 새 버전의 에이전트를 끈 파일을 옛 버전이 저장해도 값이 살아 있게).
 */
export function toggleDisabled(disabled: readonly string[] | null | undefined, id: string, on: boolean): string[] {
  const set = new Set(disabled ?? []);
  if (on) set.delete(id);
  else set.add(id);
  const rank = (x: string) => {
    const i = KNOWN_AGENTS.indexOf(x);
    return i < 0 ? KNOWN_AGENTS.length : i;
  };
  return [...set].map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map((e) => e.x);
}
