/**
 * **편집기를 늦게 부른다** — CodeMirror(`doc-editor-cm.ts`)는 메인 청크에 들지 않고, 사람이 처음 [편집]을
 * 누를 때 한 번 받아 온다(`highlight-loader.ts` 와 같은 모양 · 문서 편집 E1).
 *
 * 받는 데 실패하면(청크 파일이 없는 등) 약속을 버려 다음 [편집]이 다시 시도한다 — 부르는 쪽은 편집 모드에
 * 들어가지 못했다고 띠로 말하고 읽기 보기로 남는다.
 */
export type EditorKit = typeof import("$lib/doc-editor-cm");

let pending: Promise<EditorKit> | null = null;

/** 편집기 모듈을 받는다 — 여러 곳이 동시에 불러도 받기는 한 번 */
export function loadEditor(): Promise<EditorKit> {
  pending ??= import("$lib/doc-editor-cm").catch((e: unknown) => {
    pending = null;
    throw e;
  });
  return pending;
}
