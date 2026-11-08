import type { HostsDrag } from "$lib/hosts";

/**
 * **세션 타일의 앱 내부 클립보드** (docs/log/2026-09-04-hosts-multiselect.md).
 *
 * `Ctrl+C`/`Ctrl+X` 로 담고 `Ctrl+V` 로 지금 폴더에 놓는다. OS 클립보드가 **아니다** —
 * 담기는 것이 글자가 아니라 "이 설정 파일 안의 어느 호스트·폴더" 라는 참조이기 때문이다.
 * OS 클립보드에 넣으면 다른 앱에 붙였을 때 뜻 없는 문자열이 되고, 반대로 다른 앱에서 복사한
 * 글자가 여기 붙여넣기의 대상이 되어 버린다 (드래그가 `text/plain` 을 예의로만 싣는 것과 같은
 * 이유다).
 *
 * **모듈 상태라 앱 안의 모든 세션 타일이 한 벌을 함께 본다.** 타일을 둘 열어 왼쪽에서 잘라
 * 오른쪽 폴더에 붙이는 것이 이 기능이 가장 쓸모 있는 순간이라, 타일마다 따로 두면 그 조작이
 * 아예 성립하지 않는다. 창을 넘지는 않는다(창마다 웹뷰가 따로다) — 창 사이는 드래그가 맡는다.
 *
 * 값은 **살아 있는지 확인하지 않는다**: 담아 둔 호스트가 그 사이 지워졌을 수 있고, 그때
 * 붙여넣기는 그 항목에서만 실패한다(안내 한 줄). 붙여넣기 순간에 파일이 진실이므로 여기서
 * 미리 지키려 들면 두 곳이 서로 다른 시점을 보게 된다.
 */

/** 담은 방식 — 복사(원본을 남긴다) / 잘라내기(붙이면 원본이 그 폴더로 옮겨진다) */
export type ClipMode = "copy" | "cut";

export interface HostsClip {
  mode: ClipMode;
  /** 담긴 별칭·폴더 경로 (드래그와 **같은 모양**이라 붙여넣기가 드롭과 같은 길로 간다) */
  payload: HostsDrag;
}

/**
 * 룬 상태는 **객체 한 칸에 담아** 둔다 — `export let` 한 값을 모듈 밖에서 다시 대입할 수
 * 없기 때문이다 (Svelte 5 규칙). 밖에서는 아래 함수 셋으로만 만진다.
 */
const store = $state<{ clip: HostsClip | null }>({ clip: null });

/** 지금 담겨 있는 것 (없으면 `null`) */
export function hostsClip(): HostsClip | null {
  return store.clip;
}

/** 복사·잘라내기 — 빈 짐이면 담지 않는다 (빈 클립보드로 덮어 쓰지 않게) */
export function setHostsClip(mode: ClipMode, payload: HostsDrag): void {
  if (payload.hosts.length === 0 && payload.groups.length === 0) return;
  store.clip = { mode, payload: { hosts: [...payload.hosts], groups: [...payload.groups] } };
}

/** 비운다 — 잘라내기를 붙여넣고 나면(원본이 이미 옮겨졌다) 한 번 쓰고 버린다 */
export function clearHostsClip(): void {
  store.clip = null;
}

/**
 * 이 id 들이 **잘려 있는가** — 화면에서 반투명하게 그릴지 정하는 데 쓴다.
 * 복사는 원본이 그대로이므로 표시하지 않는다 (잘라내기만 "곧 여기서 사라진다" 는 예고다).
 */
export function isCutHost(name: string): boolean {
  return store.clip?.mode === "cut" && store.clip.payload.hosts.includes(name);
}

/** 위와 같되 폴더 경로 쪽 */
export function isCutGroup(path: string): boolean {
  return store.clip?.mode === "cut" && store.clip.payload.groups.includes(path);
}
