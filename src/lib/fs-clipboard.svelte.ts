/**
 * **파일 타일의 앱 내부 클립보드** (docs/log/2026-09-04-fs-multiselect-clipboard.md).
 *
 * `Ctrl+C`/`Ctrl+X` 로 담고 `Ctrl+V` 로 지금 폴더에 놓는다. 세션 타일의
 * `hosts-clipboard.svelte.ts` 와 같은 모양이고 같은 이유로 **OS 클립보드가 아니다**:
 * 담기는 것이 글자가 아니라 "저 백엔드의 이 경로들" 이라는 참조라서, OS 클립보드에 넣으면
 * 다른 앱에 붙였을 때 뜻 없는 문자열이 되고 반대로 다른 앱에서 복사한 글자가 여기
 * 붙여넣기의 대상이 되어 버린다.
 *
 * **모듈 상태라 앱 안의 모든 파일 타일이 한 벌을 함께 본다.** 타일을 둘 열어 왼쪽에서
 * 잘라 오른쪽에 붙이는 것이 이 기능이 가장 쓸모 있는 순간이라, 타일마다 따로 두면 그
 * 조작이 아예 성립하지 않는다. 창은 넘지 않는다(창마다 웹뷰가 따로다) — 창 사이는
 * 드래그가 맡는다.
 *
 * [`backendKey`] 를 함께 담는 이유는 드래그와 같다: 붙여넣기의 뜻(이동·업로드·다운로드·
 * 거절)이 **출발지와 목적지의 짝**으로 정해지기 때문이다. 경로만 담으면 `C:\a` 를 원격
 * 경로로 읽는 사고가 난다.
 *
 * 담아 둔 것이 **살아 있는지는 확인하지 않는다** — 그 사이 지워졌거나 세션이 끊겼을 수
 * 있고, 그때 붙여넣기는 그 자리에서 실패한다(인라인 오류 한 줄). 붙여넣는 순간의 디스크가
 * 진실이므로 여기서 미리 지키려 들면 두 곳이 서로 다른 시점을 보게 된다.
 */

/** 담은 방식 — 복사(원본을 남긴다) / 잘라내기(붙이면 원본이 그 폴더로 옮겨진다) */
export type FsClipMode = "copy" | "cut";

export interface FsClip {
  mode: FsClipMode;
  /** 출발한 백엔드의 [`FsBackend.key`] */
  backendKey: string;
  /** 담긴 절대 경로들 */
  paths: string[];
}

/**
 * 룬 상태는 **객체 한 칸에 담아** 둔다 — `export let` 한 값을 모듈 밖에서 다시 대입할 수
 * 없기 때문이다 (Svelte 5 규칙). 밖에서는 아래 함수들로만 만진다.
 */
const store = $state<{ clip: FsClip | null }>({ clip: null });

/** 지금 담겨 있는 것 (없으면 `null`) */
export function fsClip(): FsClip | null {
  return store.clip;
}

/** 복사·잘라내기 — 빈 짐이면 담지 않는다 (빈 클립보드로 덮어 쓰지 않게) */
export function setFsClip(mode: FsClipMode, backendKey: string, paths: readonly string[]): void {
  if (backendKey === "" || paths.length === 0) return;
  store.clip = { mode, backendKey, paths: [...paths] };
}

/** 비운다 — 잘라내기를 붙여넣고 나면(원본이 이미 옮겨졌다) 한 번 쓰고 버린다 */
export function clearFsClip(): void {
  store.clip = null;
}

/**
 * 이 경로가 **잘려 있는가** — 화면에서 반투명하게 그릴지 정하는 데 쓴다.
 *
 * 복사는 원본이 그대로이므로 표시하지 않는다 (잘라내기만 "곧 여기서 사라진다" 는 예고다).
 * 백엔드 키까지 맞아야 하는 이유: 두 서버의 `/tmp/a` 는 **다른 파일**이라, 왼쪽 타일에서
 * 자른 것이 오른쪽 타일의 같은 이름 위에 회색으로 나타나면 거짓말이 된다.
 */
export function isCutPath(backendKey: string, path: string): boolean {
  const clip = store.clip;
  return clip !== null && clip.mode === "cut" && clip.backendKey === backendKey && clip.paths.includes(path);
}
