/**
 * **태그 칩 입력의 순수 규칙** — 글자를 태그로 쪼개고, 더하고, 뺀다
 * (docs/log/2026-09-20-host-form-tabs.md 의 "태그 = 칩 입력").
 *
 * 예전에는 태그가 **쉼표로 구분된 한 줄**이었다 (`prod, web`). 저장되는 값은 그때도
 * `string[]` 이었고(`sessions.toml` 의 `tags`), 그 줄을 쪼개는 일은 [저장]을 누르는 순간
 * `submitForm` 안에서 한 번 일어났다 — 즉 **화면은 문자열, 파일은 배열**이라 사람이 친
 * 글자가 실제로 무엇이 될지는 저장해 봐야 알았다. 칩으로 바뀌면서 그 변환이 **치는 자리로**
 * 올라왔고, 규칙이 눈에 보이는 물건(칩)이 되었다.
 *
 * 여기 있는 것은 순수 함수뿐이다 — 상태·DOM·포커스는 `TagInput.svelte` 가 쥔다
 * (이 저장소의 vitest 는 `environment: "node"` 라 `.svelte` 를 못 읽는다).
 */

/**
 * 친 글자(또는 붙여 넣은 덩어리)를 태그들로 — **쉼표와 줄바꿈**으로 쪼개고 다듬는다.
 *
 * 줄바꿈까지 보는 것은 붙여넣기 때문이다: 어디선가 복사한 목록은 줄로 갈려 오는 일이
 * 흔하고, 그때 태그 하나에 개행이 박히면 파일에도 그대로 적힌다.
 */
export function splitTagText(text: string): string[] {
  return text
    .split(/[,\n\r]/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/**
 * 친 글자를 목록에 **더한다** — 이미 있는 것은 건너뛴다.
 *
 * 견주는 방법은 **글자 그대로**(대소문자를 가린다). 태그는 사람이 붙이는 이름표라
 * `Web` 과 `web` 이 다른 뜻일 수 있고, 예전 쉼표 한 줄도 둘을 다른 태그로 저장했다 —
 * 칩이 되면서 조용히 합쳐 버리면 남의 파일에서 태그가 사라진다.
 *
 * 바뀐 것이 없으면 **같은 배열을 그대로** 돌려준다 (헛되이 새 참조를 만들지 않는다).
 */
export function addTags(list: readonly string[], text: string): string[] {
  const add = splitTagText(text).filter((t, i, all) => all.indexOf(t) === i && !list.includes(t));
  return add.length === 0 ? (list as string[]) : [...list, ...add];
}

/** 칩 하나를 뺀다 — 범위 밖이면 같은 배열 그대로 */
export function removeTagAt(list: readonly string[], index: number): string[] {
  if (index < 0 || index >= list.length) return list as string[];
  return [...list.slice(0, index), ...list.slice(index + 1)];
}
