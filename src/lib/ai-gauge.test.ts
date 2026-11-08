import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAUGE_SEGMENTS, gaugeIconName, gaugeIndex, gaugeKeyStep, gaugeTone, segmentFilled, segmentShape } from "./ai-gauge";
import { UI_ICONS } from "./ui-icons.generated";
import { AI_STAGES, AI_STAGE_NAME } from "./delegation";
import { DB_AI_LEVELS, DB_AI_NAME } from "./db-ai";
import { ko } from "./i18n/ko";
import { en } from "./i18n/en";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("AI 권한 게이지 — 자리 · 칸(10-23)", () => {
  it("게이지 글리프 이름 — 자리마다 하나 · 생성 목록에 있다 · 고른 것이 없으면 끔", () => {
    for (let at = 0; at <= GAUGE_SEGMENTS; at++) {
      expect(gaugeIconName(at)).toBe(`ai-gauge-${at}`);
      expect(UI_ICONS).toHaveProperty(gaugeIconName(at));
      // 찬 막대 수 = 자리 (빈 막대는 옅은 칠)
      const body = UI_ICONS[gaugeIconName(at)]!.body;
      expect((body.match(/<rect /g) ?? []).length).toBe(GAUGE_SEGMENTS);
      expect((body.match(/fill-opacity/g) ?? []).length).toBe(GAUGE_SEGMENTS - at);
    }
    expect(gaugeIconName(-1)).toBe("ai-gauge-0");
  });

  it("호스트 · DB 단계는 둘 다 끔 + 칸 넷", () => {
    expect(AI_STAGES.length).toBe(GAUGE_SEGMENTS + 1);
    expect(DB_AI_LEVELS.length).toBe(GAUGE_SEGMENTS + 1);
    expect(gaugeIndex(AI_STAGES, "off")).toBe(0);
    expect(gaugeIndex(AI_STAGES, "all")).toBe(4);
    expect(gaugeIndex(DB_AI_LEVELS, "approve")).toBe(3);
    expect(gaugeIndex(DB_AI_LEVELS, null)).toBe(-1);
  });

  it("고른 자리까지 칸이 찬다 — 끔이면 하나도 · 모두 승인이면 넷 다", () => {
    const filled = (at: number) => [1, 2, 3, 4].filter((s) => segmentFilled(s, at));
    expect(filled(-1)).toEqual([]);
    expect(filled(0)).toEqual([]);
    expect(filled(2)).toEqual([1, 2]);
    expect(filled(4)).toEqual([1, 2, 3, 4]);
    expect(segmentFilled(0, 4)).toBe(false); // 자리 0 은 칸이 아니라 고리
  });

  it("색 자리 = 지금 자리(고른 것이 없으면 중성) · 첫 · 마지막 칸만 바깥 끝이 둥글다", () => {
    expect([-1, 0, 1, 2, 3, 4].map(gaugeTone)).toEqual([0, 0, 1, 2, 3, 4]);
    expect([1, 2, 3, 4].map(segmentShape)).toEqual(["start", "mid", "mid", "end"]);
  });

  it("←→ 는 한 칸씩 · 끝에서 돌지 않는다(모두 승인 ↔ 끔 도약 없음) · 고른 것이 없으면 끔부터", () => {
    expect(gaugeKeyStep(2, "ArrowRight", 5)).toBe(3);
    expect(gaugeKeyStep(2, "ArrowLeft", 5)).toBe(1);
    expect(gaugeKeyStep(4, "ArrowRight", 5)).toBeNull();
    expect(gaugeKeyStep(0, "ArrowLeft", 5)).toBeNull();
    expect(gaugeKeyStep(-1, "ArrowLeft", 5)).toBe(0);
    expect(gaugeKeyStep(-1, "ArrowRight", 5)).toBe(0);
    expect(gaugeKeyStep(1, "ArrowUp", 5)).toBeNull();
    expect(gaugeKeyStep(1, "Home", 5)).toBeNull();
  });

  it("잠긴 자리(로컬 타일 — Off · Read 만, 10-23)에서는 그 앞에서 멈춘다", () => {
    expect(gaugeKeyStep(0, "ArrowRight", 5, 2)).toBe(1);
    expect(gaugeKeyStep(1, "ArrowRight", 5, 2)).toBeNull();
    expect(gaugeKeyStep(1, "ArrowLeft", 5, 2)).toBe(0);
    expect(gaugeKeyStep(-1, "ArrowRight", 5, 2)).toBe(0);
  });

  it("이름 — 모든 언어에서 같은 짧은 영어 낱말(10-23): Off · Read · Ask · Auto · YOLO / Off · Schema · Read · Ask · YOLO", () => {
    for (const dict of [ko, en]) {
      const k = (key: string) => (dict as Record<string, Record<string, string>>)[key.split(".")[0]][key.slice(key.indexOf(".") + 1)];
      expect(AI_STAGES.map((s) => k(AI_STAGE_NAME[s]))).toEqual(["Off", "Read", "Ask", "Auto", "YOLO"]);
      expect(DB_AI_LEVELS.map((s) => k(DB_AI_NAME[s]))).toEqual(["Off", "Schema", "Read", "Ask", "YOLO"]);
    }
    // 짧은 이름 표 · 키는 걷혔다(넓은 자리 · 좁은 자리가 같은 글자)
    expect(src("./AiGauge.svelte")).not.toContain("shortOf");
    expect(Object.keys(ko.app).filter((key) => /^(ai\.stage|dbai\.level)\.[a-z]+\.short$/.test(key))).toEqual([]);
  });
});

describe("게이지 하나로 — 네 자리가 같은 고르개(10-23)", () => {
  it("호스트 폼 · DB 연결 폼 · 칩 팝오버가 `AiGauge` 를 쓰고 예전 세그먼트 · 단계 줄은 없다", () => {
    for (const rel of ["./HostForm.svelte", "./dialogs/DbPickerDialog.svelte", "./pane/AiPermMenu.svelte"]) {
      const s = src(rel);
      expect(s, rel).toContain("<AiGauge");
      expect(s, rel).not.toContain("ai-seg-btn");
      expect(s, rel).not.toContain('role="menuitemradio"');
    }
    // 고르는 규칙은 그대로 — 확인 상자는 부르는 쪽(폼 · 사본)에 남는다
    expect(src("./HostForm.svelte")).toContain("onpick={(s) => void pickAiStage(s)}");
    expect(src("./dialogs/DbPickerDialog.svelte")).toContain("onpick={(l) => void setConnAi(l)}");
    expect(src("./AiGauge.svelte")).not.toContain("confirmApproveAll");
  });

  it("고르개는 radiogroup · 단추마다 radio + aria-label · ←→ 만 받는다", () => {
    const g = src("./AiGauge.svelte");
    expect(g).toContain('role="radiogroup"');
    expect(g).toContain('role="radio"');
    expect(g).toContain(': nameOf(lv)}');
    // 잠긴 자리(10-23 로컬 타일) — 고를 수 없고 이름이 "(잠김)" 을 말한다
    expect(g).toContain("disabled={locked}");
    expect(g).toContain('aria-disabled={locked ? "true" : undefined}');
    expect(g).toContain('t("app.ai.gauge.locked"');
    expect(g).toContain("gaugeKeyStep(");
  });

  it("머리줄 칩 · 설정 › 보안 표는 미니 게이지를 단다", () => {
    // 원격 · 쿼리 · 로컬(10-23 — 예전 'AI 읽기' 칩) 셋 + 권한을 줄 수 없는 타일의 흐린 Off 칩 하나
    const chips = src("./pane/HeaderChips.svelte");
    expect(chips.match(/<AiGaugeMini /g)?.length).toBe(4);
    // 10-23 사용자 결정 — 끔이어도 칩이 선다(빈 게이지 + Off · 흐린 색). 숨기는 길은 설정의 'ai' 칩 하나
    expect(chips).not.toContain('aiStage !== "off"');
    expect(chips).not.toContain("dbAi.shown");
    expect(chips).toContain("--c: var(--chip-ai-off);");
    expect(src("./theme.css")).toContain("--chip-ai-off: var(--ai-lv0);");
    // 10-23 사용자 결정 — 로컬 AI CLI 타일에는 AI 읽기 권한이 아예 없다: 칩 없음 · 팝오버 안 열림 · 판정이 늘 끔 · 켜진 값은 끈다
    expect(chips).toContain('{:else if pane.kind === "local" && !localAiTile(pane)}');
    expect(src("./pane/local-ai-menu.svelte.ts")).toContain('box.pane.kind === "local" && !localAiTile(box.pane)');
    expect(src("./app/delegation.svelte.ts")).toContain("return isShared(pane.id) && !localAiTile(pane);");
    const term = src("./Terminal.svelte");
    expect(term).toContain("if (localAiTile(pane) && isShared(pane.id)) setShared(pane.id, false);");
    expect(term).toContain("plan.aiRead && !localAiTile(pane)");
    // ⋯ 메뉴의 항목 판정은 타일 메뉴 컨트롤러(2026-10-26 PaneHost 에서 뗌)
    expect(src("./pane/tile-menu-controller.svelte.ts")).toContain("aiTile: localAiTile(menuBox.pane),");
    // 별칭 없는 원격 · 목록에 없는 DB 연결 — 팝오버가 없으니 흐린 Off 칩이 ⋯ 메뉴와 같은 이유를 말한다
    expect(chips).toContain("data-ai-chip-disabled");
    expect(chips).toContain('t("app.ai.adhoc")');
    expect(chips).toContain('t("pane.menu.dbaiperm.missing")');
    expect(src("./settings/DelegationHostsView.svelte")).toContain("<AiGaugeMini ");
    expect(src("./settings/DbAiTargetsView.svelte")).toContain("<AiGaugeMini ");
    // 설정 › 터미널 "타일 머리줄 칩" 의 AI 권한 칩 미리 보기도 진짜 칩과 같은 꼴(옛 단계 그림이 아니라)
    const chipsSetting = src("./settings/HeaderChipsSetting.svelte");
    expect(chipsSetting).toContain("<AiGaugeMini ");
    expect(chipsSetting).toContain("data-ai-tone=");
  });

  it("단계 그림 표는 걷혔다 — 단계는 게이지(칩 · 미니 게이지 · 메뉴 글리프)가 말한다", () => {
    expect(src("./delegation.ts")).not.toContain("AI_STAGE_ICON");
    expect(src("./db-ai.ts")).not.toContain("DB_AI_ICON");
    expect(src("./browser/HostList.svelte")).toContain("gaugeIconName(");
  });

  it("모두 승인 색은 실패색이 아니라 주황(`--ai-lv4`) — 칩 토큰도 그 별칭", () => {
    const css = src("./theme.css");
    expect(css).toContain("--chip-ai-all: var(--ai-lv4);");
    expect(css).not.toMatch(/--chip-ai-all:[^;]*--err/);
    expect(css).toContain("--chip-ai-auto: var(--ai-lv3);");
  });
});
