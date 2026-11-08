/**
 * **훅 설치 미리 보기에서 이벤트 이름 뽑기** — 확인 상자(`dialogs/HookInstallBody.svelte`)의 칩 줄.
 *
 * 미리 보기는 Rust(`agent_hooks.rs` 의 `preview`)가 만든 `{"hooks": {이벤트: [묶음]}}` 꼴 JSON 이다. 이름은 그 `hooks`
 * 객체의 키 순서 그대로(정렬하지 않는다 — 화면이 원문 JSON 과 같은 순서로 읽히게). 파싱이 안 되거나 꼴이 다르면
 * `null` — 부르는 쪽은 칩 줄을 빼고 개수 없는 문구를 쓴다. **순수**
 */
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
