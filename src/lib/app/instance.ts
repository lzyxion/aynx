/**
 * 이 창이 **개발 인스턴스**(`npm run tauri dev`)인가 — 릴리스 aynx 과 나란히 띄웠을 때 두 창을 눈으로
 * 가르는 표식의 근거 (docs/log/2026-09-26-dev-release-isolation.md).
 *
 * 폴더·MCP 이름·창 제목을 가르는 진짜 스위치는 백엔드의 `instance.rs`(`cfg!(debug_assertions)`)다.
 * 여기서는 vite 의 `import.meta.env.DEV`(개발 서버에서 실렸나)를 쓴다 — `tauri dev` 에서는 둘이 늘
 * 같고, 어긋나는 것은 `tauri build --debug`(프런트는 빌드본) 하나뿐이라 표식이 빠질 뿐 데이터는
 * 백엔드가 이미 갈라 두었다. 그 한 경우를 위해 부팅에 명령 왕복을 더하지 않는다.
 */
export const DEV_INSTANCE: boolean = import.meta.env.DEV;

/** 사람에게 보이는 앱 이름 — OS 알림 제목 앞머리 등. 창 제목(`instance.rs` 의 `WINDOW_TITLE`)과 같은 글자. */
export const APP_TITLE = DEV_INSTANCE ? "Aynx (dev)" : "Aynx";
