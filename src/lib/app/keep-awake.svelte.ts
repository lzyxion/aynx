import { invoke, listen } from "../ipc";

/**
 * **잠자기 방지의 창 사본** (2026-10-23 — 독 실행 판 ☕ 칸 · 상태바 알림 알약의 ☕ 표시).
 *
 * 켜고 끄는 몸은 GUI 프로세스의 Rust 하나다(`src-tauri/src/keep_awake.rs` — 전원 요청 핸들을 쥔다 · 앱 시작 때 늘 꺼짐 · 저장하지
 * 않는다 · GUI 가 끝나면 풀린다). 이 모듈은 창마다 `{ supported, on }` 사본 하나를 들고, 부팅 때 한 번 · `keep-awake` 이벤트마다
 * (어느 창에서 바꿔도 모든 창이 같은 값을 본다) · 창이 포커스를 얻을 때(이벤트를 놓친 경우의 그물) 다시 읽는다.
 * 프런트는 OS 를 모른다 — `supported` 가 `false` 면 칸을 세우지 않는다.
 */

let state = $state<{ supported: boolean; on: boolean }>({ supported: false, on: false });

/** 이 OS 에 잠자기 방지가 있나(반응형) — 없으면 독 칸 · 상태바 표시를 그리지 않는다 */
export function keepAwakeSupported(): boolean {
  return state.supported;
}

/** 지금 켜져 있나(반응형) */
export function keepAwakeOn(): boolean {
  return state.on;
}

function apply(v: unknown): void {
  const r = (v ?? {}) as { supported?: unknown; on?: unknown };
  state = { supported: r.supported === true, on: r.on === true };
}

/** 다시 읽는다 — 실패는 삼킨다(옛 판 GUI 에 명령이 없으면 칸이 서지 않을 뿐이다) */
export async function refreshKeepAwake(): Promise<void> {
  try {
    apply(await invoke<unknown>("keep_awake_status"));
  } catch {
    // 지원 안 함으로 둔다
  }
}

/** 켜고 끈다 — 결과(지금 상태)로 사본을 맞춘다. 다른 창은 `keep-awake` 이벤트로 따라온다 */
export async function setKeepAwake(on: boolean): Promise<void> {
  try {
    apply(await invoke<unknown>("keep_awake_set", { on }));
  } catch (e) {
    console.warn("[aynx] 잠자기 방지를 바꾸지 못했습니다:", e);
    void refreshKeepAwake();
  }
}

/** 뒤집는다 — 독 실행 판의 ☕ 칸이 부른다(켜기 · 끄기 둘 다 — 상태바 알림 알약의 ☕ 는 2026-10-24 부터 표시뿐) */
export function toggleKeepAwake(): void {
  void setKeepAwake(!state.on);
}

/** 창 수명 동안 사본을 맞춘다 — `mountAppListeners` 가 건다. 돌려준 함수가 전부 푼다 */
export function mountKeepAwake(): () => void {
  void refreshKeepAwake();
  const changed = listen<boolean>("keep-awake", (e) => {
    state = { ...state, on: e.payload === true };
  }).catch(() => () => {});
  const onFocus = () => void refreshKeepAwake();
  if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
  return () => {
    void changed.then((un) => un());
    if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
  };
}
