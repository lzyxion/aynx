/** CodeMirror 는 메인 청크에 들지 않는다 — 처음 [편집] 때 받는다. 실패하면 약속을 버려 다음 [편집]이 다시 시도한다. */
export type EditorKit = typeof import("$lib/doc-editor-cm");

let pending: Promise<EditorKit> | null = null;

export function loadEditor(): Promise<EditorKit> {
  pending ??= import("$lib/doc-editor-cm").catch((e: unknown) => {
    pending = null;
    throw e;
  });
  return pending;
}
