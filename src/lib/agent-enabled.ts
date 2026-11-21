// 에이전트 사용/끔 — 설정 `[ai] disabled_agents`(끈 id 목록). 끈 에이전트는 새로 띄우거나 고르는 자리에서만 빠진다 —
// 설치된 훅 · 대화 기록 · 이미 열린 타일 등은 그대로라 다시 켜면 원래대로 돌아온다.

/** 설정 파일에 글자 그대로 남는 id */
export const KNOWN_AGENTS: readonly string[] = ["claude", "codex"];

export function agentEnabled(id: string, disabled: readonly string[] | null | undefined): boolean {
  return !(disabled ?? []).includes(id);
}

export function withoutDisabled<T>(
  list: readonly T[],
  idOf: (item: T) => string,
  disabled: readonly string[] | null | undefined,
): T[] {
  return list.filter((item) => agentEnabled(idOf(item), disabled));
}

export function allAgentsDisabled(disabled: readonly string[] | null | undefined): boolean {
  return KNOWN_AGENTS.every((id) => !agentEnabled(id, disabled));
}

/** 모르는 id 는 뒤에 남긴다 — 새 버전의 에이전트를 끈 파일을 옛 버전이 저장해도 값이 살아 있게. */
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
