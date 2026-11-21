/**
 * 표식용일 뿐 — 데이터 경로를 가르는 진짜 스위치는 백엔드 `instance.rs`(`cfg!(debug_assertions)`)다.
 * `tauri build --debug` 에서만 둘이 어긋나 표식이 빠진다 (docs/log/2026-09-26-dev-release-isolation.md).
 */
export const DEV_INSTANCE: boolean = import.meta.env.DEV;

/** 창 제목(`instance.rs` 의 `WINDOW_TITLE`)과 같은 글자 */
export const APP_TITLE = DEV_INSTANCE ? "Aynx (dev)" : "Aynx";
