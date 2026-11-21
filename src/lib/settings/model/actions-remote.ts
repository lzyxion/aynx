// `[remote]` — 켜기 · 이름 · 포트는 메인 PC 에서만이다(원격 창에서 바꾸면 Rust `remote/deny.rs` 가 저장을 거절한다). 끄기는 어디서나 된다.
import { settings } from "./store.svelte.js";

/**
 * [연결] 은 [저장] 을 기다리지 않는다(Rust `remote/serve.rs` 가 이미 썼다) — `current` · `saved` 의 remote 칸만 고치므로
 * 저장 전이던 다른 칸의 편집은 편집인 채로 남고 함께 저장되지도 않는다.
 */
export function markRemoteConnected(host: string, port: number | null): void {
  const remote = { enabled: true, host, port: port ?? undefined };
  settings.current.remote = { ...remote };
  settings.saved.remote = { ...remote };
}

/** Rust `RemotePrefs::sanitize` 와 같은 규칙 — 켤 때만 값을 남긴다 */
export function setRemoteEnabled(on: boolean): void {
  settings.current.remote.enabled = on ? true : undefined;
}

export function setRemoteHost(host: string): void {
  const h = host.trim().toLowerCase();
  settings.current.remote.host = h === "" ? undefined : h;
}

/** 범위 밖은 "안 정함"(인스턴스 기본 — 릴리스 47821 · 개발 47822) */
export function setRemotePort(port: number): void {
  settings.current.remote.port = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}
