// 번들 문법 수준 — `vite.config.js` 의 `build.target` 과 회귀 시험
// (`src/lib/build-target.test.ts`)이 같은 값을 보게 여기 하나에만 둔다.
//
// Vite 6 기본(`modules` = es2020 …)이면 esbuild 가 압축하며 `||=` 를 낮추다가 xterm 6.0.0
// `requestMode` 의 `let` 을 떨어뜨린다 → DECRQM(`ESC [ ? 12 $ p`, vim 이 시작 때 보냄)에서
// ReferenceError → 쓰기 큐가 다시 돌지 않아 그 타일이 영영 멈춘다(릴리스 빌드만).
// es2021 이면 `||=` 를 그대로 둔다. WebView2 는 늘 최신 Chromium 이고, 전 OS 바닥(Safari 14+)도
// `||=` 를 받는다 → docs/log/2026-10-14-vi-freeze-decrqm.md
export const BUILD_TARGET = "es2021";
