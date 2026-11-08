/**
 * **훅 스크립트 판 비교** — 순수 층 (docs/log/2026-09-27-remote-hook-version.md).
 *
 * 훅 스크립트 5판부터 모든 신호가 자기 판(`v`)을 싣고, Rust 가 그것을 `agent-signal` 의 `hookVersion`
 * 으로, 이 앱이 설치하는 판을 `hookLatest` 로 함께 내보낸다(`src-tauri/src/agent_signal.rs`). 로컬
 * 사본은 앱이 뜰 때 Rust 가 갈아 쓰지만 **원격 사본은 아무도 갈아 쓰지 않아** 판을 올려도 서버에는 옛
 * 글자가 조용히 남는다 — 그 신호가 오는 순간 "다시 설치" 를 한 번 권하는 것이 이 판정의 쓰임이다.
 */

/** 판 번호로 받는 값인가 — 양의 정수만 */
function versionOf(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * 이 신호를 보낸 스크립트가 **옛 판**인가.
 *
 * - `latest` 가 없으면(판을 싣지 않는 옛 Rust · 하네스의 손 신호) 판정하지 않는다 — `false`.
 * - `sent` 가 없으면 4판 이하(판을 싣기 전의 스크립트) — 옛 판이다.
 * - 그 밖은 `sent < latest`. 더 새 판(다른 인스턴스가 더 새 앱)은 옛 판이 아니다.
 */
export function hookOutdated(sent: unknown, latest: unknown): boolean {
  const want = versionOf(latest);
  if (want === null) return false;
  const have = versionOf(sent);
  return have === null || have < want;
}

/**
 * 알림 문구의 "보낸 판" 글자 — 판이 있으면 `v4`, 없으면 `v4 이하` 꼴로 쓰도록 `{ n, orOlder }`.
 * 판을 싣기 시작한 것이 5판이라 싣지 않은 스크립트는 **4판 이하**다.
 */
export function sentVersionOf(sent: unknown): { n: number; orOlder: boolean } {
  const have = versionOf(sent);
  return have === null ? { n: 4, orOlder: true } : { n: have, orOlder: false };
}

/**
 * 알림을 한 번만 띄우는 열쇠 — 스크립트는 **호스트마다 한 벌**(에이전트 공용)이라 원격은 별칭으로,
 * 로컬은 하나로 센다. 다시 설치하면 그 호스트의 모든 에이전트가 새 판을 타므로 에이전트로 가르지 않는다.
 */
export function hookNoticeKey(where: { remote: string | null }): string {
  return where.remote === null ? "local" : `remote:${where.remote.trim().toLowerCase()}`;
}

/**
 * "한 앱 세션에 한 번" 문지기 — 처음 보는 열쇠면 `true` 를 돌려주고 적어 둔다. 닫든 다시 설치하든
 * 같은 열쇠로는 다시 권하지 않는다(설치가 실패했어도 — 사용자는 메뉴에서 다시 할 수 있다).
 */
export function createOnceGate(): (key: string) => boolean {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
