/**
 * 훅 스크립트 판 비교 — 순수. 로컬 사본은 앱이 뜰 때 Rust 가 갈아 쓰지만 원격 사본은 아무도 갈아 쓰지 않는다 —
 * 옛 판 신호가 오면 "다시 설치" 를 한 번 권한다(`src-tauri/src/agent_signal.rs` 의 `hookVersion` · `hookLatest`).
 */

function versionOf(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/** `latest` 가 없으면 판정하지 않는다. `sent` 가 없으면 4판 이하(판을 싣기 전의 스크립트) */
export function hookOutdated(sent: unknown, latest: unknown): boolean {
  const want = versionOf(latest);
  if (want === null) return false;
  const have = versionOf(sent);
  return have === null || have < want;
}

/** 판을 싣기 시작한 것이 5판이라 싣지 않은 스크립트는 4판 이하다 */
export function sentVersionOf(sent: unknown): { n: number; orOlder: boolean } {
  const have = versionOf(sent);
  return have === null ? { n: 4, orOlder: true } : { n: have, orOlder: false };
}

/** 스크립트는 호스트마다 한 벌(에이전트 공용)이라 에이전트로 가르지 않는다 */
export function hookNoticeKey(where: { remote: string | null }): string {
  return where.remote === null ? "local" : `remote:${where.remote.trim().toLowerCase()}`;
}

/** 한 앱 세션에 한 번 — 설치가 실패했어도 다시 권하지 않는다(메뉴에서 다시 할 수 있다) */
export function createOnceGate(): (key: string) => boolean {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
