/**
 * **탐색 이력** — 파일·세션 타일의 "뒤로 / 앞으로" 가 보는 유일한 모델
 * (docs/log/2026-09-04-nav-history.md).
 *
 * ## 왜 순수(pure)인가
 *
 * 이 파일에는 Svelte 임포트도 룬도 없다. 브라우저의 `history` 도 보지 않는다 — 앱이
 * SPA 한 장이라 웹뷰의 세션 이력은 **창 하나에 하나뿐**인데, 우리에게 필요한 것은
 * **타일마다 따로**인 이력이다 (파일 타일 둘을 나란히 열어 각자 다른 폴더를 오가는 것이
 * 이 앱의 값어치다). 그래서 이력을 값으로 들고 다니고, 그 값을 다루는 규칙만 여기 둔다.
 *
 * ## 모델
 *
 * 브라우저와 같은 **한 줄 + 커서**다: `entries` 는 지나온 자리들이고 `index` 가 지금 어디를
 * 보고 있는지를 가리킨다. 뒤로는 커서를 왼쪽으로, 앞으로는 오른쪽으로 옮길 뿐이고 —
 * 줄 자체는 그대로다. **새로 어딘가로 가면**(`push`) 커서 오른쪽(= 앞으로-이력)이 통째로
 * 잘려 나간다: 갈래가 갈린 순간 그쪽은 더 이상 "앞" 이 아니다.
 *
 * ```
 *   entries: [ A , B , C , D ]
 *   index:         ^ (=1, 지금 B)
 *   push(E) → [ A , B , E ]   (C·D 는 버린다)
 * ```
 *
 * 값은 전부 **불변**으로 다룬다 — 새 객체를 돌려주므로 Svelte 의 `$state` 에 그대로 대입할
 * 수 있고, 바뀔 것이 없으면 **같은 객체**를 돌려주므로 대입이 헛되이 갱신을 부르지 않는다.
 */

/** 한 타일이 기억할 자리 수의 상한 — 넘치면 **가장 오래된 것부터** 밀려난다 */
export const MAX_ENTRIES = 50;

export interface NavHistory {
  /** 지나온 자리들 (오래된 것 → 최근 것). 파일 타일은 절대 경로, 세션 타일은 그룹 경로다 */
  readonly entries: readonly string[];
  /**
   * 지금 보고 있는 자리의 색인. **빈 이력에서는 `-1`** 이다 — `entries[index]` 가
   * "지금 어디" 이므로, 아직 아무 데도 가 보지 않았다는 것을 가리킬 값이 하나 필요하다.
   */
  readonly index: number;
}

export function emptyHistory(): NavHistory {
  return { entries: [], index: -1 };
}

/** 지금 보고 있는 자리 (빈 이력이면 `null`) */
export function current(h: NavHistory): string | null {
  return h.index >= 0 ? h.entries[h.index] : null;
}

export function canBack(h: NavHistory): boolean {
  return h.index > 0;
}

export function canForward(h: NavHistory): boolean {
  return h.index >= 0 && h.index < h.entries.length - 1;
}

/**
 * 새 자리에 도착했다.
 *
 * 세 가지 규칙이 한 자리에 있다:
 *
 * 1. **같은 자리를 연달아 밀면 무시한다.** 새로고침·재연결이 보던 폴더를 다시 읽는 것은
 *    이동이 아니다 — 그것까지 쌓이면 [뒤로] 를 열 번 눌러야 한 칸 움직인다.
 * 2. **앞으로-이력을 버린다.** 뒤로 갔다가 다른 곳으로 새면 원래의 "앞" 은 더 이상 앞이 아니다.
 * 3. **[`MAX_ENTRIES`] 를 넘으면 앞에서부터 버린다.** 오래된 자리를 잊는 것이 최근 자리를
 *    못 쌓는 것보다 낫다 (커서도 함께 당겨진다).
 */
export function push(h: NavHistory, path: string): NavHistory {
  if (current(h) === path) return h;
  const kept = h.entries.slice(0, h.index + 1);
  kept.push(path);
  const over = kept.length - MAX_ENTRIES;
  const entries = over > 0 ? kept.slice(over) : kept;
  return { entries, index: entries.length - 1 };
}

/**
 * 한 걸음 옮긴 **결과와 목적지**. 실제로 갈 수 있는지(폴더가 아직 있는지)는 이 파일이
 * 알 수 없으므로, 화면 쪽이 `path` 로 이동을 시도해 보고 **성공했을 때만** `h` 를 채택한다.
 * 실패했으면 [`dropAt`] 으로 그 항목을 이력에서 떨어낸다.
 */
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

/**
 * 이력에서 한 항목을 지운다 — **그 자리가 사라졌을 때** 쓴다 (폴더를 지웠거나 USB 를 뺐거나).
 *
 * 죽은 자리를 남겨 두면 [뒤로] 를 누를 때마다 같은 오류가 다시 뜨고, 사용자는 그 항목을
 * 건너뛸 방법이 없다. 커서는 **지금 보고 있는 자리를 계속 가리키도록** 함께 당겨진다.
 */
export function dropAt(h: NavHistory, at: number): NavHistory {
  if (at < 0 || at >= h.entries.length) return h;
  const entries = h.entries.filter((_, i) => i !== at);
  const index = h.index > at ? h.index - 1 : Math.min(h.index, entries.length - 1);
  return { entries, index };
}

/**
 * 마우스 버튼 번호 → 이동 방향. 5-버튼 마우스의 엄지 버튼 둘이 `MouseEvent.button` 에서
 * `3`(뒤로) · `4`(앞으로) 로 온다 (`button` 은 0=주·1=휠·2=보조다).
 *
 * **웹뷰의 기본 동작을 막는 것과 짝**으로만 뜻이 있다: 그냥 두면 WebView2 가 이 버튼을
 * 세션 이력의 뒤로가기로 읽어 SPA 한 장짜리 앱이 빈 화면이 된다 (+page 의 전역 차단).
 */
export function navButtonOf(button: number): "back" | "forward" | null {
  if (button === 3) return "back";
  if (button === 4) return "forward";
  return null;
}

/**
 * 이 키가 **전용 내비게이션 키**인가 (멀티미디어 키보드의 ⏴/⏵ · 일부 노트북의 Fn 조합).
 *
 * `code` 와 `key` 를 둘 다 보는 이유: 이 키들은 `code` 가 비는 장치가 있고
 * (`key` 로만 온다), 반대로 IME 가 켜져 있으면 `key` 가 뭉개진다 — 둘 중 하나만 봐서는
 * 어느 한쪽 장치에서 조용히 죽는다.
 */
export function navKeyOf(ev: { key: string; code: string }): "back" | "forward" | null {
  if (ev.code === "BrowserBack" || ev.key === "BrowserBack") return "back";
  if (ev.code === "BrowserForward" || ev.key === "BrowserForward") return "forward";
  return null;
}
