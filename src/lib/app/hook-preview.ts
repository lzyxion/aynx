/** 훅 설치 미리 보기(Rust `agent_hooks.rs` 의 `preview` JSON)의 이벤트 이름 — 원문 순서 그대로, 꼴이 다르면 `null` */
export function hookEventNames(preview: string): string[] | null {
  let root: unknown;
  try {
    root = JSON.parse(preview);
  } catch {
    return null;
  }
  if (!isObject(root)) return null;
  const hooks = root.hooks;
  if (!isObject(hooks)) return null;
  return Object.keys(hooks);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
