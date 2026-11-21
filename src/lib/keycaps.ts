// 메뉴 줄의 단축키는 여기를 거치지 않는다 — 흐린 글자 한 줄(`theme.css` 의 `.menu-kbd`)이다.

/**
 * 조합 하나를 키 칩들로. `+` 자신이 키인 자리(`Ctrl++` · `+`)는 칩 하나로 남긴다.
 * 끝 키의 묶음(`H/J/K` · `←→↑↓`)은 쪼개지 않는다 — `mergeComboGroups` 가 일부러 접은 것이라 펴면 키 셋을 함께 누르는 것처럼 읽힌다.
 */
export function splitCombo(text: string): string[] {
  const s = text.trim();
  const keys: string[] = [];
  let token = "";
  let afterSep = true;
  for (const ch of s) {
    if (ch !== "+") {
      token += ch;
      afterSep = false;
      continue;
    }
    if (token !== "") {
      keys.push(token);
      token = "";
      afterSep = true;
    } else if (afterSep) {
      keys.push("+");
      afterSep = false;
    }
    else afterSep = true;
  }
  if (token !== "") keys.push(token);
  return keys;
}

/** 공백으로 이은 시퀀스(`Ctrl+B d`)를 조합 묶음들로. `displayCombo` 는 숫자 패드를 `Num 1` 처럼 공백 낀 한 키로 적는다 */
export function splitKeySequence(text: string): string[][] {
  const words = text.trim().split(/\s+/).filter((w) => w !== "");
  const groups: string[][] = [];
  for (let i = 0; i < words.length; i++) {
    let word = words[i];
    while (/(^|\+)Num$/.test(word) && i + 1 < words.length) word += ` ${words[++i]}`;
    const keys = splitCombo(word);
    if (keys.length > 0) groups.push(keys);
  }
  return groups;
}

export type MouseButton = "left" | "right" | "double";

/** 사전(`cheatsheet.g.*` · 툴팁 괄호)에 실제로 나오는 낱말만이다 */
const MOUSE_WORDS: Readonly<Record<string, MouseButton>> = {
  클릭: "left",
  좌클릭: "left",
  우클릭: "right",
  더블클릭: "double",
  click: "left",
  "left-click": "left",
  leftclick: "left",
  "right-click": "right",
  rightclick: "right",
  "double-click": "double",
  doubleclick: "double",
};

export function mouseButton(key: string): MouseButton | null {
  return MOUSE_WORDS[key.trim().toLowerCase()] ?? null;
}

export type GesturePart = { kind: "text"; value: string } | { kind: "keys"; value: string };

/** 치트시트의 몸짓 글자를 자리 낱말과 클릭 조합으로 가른다 — 클릭 조합이 없으면 `null`(부르는 쪽은 옅은 몸짓 칩으로 그린다) */
export function splitMouseGesture(text: string): GesturePart[] | null {
  const words = text.trim().split(/\s+/).filter((w) => w !== "");
  const parts: GesturePart[] = [];
  let found = false;
  for (const word of words) {
    const keys = splitCombo(word);
    if (keys.length > 0 && mouseButton(keys[keys.length - 1]) !== null) {
      parts.push({ kind: "keys", value: word });
      found = true;
      continue;
    }
    const last = parts[parts.length - 1];
    if (last && last.kind === "text") last.value += ` ${word}`;
    else parts.push({ kind: "text", value: word });
  }
  return found ? parts : null;
}
