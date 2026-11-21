/**
 * 파일 타일의 앱 내부 클립보드 — OS 클립보드가 아니다: 담기는 것이 글자가 아니라 "저 백엔드의 이 경로들" 이라는 참조다.
 * 모듈 상태라 앱 안의 모든 파일 타일이 한 벌을 함께 본다(창은 넘지 않는다 — 창 사이는 드래그).
 * 담아 둔 것이 살아 있는지는 확인하지 않는다 — 붙여넣는 순간의 디스크가 진실이다.
 */

export type FsClipMode = "copy" | "cut";

export interface FsClip {
  mode: FsClipMode;
  /** 출발한 백엔드의 [`FsBackend.key`] — 경로만 담으면 `C:\a` 를 원격 경로로 읽는 사고가 난다 */
  backendKey: string;
  paths: string[];
}

const store = $state<{ clip: FsClip | null }>({ clip: null });

export function fsClip(): FsClip | null {
  return store.clip;
}

/** 빈 짐이면 담지 않는다 */
export function setFsClip(mode: FsClipMode, backendKey: string, paths: readonly string[]): void {
  if (backendKey === "" || paths.length === 0) return;
  store.clip = { mode, backendKey, paths: [...paths] };
}

export function clearFsClip(): void {
  store.clip = null;
}

/** 백엔드 키까지 맞아야 한다 — 두 서버의 `/tmp/a` 는 다른 파일이다 */
export function isCutPath(backendKey: string, path: string): boolean {
  const clip = store.clip;
  return clip !== null && clip.mode === "cut" && clip.backendKey === backendKey && clip.paths.includes(path);
}
