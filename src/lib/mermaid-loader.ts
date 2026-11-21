/** mermaid 는 커서 메인 청크에 들지 않는다 — 처음 그릴 블록이 생길 때 받는다. 실패하면 약속을 버려 다음 블록이 다시 시도한다 */
export type Mermaid = typeof import("mermaid").default;

let pending: Promise<Mermaid> | null = null;

export function loadMermaid(): Promise<Mermaid> {
  pending ??= import("mermaid").then(
    (m) => m.default,
    (e: unknown) => {
      pending = null;
      throw e;
    },
  );
  return pending;
}
