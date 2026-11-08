import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 프런트의 Tauri core·event 길은 `src/lib/ipc.ts` 하나 — 원격 웹(R1)이 전송을 바꿔 끼우려면
 * 다른 파일이 `@tauri-apps/api/core` · `@tauri-apps/api/event` 를 직접 부르면 안 된다.
 *
 * 시험 파일(`*.test.ts` · `src/test/`)은 빼고 본다 — 시험은 패키지 이름으로 `vi.mock` 하고 그 모형 손잡이를
 * 같은 이름으로 들여온다(어댑터를 거쳐도 같은 모형이 먹는다). 플러그인·`api/window` 등은 R0 범위 밖.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));
const ADAPTER = fileURLToPath(new URL("./ipc.ts", import.meta.url));
const FORBIDDEN = /["']@tauri-apps\/api\/(core|event)["']/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (p !== join(SRC, "test")) sources(p, out);
    } else if (/\.(ts|js|svelte)$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("IPC 어댑터 하나", () => {
  it("src/lib/ipc.ts 밖의 소스는 @tauri-apps/api/core·event 를 부르지 않는다", () => {
    const files = sources(SRC).filter((f) => f !== ADAPTER);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files
      .filter((f) => FORBIDDEN.test(readFileSync(f, "latin1")))
      .map((f) => relative(SRC, f).split("\\").join("/"));
    expect(offenders).toEqual([]);
  });

  it("어댑터 자신은 두 패키지를 다시 내보낸다", () => {
    const text = readFileSync(ADAPTER, "utf8");
    expect(text).toMatch(/from "@tauri-apps\/api\/core"/);
    expect(text).toMatch(/from "@tauri-apps\/api\/event"/);
  });
});
