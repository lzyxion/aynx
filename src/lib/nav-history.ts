/**
 * 타일마다 따로인 탐색 이력(뒤로 / 앞으로) — 순수. 브라우저 `history` 는 창 하나에 하나뿐이라 쓰지 않는다.
 * 바뀔 것이 없으면 같은 객체를 돌려준다 — `$state` 대입이 헛되이 갱신을 부르지 않게.
 */

export const MAX_ENTRIES = 50;

export interface NavHistory {
  /** 파일 타일은 절대 경로, 세션 타일은 그룹 경로다 */
  readonly entries: readonly string[];
  /** 빈 이력에서는 `-1` */
  readonly index: number;
}

export function emptyHistory(): NavHistory {
  return { entries: [], index: -1 };
}

export function current(h: NavHistory): string | null {
  return h.index >= 0 ? h.entries[h.index] : null;
}

export function canBack(h: NavHistory): boolean {
  return h.index > 0;
}

export function canForward(h: NavHistory): boolean {
  return h.index >= 0 && h.index < h.entries.length - 1;
}

/** 같은 자리를 연달아 밀면 무시한다 — 새로고침 · 재연결이 보던 폴더를 다시 읽는 것은 이동이 아니다 */
export function push(h: NavHistory, path: string): NavHistory {
  if (current(h) === path) return h;
  const kept = h.entries.slice(0, h.index + 1);
  kept.push(path);
  const over = kept.length - MAX_ENTRIES;
  const entries = over > 0 ? kept.slice(over) : kept;
  return { entries, index: entries.length - 1 };
}

/** 화면 쪽이 `path` 로 이동해 보고 성공했을 때만 `h` 를 채택한다 — 실패하면 [`dropAt`] 으로 떨어낸다 */
export interface NavStep {
  h: NavHistory;
  path: string;
}

export function back(h: NavHistory): NavStep | null {
  if (!canBack(h)) return null;
  const index = h.index - 1;
  return { h: { entries: h.entries, index }, path: h.entries[index] };
}

export function forward(h: NavHistory): NavStep | null {
  if (!canForward(h)) return null;
  const index = h.index + 1;
  return { h: { entries: h.entries, index }, path: h.entries[index] };
}

/** 사라진 자리(지운 폴더 · 뺀 USB)를 지운다 — 남기면 [뒤로] 를 누를 때마다 같은 오류가 뜬다 */
export function dropAt(h: NavHistory, at: number): NavHistory {
  if (at < 0 || at >= h.entries.length) return h;
  const entries = h.entries.filter((_, i) => i !== at);
  const index = h.index > at ? h.index - 1 : Math.min(h.index, entries.length - 1);
  return { entries, index };
}

/**
 * 엄지 버튼 `3`(뒤로) · `4`(앞으로). 웹뷰 기본 동작을 막는 것(+page 의 전역 차단)과 짝이다 — 그냥 두면 WebView2 가
 * 세션 이력의 뒤로가기로 읽어 앱이 빈 화면이 된다.
 */
export function navButtonOf(button: number): "back" | "forward" | null {
  if (button === 3) return "back";
  if (button === 4) return "forward";
  return null;
}

/** `code` 와 `key` 를 둘 다 본다 — `code` 가 비는 장치가 있고, IME 가 켜져 있으면 `key` 가 뭉개진다 */
export function navKeyOf(ev: { key: string; code: string }): "back" | "forward" | null {
  if (ev.code === "BrowserBack" || ev.key === "BrowserBack") return "back";
  if (ev.code === "BrowserForward" || ev.key === "BrowserForward") return "forward";
  return null;
}
