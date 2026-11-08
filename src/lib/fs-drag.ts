/**
 * **파일 타일이 끌고 다니는 짐** (docs/log/2026-09-04-fs-multiselect-clipboard.md).
 *
 * 세션 타일의 `HOSTS_DRAG_TYPE` 과 같은 모양이다: 종류 하나, 값은 JSON 한 덩어리, 파싱
 * 실패는 **조용히 빈 짐**. 다른 점은 짐에 **어디서 왔는지**(`backendKey`)가 함께 실린다는
 * 것뿐인데, 그것이 이 드래그의 뜻을 정하기 때문이다 — 같은 곳이면 이동, 로컬→원격이면
 * 업로드, 원격→로컬이면 다운로드, 서로 다른 원격이면 거절이다. 경로만 실으면 받는 쪽이
 * `C:\a` 를 원격 경로로 읽는 사고가 난다.
 *
 * 이 파일에는 DOM 도 Svelte 도 백엔드도 없다 — 순수 함수 넷뿐이라 `PaneHost`(터미널 위
 * 드롭)와 `SftpBrowser`(파일 타일 위 드롭)가 같은 값을 같은 규칙으로 읽는다.
 */

/** 드래그 데이터 종류 — 앱 안에서만 뜻이 있다 (밖에는 `text/plain` 을 예의로 함께 싣는다) */
export const FS_DRAG_TYPE = "application/x-aynx-files";

export interface FsDrag {
  /** 출발한 백엔드의 [`FsBackend.key`] — `"local"` · `"ssh:12"` */
  backendKey: string;
  /** 끌고 있는 항목들의 절대 경로 (보이는 순서) */
  paths: string[];
}

export function encodeFsDrag(drag: FsDrag): string {
  return JSON.stringify(drag);
}

/**
 * 짐을 읽는다. **모양이 어긋나면 빈 짐**이다 — 드래그 데이터는 다른 창이나 옛 버전에서
 * 올 수 있는데 여기서 던지면 드롭 핸들러 한가운데서 예외가 튀어 드래그가 반쯤 처리된
 * 채로 멈춘다. 빈 짐은 어느 대상에서도 아무 일도 하지 않는다.
 */
export function decodeFsDrag(raw: string): FsDrag {
  const empty: FsDrag = { backendKey: "", paths: [] };
  if (raw === "") return empty;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return empty;
    const record = value as Record<string, unknown>;
    const key = record.backendKey;
    const paths = record.paths;
    if (typeof key !== "string" || !Array.isArray(paths)) return empty;
    return { backendKey: key, paths: paths.filter((p): p is string => typeof p === "string") };
  } catch {
    return empty;
  }
}

export function fsDragEmpty(drag: FsDrag): boolean {
  return drag.backendKey === "" || drag.paths.length === 0;
}

/**
 * **이 창에서 시작한 드래그**의 짐 (없으면 `null`).
 *
 * 창마다 모듈이 따로이므로 남의 창에서 온 드래그에서는 언제나 비어 있다 —
 * `PaneHost` 의 `draggingPane()`/`draggingTab()` 이 같은 방식으로 창을 가르는 것과 같다.
 *
 * 파일 드래그에서 이 구분이 필요한 이유는 **원격 키가 창마다 다른 것을 가리키기 때문**이다:
 * 세션 번호는 창 안에서 도는 카운터라, 창 A 의 `ssh:2`(서울 서버)를 창 B 에서 그대로 펴면
 * 창 B 의 `ssh:2`(전혀 다른 서버)가 나온다. 그래서 받는 쪽은 원격에서 온 짐이 이 값 없이
 * 도착하면 거절한다. 로컬(`"local"`)은 창을 넘어도 같은 뜻이라 그대로 받는다.
 */
let activeDrag: FsDrag | null = null;

export function setFsDragActive(drag: FsDrag | null): void {
  activeDrag = drag;
}

export function fsDragActive(): FsDrag | null {
  return activeDrag;
}

/**
 * 경로 하나를 **셸에 그대로 붙여넣을 수 있는 글자**로 (터미널 타일 위 드롭이 쓴다).
 *
 * 따옴표 방식이 경로의 **모양**으로 갈리는 것은 그것이 각 문법에서 유일하게 통째로
 * 리터럴인 형태이기 때문이다:
 *
 * | 모양 | 감싸는 법 | 왜 |
 * | --- | --- | --- |
 * | 안전한 글자뿐 | 그대로 | 따옴표는 없을 때 가장 읽기 좋다 |
 * | 윈도우 경로(`\` 포함) | `"…"` | `"` 는 윈도우 파일명에 못 쓰는 글자라 이스케이프가 필요 없고, cmd·PowerShell·bash 셋 다 이 형태를 리터럴로 읽는다 (bash 의 큰따옴표 안에서 `\U` 같은 조합은 그대로 남는다) |
 * | 그 밖(POSIX) | `'…'` | 안의 `'` 는 셸 관례대로 `'\''` 로 끊어 이어 붙인다 |
 *
 * **놓는 터미널의 셸을 묻지 않는다.** 물어볼 수가 없다 — 로컬 셸이 cmd 인지 git-bash 인지
 * 앱은 모르고, 원격 셸은 서버의 것이다. 대신 경로 자신의 문법을 따르면 "그 경로가 원래
 * 살던 곳의 셸" 에서는 언제나 옳고, 다른 셸에 붙였을 때도 대개 그대로 읽힌다.
 */
export function shellQuote(path: string): string {
  if (path === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(path)) return path;
  if (path.includes("\\")) return `"${path}"`;
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

/** 경로들을 공백으로 이어 붙인 한 줄 (터미널에 붙여넣는 값) */
export function shellQuoteAll(paths: readonly string[]): string {
  return paths.map(shellQuote).join(" ");
}
