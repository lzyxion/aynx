// 설정 화면 **원격 접속** 손잡이 — `[remote]`(R1a-5 · `RemoteSection`). 값은 [저장] 이 쓰고, 관문은 저장 뒤 Rust 가 다시 맞춘다
// (`remote::sync`). 켜기 · 이름 · 포트는 **집 PC 에서만**이다 — 원격 창에서 바꾸면 Rust 가 저장을 거절한다(`remote/deny.rs`
// 칸 단위 문). 화면도 원격에서 그 칸을 잠근다. 끄기는 어디서나 된다. 예외 하나 — [연결] 은 [저장] 을 기다리지 않는다(`markRemoteConnected`).
import { settings } from "./store.svelte.js";

/**
 * **[연결] 이 파일에 쓴 `[remote]` 를 이 창에 맞춘다**(Rust `remote/serve.rs` 가 저장을 마친 뒤) — `current` · `saved` 의 remote 칸만 고치므로
 * 저장 전이던 다른 칸의 편집은 편집인 채로 남고 함께 저장되지도 않는다. 포트는 Rust 에 보낸 값 그대로(`null` = 안 정함).
 */
export function markRemoteConnected(host: string, port: number | null): void {
  const remote = { enabled: true, host, port: port ?? undefined };
  settings.current.remote = { ...remote };
  settings.saved.remote = { ...remote };
}

/** 켬/끔 — 끔이 기본이라 **켤 때만** 값을 남긴다(Rust `RemotePrefs::sanitize` 와 같은 규칙). */
export function setRemoteEnabled(on: boolean): void {
  settings.current.remote.enabled = on ? true : undefined;
}

/** 받을 MagicDNS 이름 — 공백을 걷고 소문자. 빈 값 = 미설정. */
export function setRemoteHost(host: string): void {
  const h = host.trim().toLowerCase();
  settings.current.remote.host = h === "" ? undefined : h;
}

/** 127.0.0.1 포트 — 1~65535 정수만, 그 밖(빈 칸 포함)은 "안 정함"(인스턴스 기본 — 릴리스 47821 · 개발 47822). */
export function setRemotePort(port: number): void {
  settings.current.remote.port = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}
