// 로컬 파일 타일 자동 새로고침의 **순수 규칙** (docs/log/2026-10-21-file-tile-auto-refresh.md) — 무엇을 감시하나 · 언제 감시하나.
// 부르는 곳: `SftpBrowser.svelte`(감시 경로 · 켬/끔 판정과 유예). 디바운스(바뀜이 멎고 300ms · 2초 상한 · 최소 2초 간격)는 여기가 아니라 Rust
// `local_watch.rs` 의 `Debounce` 다 — 알림마다 웹뷰로 넘기면 그것이 곧 UI 스레드의 `eval` 이라 폭주(`npm install`)를 IPC
// 앞에서 모아야 한다. 원격 파일 타일은 자동으로 읽지 않는다(⟳ — 같은 기록).
import type { FileTreeRow } from "$lib/file-tree";

/**
 * 이 타일이 감시할 폴더 — **지금 폴더(`cwd`)가 맨 앞**이고(Rust 상한이 앞에서 자른다) 그 뒤로 트리에서 **보이게 펼친**
 * 폴더(`rows` 의 펼친 줄 — 접힌 조상 아래 · 숨김이 꺼진 숨김 폴더는 줄이 없으니 저절로 빠진다). 합성 루트("내 PC")는 폴더가
 * 아니라 뺀다. 아이콘 · 간단히 보기에는 펼친 줄이 없으므로 `cwd` 하나다.
 */
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

/**
 * 비활성이 이만큼 이어져야 감시를 걷는다(ms). 메뉴 · 대화상자 · 자기 창의 네이티브 대화상자(파일 고르기)로 포커스가 잠깐 깜빡일
 * 때마다 OS 감시를 걷고 다시 거는 소동을 막는 유예다. 사람이 다른 창(탐색기)으로 가서 상위 폴더를 골라 이름을 바꾸기 시작하는
 * 데는 이보다 오래 걸린다(클릭 · 고르기 · F2 — 1초 안에는 어렵다) — 그 전에 핸들이 닫힌다.
 */
export const WATCH_RELEASE_GRACE_MS = 1_000;

/**
 * 로컬 감시를 **걸어 둘까** — 설정이 켜져 있고, 타일이 보이는 탭에 있고, 그 타일을 가진 창이 활성일 때만.
 * Windows 는 하위 폴더에 열린 디렉터리 핸들이 있으면 상위 폴더 이름 바꾸기를 막는다(실측 EPERM — 기록 "상위 폴더 이름 바꾸기 잠금").
 * 사람이 이 창을 보고 있지 않을 때 핸들을 쥐고 있을 이유가 없다 — 돌아오면 한 번 읽어 놓친 바뀜을 채운다.
 */
export function watchWanted(enabled: boolean, shown: boolean, windowActive: boolean): boolean {
  return enabled && shown && windowActive;
}

/**
 * 감시 켬/끔을 **언제** 바꿀까(ms) — 같으면 `null`(할 일 없음), 켜기는 곧바로(0 — 돌아온 순간 읽고 건다), 끄기는 유예 뒤
 * ([`WATCH_RELEASE_GRACE_MS`]). 유예 안에 다시 켜지면 부르는 쪽이 시계를 걷어 아무 일도 없던 것이 된다.
 */
export function watchSwitchDelay(current: boolean, want: boolean): number | null {
  if (current === want) return null;
  return want ? 0 : WATCH_RELEASE_GRACE_MS;
}
