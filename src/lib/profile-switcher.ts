/**
 * **테마 프로필 빠른 전환 — 순수 규칙** (docs/log/2026-09-28-profile-switcher.md).
 *
 * 위에서 내려오는 카드 줄(`ProfileSwitcher.svelte`)이 "어느 카드가 골라져 있나" 와 "이 키는 무엇인가" 를 여기서
 * 묻는다. 룬도 DOM 도 없어 vitest 로 그대로 돈다(`profile-switcher.test.ts`). 적용 자체는 여기 없다 —
 * `applyProfile`(설정 카드 · 팔레트와 같은 함수)이 한다.
 *
 * 키 판정은 이 앱의 규칙대로 **`ev.code`** 다(숫자 `Digit1` · `Numpad1`) — `ev.key` 는 한국어 IME 가 켜지면
 * `"Process"` 로 뭉개진다(keybindings.ts 머리말). 화살표 · Tab · Enter · Escape · Home/End 는 IME 와 무관하게
 * `code` 도 같은 이름이라 그대로 읽는다.
 */

/** 고르는 줄의 키 → 할 일 */
export type SwitcherKey =
  | { kind: "prev" }
  | { kind: "next" }
  | { kind: "home" }
  | { kind: "end" }
  /** 1…9 번째 카드로 (고르기만 한다 — 적용은 Enter) */
  | { kind: "nth"; index: number }
  | { kind: "apply" }
  | { kind: "close" };

/** 키 이벤트에서 이 판정이 읽는 것만 */
export interface SwitcherKeyEvent {
  code: string;
  key?: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
}

/**
 * 키 → 할 일. 모르는 키면 `null`(부르는 쪽이 그대로 흘려보낸다 — 떠 있는 동안에는 삼킨다).
 *
 * - ← · Shift+Tab = 앞 카드, → · Tab = 다음 카드 (끝에서 돌아 나온다 — [`moveSelection`])
 * - Home / End, 숫자 1…9(윗줄 · 숫자 패드)
 * - Enter(숫자 패드 포함) = 적용, Escape = 닫기
 *
 * `Ctrl`·`Alt`·`Meta` 가 섞인 키는 여기서 뜻이 없다(`null`) — 같은 단축키로 닫는 판정은 부르는 쪽이 먼저 한다.
 */
export function switcherKeyOf(ev: SwitcherKeyEvent): SwitcherKey | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return null;
  const code = ev.code || ev.key || "";
  switch (code) {
    case "ArrowLeft":
      return { kind: "prev" };
    case "ArrowRight":
      return { kind: "next" };
    case "Tab":
      return { kind: ev.shiftKey ? "prev" : "next" };
    case "Home":
      return { kind: "home" };
    case "End":
      return { kind: "end" };
    case "Enter":
    case "NumpadEnter":
      return { kind: "apply" };
    case "Escape":
      return { kind: "close" };
  }
  if (ev.shiftKey) return null; // Shift+숫자는 기호다
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m ? { kind: "nth", index: Number(m[1]) - 1 } : null;
}

/**
 * 열릴 때 골라 둘 카드 — **지금 쓰는 프로필**, 없으면(고른 것 없음 · 목록에서 사라짐) 첫 카드. 목록이 비면 `-1`.
 */
export function initialSelection(ids: readonly string[], activeId: string | null): number {
  if (ids.length === 0) return -1;
  const at = activeId === null ? -1 : ids.indexOf(activeId);
  return at >= 0 ? at : 0;
}

/**
 * 고른 카드를 옮긴다. ←/→ · Tab 은 **돌아 나온다**(마지막에서 → 는 첫 카드) — 카드가 몇 장뿐인 줄이라 끝에서
 * 막히면 반대쪽으로 가는 데 키를 여러 번 눌러야 한다. 숫자가 카드 수를 넘으면 그대로 둔다.
 * 목록이 비면 언제나 `-1`, 지금 값이 범위 밖이면 먼저 안으로 들인다.
 */
export function moveSelection(len: number, index: number, key: SwitcherKey): number {
  if (len <= 0) return -1;
  const cur = Math.min(Math.max(0, index), len - 1);
  switch (key.kind) {
    case "prev":
      return (cur - 1 + len) % len;
    case "next":
      return (cur + 1) % len;
    case "home":
      return 0;
    case "end":
      return len - 1;
    case "nth":
      return key.index >= 0 && key.index < len ? key.index : cur;
    default:
      return cur;
  }
}
