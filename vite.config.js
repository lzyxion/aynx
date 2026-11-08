import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { BUILD_TARGET } from "./build-target.js";

// `process` 는 `@types/node` 가 들어오면서 타입이 붙었다 (vitest 도입, 2026-09-05) —
// 예전의 `@ts-expect-error` 는 이제 "쓰이지 않는 지시자" 로 검사에 걸린다.
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit()],

  // 기본(es2020)으로 두면 esbuild 가 압축하며 `||=` 를 낮추다 xterm `requestMode` 의 `let` 을
  // 떨어뜨려, vim 의 DECRQM 하나에 릴리스 타일이 영영 멈춘다. 값과 이유는 `build-target.js`
  // (회귀 시험과 같은 값) → docs/log/2026-10-14-vi-freeze-decrqm.md
  build: { target: BUILD_TARGET },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    // dev 서버가 내줘도 되는 폴더 — SvelteKit 이 정한 목록(`src` 등)에 **더해진다**. 스플래시가 창 아이콘과
    // 같은 256px 캐릭터 원본을 번들한다(`src/lib/splash-memo.ts`). 빌드는 이 검사를 하지 않아 dev 에서만 막혔다.
    fs: {
      allow: ["src-tauri/icons/characters"],
    },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      //
      // 나머지는 **게이트가 앱을 새로고침시키지 않게** 하는 목록이다
      // (docs/log/2026-09-05-session-leak-on-reload.md 3절). `npm run build` 는 `build/`
      // 와 `.svelte-kit/output/` 을, `npm run check`(= `svelte-kit sync`)는
      // `.svelte-kit/types/`·`tsconfig.json` 을 다시 쓴다. `tauri dev` 가 떠 있는 채로 그
      // 게이트를 돌리면 감시자가 그 쓰기를 보고 **전체 리로드**를 쏘고, 그러면 터미널이 전부
      // 다시 마운트된다 (세션 누수의 실제 방아쇠였다). 여기 적힌 것들은 dev 서버가 읽는
      // 입력이 아니라 **산출물**이라 무시해도 HMR 이 잃는 것이 없다.
      //
      // `.svelte-kit/generated/`(라우트 매니페스트)는 **일부러 빼지 않았다** — 라우트를
      // 추가·삭제하면 그 파일이 갱신돼야 dev 서버가 따라온다.
      ignored: [
        "**/src-tauri/**",
        "**/build/**",
        "**/.svelte-kit/output/**",
        "**/.svelte-kit/types/**",
        "**/.svelte-kit/tsconfig.json",
        "**/.svelte-kit/ambient.d.ts",
        "**/.svelte-kit/non-ambient.d.ts",
      ],
    },
  },
}));
