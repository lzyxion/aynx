import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isRemote } from "$lib/ipc";

/**
 * 원격 관문(`src-tauri/src/remote/gate/gate.css` — 앱 번들 밖)의 색을 메인 PC 앱 색에 맞춘다.
 * 보내는 창은 메인 PC 주 창 하나 — 원격 창은 이 기기 밝기 사본을 칠할 수 있어 보내지 않는다(서버도 `deny.rs` 에서 막는다).
 */

/** Rust `remote/theme.rs` 의 `TOKENS` 와 같아야 한다(그쪽 시험이 이 줄을 읽는다) */
export const GATE_THEME_TOKENS = ["--bg-base", "--bg-panel-base", "--fg", "--fg-muted", "--border", "--accent", "--on-accent", "--m3-secondary-container", "--on-accent-soft", "--tertiary", "--ok", "--err", "--chrome-pct"] as const;

export interface GateTheme {
  mode: "dark" | "light";
  tokens: Record<string, string>;
}

/** 빈 칸은 싣지 않는다 — 관문이 gate.css 기본값을 쓴다 */
export function collectGateTheme(read: (name: string) => string, light: boolean): GateTheme {
  const tokens: Record<string, string> = {};
  for (const name of GATE_THEME_TOKENS) {
    const value = read(name).trim();
    if (value) tokens[name] = value;
  }
  return { mode: light ? "light" : "dark", tokens };
}

export function gateThemeKey(theme: GateTheme): string {
  return JSON.stringify([theme.mode, GATE_THEME_TOKENS.map((n) => theme.tokens[n] ?? "")]);
}

const DEBOUNCE_MS = 300;

let lastSent: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function isSender(): boolean {
  if (isRemote || typeof document === "undefined") return false;
  try {
    return getCurrentWindow().label === "main";
  } catch {
    return false; // Tauri 가 없는 자리(시험 · 헤드리스)
  }
}

let sender: boolean | null = null;

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
