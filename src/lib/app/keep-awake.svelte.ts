import { invoke, listen } from "../ipc";

/**
 * 잠자기 방지의 창 사본 — 켜고 끄는 몸은 GUI 프로세스의 Rust `keep_awake.rs` 하나다(저장하지 않는다).
 * 프런트는 OS 를 모른다 — `supported` 가 `false` 면 칸을 세우지 않는다.
 */

let state = $state<{ supported: boolean; on: boolean }>({ supported: false, on: false });

export function keepAwakeSupported(): boolean {
  return state.supported;
}

export function keepAwakeOn(): boolean {
  return state.on;
}

function apply(v: unknown): void {
  const r = (v ?? {}) as { supported?: unknown; on?: unknown };
  state = { supported: r.supported === true, on: r.on === true };
}

export async function refreshKeepAwake(): Promise<void> {
  try {
    apply(await invoke<unknown>("keep_awake_status"));
  } catch {
    // 지원 안 함으로 둔다
  }
}

export async function setKeepAwake(on: boolean): Promise<void> {
  try {
    apply(await invoke<unknown>("keep_awake_set", { on }));
  } catch (e) {
    console.warn("[aynx] 잠자기 방지를 바꾸지 못했습니다:", e);
    void refreshKeepAwake();
  }
}

export function toggleKeepAwake(): void {
  void setKeepAwake(!state.on);
}

/** 창 포커스 때도 다시 읽는다 — 이벤트를 놓친 경우의 그물 */
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
