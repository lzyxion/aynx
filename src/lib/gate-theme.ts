import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isRemote } from "$lib/ipc";

/**
 * **원격 관문 쪽 색을 메인 PC 앱 색에 맞춘다**(2026-11-01 사용자 결정).
 *
 * 원격 브라우저의 페어링 · 잠금 해제 쪽(`src-tauri/src/remote/gate/gate.css`)은 앱 번들 밖이라 theme.css 를 못 읽는다. 그래서 집 PC
 * **주 창**이 색을 칠할 때마다(`applySettings` 끝 — 설정 적용 · 모드 전환 · 색 테마 · 월페이퍼 동적 색 모두 그 함수를 지난다) 아래 원천
 * 토큰의 **계산된 값**과 밝기를 GUI Rust(`remote_gate_theme_set` — 메모리만)에 넘기고, 관문이 `/remote/theme.css` 로 싣는다.
 * gate.css 는 같은 이름의 원천에서 나머지(글래스 판 · 우물 · 배지 …)를 앱과 같은 식으로 다시 짓는다.
 *
 * - 보내는 창은 **집 PC 주 창 하나**다. 원격 창은 이 기기 밝기 사본을 칠할 수 있어 보내지 않고(서버도 `deny.rs` 의 집 PC 전용으로
 *   막는다), 보조 창은 같은 설정을 칠하므로 겹쳐 보낼 이유가 없다.
 * - 짧게 모아(슬라이더를 끌면 `applySettings` 가 잇달아 불린다) 지난번과 같으면 보내지 않는다.
 * - 재질(평면/글래스)은 보내지 않는다 — 관문은 글래스 고정.
 */

/** 관문이 받는 원천 토큰 — Rust `remote/theme.rs` 의 `TOKENS` 와 같아야 한다(그쪽 시험이 이 줄을 읽는다) */
export const GATE_THEME_TOKENS = ["--bg-base", "--bg-panel-base", "--fg", "--fg-muted", "--border", "--accent", "--on-accent", "--m3-secondary-container", "--on-accent-soft", "--tertiary", "--ok", "--err", "--chrome-pct"] as const;

export interface GateTheme {
  mode: "dark" | "light";
  tokens: Record<string, string>;
}

/** 계산값을 모은다 — 빈 칸은 싣지 않는다(관문이 gate.css 기본값을 쓴다). 순수(시험) */
export function collectGateTheme(read: (name: string) => string, light: boolean): GateTheme {
  const tokens: Record<string, string> = {};
  for (const name of GATE_THEME_TOKENS) {
    const value = read(name).trim();
    if (value) tokens[name] = value;
  }
  return { mode: light ? "light" : "dark", tokens };
}

/** 같은 벌인가를 견줄 열쇠 — 토큰 순서는 목록 순서로 고정이다. 순수(시험) */
export function gateThemeKey(theme: GateTheme): string {
  return JSON.stringify([theme.mode, GATE_THEME_TOKENS.map((n) => theme.tokens[n] ?? "")]);
}

const DEBOUNCE_MS = 300;

let lastSent: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** 이 창이 보낼 창인가 — 집 PC 주 창만. 처음 부를 때 한 번 정한다 */
function isSender(): boolean {
  if (isRemote || typeof document === "undefined") return false;
  try {
    return getCurrentWindow().label === "main";
  } catch {
    return false; // Tauri 가 없는 자리(시험 · 헤드리스)
  }
}

let sender: boolean | null = null;

/** `applySettings` 가 토큰을 다 얹은 뒤 부른다 — 짧게 모아 바뀌었을 때만 넘긴다 */
export function syncGateTheme(root: HTMLElement): void {
  sender ??= isSender();
  if (!sender) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const computed = getComputedStyle(root);
    const theme = collectGateTheme((n) => computed.getPropertyValue(n), root.dataset.theme === "light");
    const key = gateThemeKey(theme);
    if (key === lastSent) return;
    lastSent = key;
    void invoke("remote_gate_theme_set", { mode: theme.mode, tokens: theme.tokens }).catch((e) => {
      lastSent = null; // 다음 칠할 때 다시 보낸다
      console.warn("[aynx] 원격 관문 색을 넘기지 못했습니다 (무시):", e);
    });
  }, DEBOUNCE_MS);
}
