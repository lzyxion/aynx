import type { HostsDrag } from "$lib/hosts";

/**
 * 세션 타일의 앱 내부 클립보드 — OS 클립보드가 아니다: 담기는 것은 글자가 아니라 이 설정 파일 안의 호스트 · 폴더 참조다.
 * 모듈 상태라 창 안의 모든 타일이 한 벌을 본다(창은 넘지 않는다). 담은 값이 살아 있는지는 붙여넣기 순간에 파일이 판정한다.
 */

export type ClipMode = "copy" | "cut";

export interface HostsClip {
  mode: ClipMode;
  /** 드래그와 같은 모양이라 붙여넣기가 드롭과 같은 길로 간다 */
  payload: HostsDrag;
}

const store = $state<{ clip: HostsClip | null }>({ clip: null });

export function hostsClip(): HostsClip | null {
  return store.clip;
}

export function setHostsClip(mode: ClipMode, payload: HostsDrag): void {
  if (payload.hosts.length === 0 && payload.groups.length === 0) return;
  store.clip = { mode, payload: { hosts: [...payload.hosts], groups: [...payload.groups] } };
}

export function clearHostsClip(): void {
  store.clip = null;
}

export function isCutHost(name: string): boolean {
  return store.clip?.mode === "cut" && store.clip.payload.hosts.includes(name);
}

export function isCutGroup(path: string): boolean {
  return store.clip?.mode === "cut" && store.clip.payload.groups.includes(path);
}
