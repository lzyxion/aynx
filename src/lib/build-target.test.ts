import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";
import { BUILD_TARGET } from "../../build-target.js";

/**
 * 릴리스 번들 문법 수준 회귀 (docs/log/2026-10-14-vi-freeze-decrqm.md).
 *
 * dev 빌드는 압축하지 않아 멀쩡했고 **릴리스에서만** 타일이 멈췄다 — 그래서 vitest 가 늘 보는
 * 원본 xterm 이 아니라, 릴리스와 같은 길(esbuild 압축 + `BUILD_TARGET`)을 거친 xterm 을 띄워
 * DECRQM 에 답하는지 본다. 붙잡아 두는 것 둘: **쓰기 콜백이 돈다**(큐가 멈추지 않는다) ·
 * **`$y` 답이 나온다**.
 */

const require = createRequire(import.meta.url);
const XTERM_MJS = join(require.resolve("@xterm/xterm/package.json"), "..", "lib", "xterm.mjs");
const dir = mkdtempSync(join(tmpdir(), "aynx-build-target-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type TerminalCtor = new (opts: { allowProposedApi: boolean }) => {
  onData(cb: (data: string) => void): void;
  write(data: string, cb?: () => void): void;
  dispose(): void;
};

/** 릴리스처럼 압축한 xterm 을 임시 파일로 써 불러온다. */
async function minifiedXterm(target: string, name: string): Promise<TerminalCtor> {
  const { code } = await transform(readFileSync(XTERM_MJS, "utf8"), {
    minify: true,
    target,
    format: "esm",
  });
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, code);
  const mod = await import(/* @vite-ignore */ pathToFileURL(file).href);
  return mod.Terminal as TerminalCtor;
}

describe("BUILD_TARGET", () => {
  it("압축한 xterm 이 DECRQM 에 답하고 쓰기 큐가 계속 돈다", async () => {
    const Terminal = await minifiedXterm(BUILD_TARGET, "target");
    const term = new Terminal({ allowProposedApi: true });
    const replies: string[] = [];
    term.onData((d) => replies.push(d));
    // vim 9.1 이 시작 때 보내는 것 — 커서 깜빡임 모드 질의.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("쓰기 콜백이 돌지 않았다 — 큐가 멈췄다")), 2000);
      term.write("\x1b[?12$p", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    expect(replies.join("")).toMatch(/\x1b\[\?12;\d\$y/);
    term.dispose();
  });
});
