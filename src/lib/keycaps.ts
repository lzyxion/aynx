// ---------------------------------------------------------------------------
// 단축키 글자를 **키 낱개**로 쪼개는 순수 규칙 — `Keys.svelte` 가 그린다(2026-10-25 · 모양은 10-28 부터 조합 하나 = 알약 하나).
//
// `Ctrl+Shift+H` → `( Ctrl Shift H )` — `+` 는 키 사이 간격이 대신하고 글자로는 보이지 않는다.
// 받는 글자는 `displayCombo()` 의 결과 · 툴팁 괄호의 조합 · 손으로 적은 키 이름(`↑↓` · `Esc`) 어느 것이든 같다.
// 클릭 낱말(`우클릭` · `click` …)은 `mouseButton` 이 알아보고 칩이 마우스 아이콘으로 그린다.
//
// 메뉴 줄의 단축키는 여기를 거치지 않는다 — 흐린 글자 한 줄(`theme.css` 의 `.menu-kbd`)이다. Windows 는 키 이름이
// 낱말이라 메뉴 줄마다 칩 셋이 늘어서면 무겁다(VS Code 와 같은 갈래 — 메뉴는 글자, 나머지는 칩).
// ---------------------------------------------------------------------------

/**
 * 조합 **하나**를 키 칩들로. `+` 로 쪼개되 `+` 자신이 키인 자리(`Ctrl++` · `+`)는 칩 하나로 남긴다.
 *
 * 쪼개지 않는 것: 끝 키의 묶음(`H/J/K` · `←→↑↓` · `1…9`)과 낱말(`클릭` · `Enter`)은 칩 하나다 —
 * 묶음은 `mergeComboGroups` 가 일부러 접은 것이라 칩으로 다시 펴면 키 셋을 함께 누르는 것처럼 읽힌다.
 * 구두점 키(`Ctrl+,` · `Ctrl+/`)도 그대로 칩 하나다. 빈 글자면 빈 배열.
 */
export function splitCombo(text: string): string[] {
  const s = text.trim();
  const keys: string[] = [];
  let token = "";
  /** 바로 앞이 구분자 `+` 였는가 — 그 뒤의 `+` 는 구분자가 아니라 키다 */
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
      // `Ctrl++` 의 둘째 `+` · 맨 앞의 `+` — 키 이름 자리에 선 `+`
      keys.push("+");
      afterSep = false;
    }
    // 키 `+` 바로 뒤의 `+` 는 다시 구분자다 — 칩을 더 만들지 않는다
    else afterSep = true;
  }
  if (token !== "") keys.push(token);
  return keys;
}

/**
 * 공백으로 이어진 **시퀀스**(`Ctrl+B d` — 차례로 누른다)를 조합 묶음들로. 묶음 사이는 칩 사이보다 넓게 그린다.
 *
 * `displayCombo` 는 숫자 패드를 `Num 1` 처럼 공백 낀 한 키로 적는다 — 끝 키가 `Num` 인 낱말은 다음 낱말과 붙여 한 키로 읽는다.
 */
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

/** 마우스 단추 — 칩이 글자 대신 그릴 아이콘을 고른다(`Keys.svelte`) */
export type MouseButton = "left" | "right" | "double";

/**
 * 마우스 몸짓 낱말 → 단추. 사전(`cheatsheet.g.*` · 툴팁 괄호)에 실제로 나오는 낱말만이다 — ko `클릭` · `우클릭` ·
 * `더블클릭`, en `click` · `right-click` · `double-click`(대소문자 무시 · 붙여 쓴 꼴도). `드래그` · `휠` 은 누르는 단추가
 * 아니라 글자로 남는다.
 */
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

/** 칩 하나(`splitCombo` 의 토큰)가 마우스 클릭인가 — 맞으면 그 단추, 아니면 `null` */
export function mouseButton(key: string): MouseButton | null {
  return MOUSE_WORDS[key.trim().toLowerCase()] ?? null;
}

/** 몸짓 글자의 한 조각 — 자리 낱말(`헤더`)은 글자, 클릭 조합(`우클릭` · `Ctrl+클릭`)은 칩 */
export type GesturePart = { kind: "text"; value: string } | { kind: "keys"; value: string };

/**
 * 치트시트의 마우스 몸짓 글자(`헤더 우클릭` · `Right-click tab` · `Ctrl+클릭`)를 자리 낱말과 클릭 조합으로 가른다.
 *
 * 공백으로 나눈 낱말 가운데 **끝 키가 클릭 낱말인 조합**만 칩 조각이 되고, 나머지 낱말은 이어 붙여 글자 조각으로 남는다 —
 * 어순은 사전 그대로라 영어(`Right-click header`)도 따로 다룰 것이 없다. 클릭 조합이 하나도 없으면(`헤더 → 탭 바` ·
 * `빈 곳 드래그`) `null` — 부르는 쪽은 예전처럼 옅은 몸짓 칩으로 그린다.
 */
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
