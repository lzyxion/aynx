import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rawBodyLimit, REMOTE_RAW_MAX_BYTES } from "$lib/ipc";

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

describe("원격 창의 원시 본문 상한", () => {
  it("메인 PC 창은 상한 그대로, 원격 창은 ws 상한 안쪽으로 줄인다", () => {
    const limit = 100 * 1024 * 1024;
    expect(rawBodyLimit(limit, false)).toBe(limit);
    expect(rawBodyLimit(limit, true)).toBe(REMOTE_RAW_MAX_BYTES);
    // 이미 더 작은 상한(사이드 채팅 10MB 등)은 건드리지 않는다
    expect(rawBodyLimit(10 * 1024 * 1024, true)).toBe(10 * 1024 * 1024);
  });

  it("`ws.rs` 의 `MAX_MESSAGE` 보다 작다 — 머리 몫(종류·id·머리 JSON)이 들어갈 자리가 남는다", () => {
    const rs = readFileSync(new URL("../../src-tauri/src/remote/ws.rs", import.meta.url), "utf8");
    const m = rs.match(/const MAX_MESSAGE: usize = ([\d\s*]+);/);
    expect(m).not.toBeNull();
    const max = m![1]
      .split("*")
      .map((n) => Number(n.trim()))
      .reduce((a, b) => a * b, 1);
    expect(max).toBe(16 * 1024 * 1024);
    expect(REMOTE_RAW_MAX_BYTES).toBeLessThan(max - 4096);
  });

  it("정수 MiB(15) — 안내 문구가 정수 MB 로만 적는다(`fs-ops` · `agent-attachments`)", () => {
    expect(REMOTE_RAW_MAX_BYTES).toBe(15 * 1024 * 1024);
  });
});
