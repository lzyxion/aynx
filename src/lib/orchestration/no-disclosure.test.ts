// 오케스트레이션 화면에는 ▶ 삼각형 펼침(`<details>` · `<summary>`)을 두지 않는다(2026-10-31 사용자 결정 · 목업 V3FoldA):
// 큰 덩어리는 고르기 알약 탭(`player/SegTabs.svelte`), 작은 부가 정보는 늘 보이는 칩 · 칸, 한두 문장 설명은 ⓘ 팝오버(`InfoNote` + 판 뿌리의 `NotePopover`).
// 다시 들어오지 않게 이 폴더의 .svelte 를 훑는다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL(".", import.meta.url));

function svelteFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) svelteFiles(p, out);
    else if (name.endsWith(".svelte")) out.push(p);
  }
  return out;
}

describe("오케스트레이션 화면에 펼침 없음", () => {
  it("<details> · <summary> 를 쓰지 않는다", () => {
    const hits = svelteFiles(DIR).filter((p) => /<(details|summary)[\s>]/.test(readFileSync(p, "utf8")));
    expect(hits).toEqual([]);
  });

  it("ⓘ 를 쓰는 판은 팝오버 한 벌을 판 뿌리(RunBoard)에 세운다", () => {
    const board = readFileSync(join(DIR, "RunBoard.svelte"), "utf8");
    expect(board).toContain("<NotePopover");
  });
});
