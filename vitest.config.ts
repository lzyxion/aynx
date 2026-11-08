import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 테스트 전용 설정 — `vite.config.js`(SvelteKit 플러그인 포함)를 쓰지 않는다.
//
// SvelteKit 플러그인은 라우트 스캔·`$app/*` 가상 모듈·`svelte-kit sync` 상태에 얽혀 있고,
// 여기서 도는 것은 **DOM 도 runes 도 필요 없는 순수 모듈**뿐이라 얻을 것이 없다.
// 대신 `$lib` 별칭만 손으로 풀어 준다 (SvelteKit 이 `svelte.config.js` 에서 정하는 것과 같은 자리).
//
// `.svelte.ts`(모듈 상태 = `$state`)는 대상이 아니다 — 그쪽은 svelte 컴파일러를 태워야 한다.
export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
      // 패키지가 `main`(lib/addon-ligatures.js)을 싣지 않고 `.mjs` 만 내놓아 node 해석이 실패한다 —
      // `term/renderer-addons` 의 동적 import 를 시험이 거치므로(시험은 모형으로 갈아 끼운다) 자리만 맞춰 준다.
      "@xterm/addon-ligatures": fileURLToPath(
        new URL("./node_modules/@xterm/addon-ligatures/lib/addon-ligatures.mjs", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // `@material/material-color-utilities` 는 확장자 없는 상대 import 를 쓰는 ESM 이라
    // node 가 직접 읽으면 ERR_MODULE_NOT_FOUND 가 난다. vite 로 변환해 들여온다.
    server: { deps: { inline: ["@material/material-color-utilities"] } },
  },
});
