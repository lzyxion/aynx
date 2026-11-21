// 로컬 파일 타일 자동 새로고침의 순수 규칙. 디바운스는 Rust `local_watch.rs` 의 `Debounce` 가 한다 — 알림마다 웹뷰로 넘기면
// UI 스레드의 `eval` 이라 폭주(`npm install`)를 IPC 앞에서 모아야 한다. 원격 파일 타일은 자동으로 읽지 않는다.
import type { FileTreeRow } from "$lib/file-tree";

/** `cwd` 가 맨 앞이어야 한다 — Rust 상한이 앞에서 자른다. 합성 루트("내 PC")는 폴더가 아니라 뺀다 */
export function watchPathsOf(cwd: string, rows: readonly FileTreeRow[], syntheticRoot: boolean): string[] {
  const out: string[] = syntheticRoot ? [] : [cwd];
  const seen = new Set(out);
  for (const row of rows) {
    if (row.kind !== "entry" || !row.expanded) continue;
    const p = row.entry.path;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** 포커스가 잠깐 깜빡일 때마다(메뉴 · 대화상자) OS 감시를 걷고 다시 거는 소동을 막는 유예 */
export const WATCH_RELEASE_GRACE_MS = 1_000;

/**
 * 창이 활성일 때만 건다 — Windows 는 하위 폴더에 열린 디렉터리 핸들이 있으면 상위 폴더 이름 바꾸기를 막는다(EPERM).
 * 돌아오면 한 번 읽어 놓친 바뀜을 채운다.
 */
export function watchWanted(enabled: boolean, shown: boolean, windowActive: boolean): boolean {
  return enabled && shown && windowActive;
}

/** 같으면 `null`. 유예 안에 다시 켜지면 부르는 쪽이 시계를 걷는다 */
export function watchSwitchDelay(current: boolean, want: boolean): number | null {
  if (current === want) return null;
  return want ? 0 : WATCH_RELEASE_GRACE_MS;
}
