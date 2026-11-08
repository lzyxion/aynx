import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_LOCKED_FROM, LOCAL_STAGE_ROWS, localAiStage, pickLocalAi } from "./local-ai";
import { isShared, setShared } from "$lib/ai.svelte.js";
import { AI_STAGES, AI_STAGE_NAME } from "$lib/delegation";
import { ko } from "$lib/i18n/ko";
import { en } from "$lib/i18n/en";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("로컬 타일의 AI 권한 팝오버(10-23 — 예전 'AI 읽기 허용' 토글)", () => {
  afterEach(() => setShared("lp1", false));

  it("단계 줄은 원격과 같은 다섯 · 같은 이름이고 Ask 부터 잠긴다", () => {
    expect(LOCAL_STAGE_ROWS.map((r) => r.id)).toEqual([...AI_STAGES]);
    expect(LOCAL_STAGE_ROWS.map((r) => r.name)).toEqual(AI_STAGES.map((s) => AI_STAGE_NAME[s]));
    expect(AI_STAGES[LOCAL_LOCKED_FROM]).toBe("approve");
    // 고를 수 있는 둘의 설명은 "이 타일" 의 말이다(원격 문구는 "이 호스트의 세션")
    expect(LOCAL_STAGE_ROWS[0].desc).toBe("pane.localaiperm.off.desc");
    expect(LOCAL_STAGE_ROWS[1].desc).toBe("pane.localaiperm.read.desc");
  });

  it("지금 단계 = 타일별 읽기 허용 — 고르면 그 값이 바뀌고(같은 저장) 잠긴 자리는 무시한다", () => {
    expect(localAiStage("lp1")).toBe("off");
    pickLocalAi("lp1", "read");
    expect(isShared("lp1")).toBe(true);
    expect(localAiStage("lp1")).toBe("read");
    for (const s of ["approve", "auto", "all"] as const) {
      pickLocalAi("lp1", s);
      expect(isShared("lp1")).toBe(true);
    }
    pickLocalAi("lp1", "off");
    expect(isShared("lp1")).toBe(false);
    pickLocalAi("lp1", "all");
    expect(isShared("lp1")).toBe(false);
  });

  it("원격 창에서 켤 때는 예전 토글처럼 마스터를 다시 확인한다 · 새 저장 길은 없다", () => {
    const ctl = src("./local-ai.ts") + src("./local-ai-menu.svelte.ts");
    expect(ctl).toContain('confirmRemoteMaster("set_session_ai_read")');
    expect(ctl).not.toContain("invoke(");
    // PaneHost 의 예전 체크 줄 배선(`toggle-ai`)은 걷혔다 — 로컬도 "ai-permission" 하나
    // ⋯ 메뉴 배선표는 타일 메뉴 컨트롤러 · 팝오버 그림은 PanePopovers(2026-10-26 PaneHost 에서 뗌)
    const host = src("../PaneHost.svelte");
    const tileMenu = src("./tile-menu-controller.svelte.ts");
    const pops = src("./PanePopovers.svelte");
    expect(host + tileMenu + pops).not.toContain('"toggle-ai"');
    expect(tileMenu).toContain("h.lam.open(m, at)");
    expect(pops).toContain("lockedFrom={LOCAL_LOCKED_FROM}");
  });

  it("문구 — 제목 · 각주가 두 사전에 있다", () => {
    expect(ko.pane["localaiperm.title"]).toBe("이 타일의 AI 권한");
    expect(ko.pane["localaiperm.foot"]).toBe("로컬 타일은 AI 실행 대상이 아닙니다 — Ask · Auto · YOLO 는 원격 호스트에만");
    expect(en.pane["localaiperm.foot"]).toContain("Ask · Auto · YOLO");
    expect(ko.app["ai.gauge.locked"]).toBe("{name} (잠김)");
  });
});
