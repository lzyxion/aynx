/** 줄바꿈도 쪼갠다 — 붙여 넣은 목록의 개행이 태그에 박히면 파일에도 그대로 적힌다 */
export function splitTagText(text: string): string[] {
  return text
    .split(/[,\n\r]/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/**
 * 견주기는 글자 그대로(대소문자를 가린다) — 조용히 합치면 `Web` · `web` 을 따로 둔 파일에서 태그가 사라진다.
 * 바뀐 것이 없으면 같은 배열을 돌려준다.
 */
export function addTags(list: readonly string[], text: string): string[] {
  const add = splitTagText(text).filter((t, i, all) => all.indexOf(t) === i && !list.includes(t));
  return add.length === 0 ? (list as string[]) : [...list, ...add];
}

export function removeTagAt(list: readonly string[], index: number): string[] {
  if (index < 0 || index >= list.length) return list as string[];
  return [...list.slice(0, index), ...list.slice(index + 1)];
}
