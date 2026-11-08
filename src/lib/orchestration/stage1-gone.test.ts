// 오케스트레이션 2단계 단계 6 — 1단계 터미널 프로듀서 길을 걷었다(aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md 6절).
// 프로듀서는 오케스트레이션 탭의 프로듀서 채팅 하나뿐이고, 타일(로컬 AI 타일 · 감싸개 셸 타일)은 조정자가 될 수 없다. 그 길의 이름이 프런트 소스에
// 다시 들어오지 않게 훑는다(이 파일 자신만 뺀다 — 다른 시험 파일도 본다).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

/** 걷은 이름들 — Tauri 명령 · 프런트 함수 · 서버 칸 */
const GONE = [
  "orchestration_set_producer",
  "orchestration_revoke_tile",
  "setProducer(",
  "coordinatorStream",
  "startAlbum",
  "openProducerIn",
  "producerPaneOf",
  "producerSlots",
  "promotePaneAs",
];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|js|svelte)$/.test(name)) out.push(p);
  }
  return out;
}

describe("1단계 터미널 프로듀서 길이 남지 않았다(단계 6)", () => {
  it("src/ 에 옛 이름이 없다", () => {
    const files = sources(SRC).filter((f) => f !== SELF);
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((f) => {
      const s = readFileSync(f, "utf8");
      return GONE.filter((w) => s.includes(w)).map((w) => `${f.slice(SRC.length)}: ${w}`);
    });
    expect(hits).toEqual([]);
  });
});
