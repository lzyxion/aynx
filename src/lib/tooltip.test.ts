import { describe, expect, it } from "vitest";
import {
  placeBeside,
  placeTooltip,
  tooltipSegments,
  TOOLTIP_GAP,
  TOOLTIP_MARGIN,
  type TooltipSegment,
} from "$lib/tooltip";

/** 읽기 좋은 비교용 — `[["text","a"],["kbd","Ctrl+N"]]` 꼴로 편다 */
const flat = (segs: TooltipSegment[]): [string, string][] =>
  segs.map((s): [string, string] => [s.kind, s.value]);

describe("tooltipSegments — 칩이 되는 것", () => {
  it("괄호 안의 조합을 칩으로 뽑고 괄호는 버린다", () => {
    expect(flat(tooltipSegments("새 탭 (Ctrl+Shift+N)"))).toEqual([
      ["text", "새 탭 "],
      ["kbd", "Ctrl+Shift+N"],
    ]);
  });

  it("낱말이 둘인 조합(체인)은 칩도 둘이고 사이에 공백이 남는다", () => {
    expect(flat(tooltipSegments("(Ctrl+B d) 로 떼기"))).toEqual([
      ["kbd", "Ctrl+B"],
      ["text", " "],
      ["kbd", "d"],
      ["text", " 로 떼기"],
    ]);
  });

  it("한국어 키 이름도 받는다", () => {
    expect(flat(tooltipSegments("동시 입력에서 제외 (Ctrl+클릭)"))).toEqual([
      ["text", "동시 입력에서 제외 "],
      ["kbd", "Ctrl+클릭"],
    ]);
    expect(flat(tooltipSegments("(Alt+Shift+화살표)"))).toEqual([["kbd", "Alt+Shift+화살표"]]);
  });

  it("구두점·기능 키도 끝자리가 된다", () => {
    expect(flat(tooltipSegments("설정 (Ctrl+,)"))).toEqual([
      ["text", "설정 "],
      ["kbd", "Ctrl+,"],
    ]);
    expect(flat(tooltipSegments("(Ctrl+F12)"))).toEqual([["kbd", "Ctrl+F12"]]);
  });

  it("혼자 서는 키 이름은 수식 키가 없어도 칩이다 — 한 줄 안에서 결이 갈리지 않게", () => {
    // 파일 브라우저 도구줄이 실제로 이렇게 적혀 있다 (`(Backspace)` 옆에 `(Shift+Backspace)`)
    expect(flat(tooltipSegments("뒤로 (Backspace)"))).toEqual([
      ["text", "뒤로 "],
      ["kbd", "Backspace"],
    ]);
    expect(flat(tooltipSegments("닫기 (Esc)"))).toEqual([
      ["text", "닫기 "],
      ["kbd", "Esc"],
    ]);
    expect(flat(tooltipSegments("(F5)"))).toEqual([["kbd", "F5"]]);
  });

  it("한 줄에 조합이 둘이면 둘 다 칩이 된다", () => {
    expect(flat(tooltipSegments("찾기 (Ctrl+F) · 전체 찾기 (Ctrl+Shift+F)"))).toEqual([
      ["text", "찾기 "],
      ["kbd", "Ctrl+F"],
      ["text", " · 전체 찾기 "],
      ["kbd", "Ctrl+Shift+F"],
    ]);
  });
});

describe("tooltipSegments — 글자로 남겨야 하는 것", () => {
  it("평범한 괄호는 건드리지 않는다", () => {
    for (const text of [
      "(선택) deploy",
      "(선택) ~/.ssh/id_ed25519",
      "기본 (켬 · 상속)",
      "이번만 수락 (기록하지 않음)",
      "크기 고정 (지금 배치에선 잠자는 중)",
    ]) {
      expect(flat(tooltipSegments(text))).toEqual([["text", text]]);
    }
  });

  it("괄호 안에 조합이 섞인 **문장**은 통째로 글자다", () => {
    const text = "동시 입력에 포함됨 (타일 메뉴 · Ctrl+클릭으로 제외)";
    expect(flat(tooltipSegments(text))).toEqual([["text", text]]);
  });

  it("혼자 서지 못하는 끝자리는 수식 키가 없으면 글자다 — 애매하면 글자", () => {
    expect(flat(tooltipSegments("(위)"))).toEqual([["text", "(위)"]]);
    expect(flat(tooltipSegments("(a)"))).toEqual([["text", "(a)"]]);
    expect(flat(tooltipSegments("(클릭)"))).toEqual([["text", "(클릭)"]]);
    // 경로·문장은 한 낱말이어도 키 이름이 아니다
    expect(flat(tooltipSegments("설정 파일 열기 (~/.ssh/config)"))).toEqual([
      ["text", "설정 파일 열기 (~/.ssh/config)"],
    ]);
  });

  it("`·` 로 나뉜 한국어 문구는 그대로 살아 있다", () => {
    const text = "창 > 탭 > 타일 > 세션 · 호스트 · 파일 · 레이아웃";
    expect(flat(tooltipSegments(text))).toEqual([["text", text]]);
  });

  it("빈 글자는 조각이 없다", () => {
    expect(tooltipSegments("")).toEqual([]);
  });
});

describe("tooltipSegments — 여러 줄", () => {
  it("줄바꿈은 글자 조각 안에 그대로 남는다 (`white-space: pre-line` 이 접는다)", () => {
    const text = "web-01 · db-01 — 타일 2개\n더블클릭하면 이름 변경 · 우클릭하면 메뉴";
    expect(flat(tooltipSegments(text))).toEqual([["text", text]]);
  });

  it("괄호 판정은 줄을 넘지 않는다", () => {
    expect(flat(tooltipSegments("(Ctrl+Shift+N\n)"))).toEqual([["text", "(Ctrl+Shift+N\n)"]]);
  });

  it("줄이 나뉘어도 각 줄의 조합은 칩이 된다", () => {
    expect(flat(tooltipSegments("타일 닫기 (Ctrl+Shift+W)\n잠긴 타일은 막힙니다"))).toEqual([
      ["text", "타일 닫기 "],
      ["kbd", "Ctrl+Shift+W"],
      ["text", "\n잠긴 타일은 막힙니다"],
    ]);
  });
});

describe("placeTooltip", () => {
  const viewport = { width: 1000, height: 800 };
  const bubble = { width: 200, height: 40 };

  it("기본은 아래·가운데 (간격 8px)", () => {
    const anchor = { left: 400, top: 100, width: 100, height: 20 };
    expect(placeTooltip(anchor, bubble, viewport)).toEqual({
      left: 400 + 50 - 100,
      top: 100 + 20 + TOOLTIP_GAP,
      above: false,
    });
  });

  it("아래가 모자라면 위로 뒤집는다", () => {
    const anchor = { left: 400, top: 740, width: 100, height: 20 };
    expect(placeTooltip(anchor, bubble, viewport)).toEqual({
      left: 350,
      top: 740 - TOOLTIP_GAP - 40,
      above: true,
    });
  });

  it("prefer above — 위가 기본", () => {
    const anchor = { left: 400, top: 100, width: 100, height: 20 };
    expect(placeTooltip(anchor, bubble, viewport, "above")).toEqual({
      left: 350,
      top: 100 - TOOLTIP_GAP - 40,
      above: true,
    });
  });

  it("prefer above — 위가 모자라면 아래로", () => {
    const anchor = { left: 400, top: 20, width: 100, height: 20 };
    expect(placeTooltip(anchor, bubble, viewport, "above").above).toBe(false);
  });

  it("아래가 딱 맞으면 뒤집지 않는다 (경계)", () => {
    // top + height + gap + bubble.height === viewport.height - margin
    const anchor = { left: 400, top: 800 - TOOLTIP_MARGIN - 40 - TOOLTIP_GAP - 20, width: 100, height: 20 };
    expect(placeTooltip(anchor, bubble, viewport).above).toBe(false);
  });

  it("왼쪽 가장자리에서는 여백까지만 민다", () => {
    const anchor = { left: 0, top: 100, width: 24, height: 24 };
    expect(placeTooltip(anchor, bubble, viewport).left).toBe(TOOLTIP_MARGIN);
  });

  it("오른쪽 가장자리에서도 여백까지만 민다", () => {
    const anchor = { left: 976, top: 100, width: 24, height: 24 };
    expect(placeTooltip(anchor, bubble, viewport).left).toBe(1000 - TOOLTIP_MARGIN - 200);
  });

  it("말풍선이 화면보다 넓으면 왼쪽 여백에 붙인다 (음수로 나가지 않는다)", () => {
    const anchor = { left: 100, top: 100, width: 20, height: 20 };
    const wide = { width: 1200, height: 40 };
    expect(placeTooltip(anchor, wide, viewport).left).toBe(TOOLTIP_MARGIN);
  });

  it("위아래 둘 다 모자라면 아래를 고른 뒤 화면 안으로 민다", () => {
    const small = { width: 400, height: 120 };
    const anchor = { left: 100, top: 40, width: 20, height: 20 };
    const tall = { width: 200, height: 200 };
    const p = placeTooltip(anchor, tall, small);
    expect(p.above).toBe(false);
    expect(p.top).toBe(TOOLTIP_MARGIN);
  });
});

describe("placeBeside", () => {
  const viewport = { width: 1000, height: 800 };
  const card = { width: 300, height: 100 };

  it("왼쪽 기둥 — 오른쪽에 서고 세로는 가운데", () => {
    const anchor = { left: 4, top: 600, width: 32, height: 40 };
    expect(placeBeside(anchor, card, viewport, "right")).toEqual({
      left: 36 + TOOLTIP_GAP,
      top: 620 - 50,
      above: false,
    });
  });

  it("오른쪽 기둥 — 왼쪽에 선다", () => {
    const anchor = { left: 964, top: 300, width: 32, height: 40 };
    expect(placeBeside(anchor, card, viewport, "left").left).toBe(964 - TOOLTIP_GAP - 300);
  });

  it("정한 쪽이 모자라면 뒤집는다", () => {
    const anchor = { left: 900, top: 300, width: 32, height: 40 };
    expect(placeBeside(anchor, card, viewport, "right").left).toBe(900 - TOOLTIP_GAP - 300);
    const nearLeft = { left: 20, top: 300, width: 32, height: 40 };
    expect(placeBeside(nearLeft, card, viewport, "left").left).toBe(52 + TOOLTIP_GAP);
  });

  it("세로는 화면 안으로 민다 (아래 끝 · 위 끝)", () => {
    const low = { left: 4, top: 780, width: 32, height: 20 };
    expect(placeBeside(low, card, viewport, "right").top).toBe(800 - TOOLTIP_MARGIN - 100);
    const high = { left: 4, top: 0, width: 32, height: 20 };
    expect(placeBeside(high, card, viewport, "right").top).toBe(TOOLTIP_MARGIN);
  });
});

describe("tooltipSegments — 접은 조합 (Ctrl+Shift+H/J/K)", () => {
  it("수식 키 + / 로 이은 끝 키는 칩 하나", () => {
    expect(flat(tooltipSegments("독 (Ctrl+Shift+H/J/K)"))).toEqual([
      ["text", "독 "],
      ["kbd", "Ctrl+Shift+H/J/K"],
    ]);
  });

  it("무리가 갈리면 칩도 갈린다", () => {
    expect(flat(tooltipSegments("독 (Ctrl+Shift+H/K Alt+J)"))).toEqual([
      ["text", "독 "],
      ["kbd", "Ctrl+Shift+H/K"],
      ["text", " "],
      ["kbd", "Alt+J"],
    ]);
  });

  it("수식 키 없는 (a/b) · 빈 조각 · 키가 아닌 조각은 글자로 남는다", () => {
    for (const t of ["보기 (a/b)", "보기 (H/J/K)", "보기 (Ctrl+H//K)", "보기 (Ctrl+H/)", "보기 (Ctrl+H/foo)"]) {
      expect(flat(tooltipSegments(t))).toEqual([["text", t]]);
    }
  });

  it("Ctrl+/ 는 여전히 키 하나다", () => {
    expect(flat(tooltipSegments("주석 (Ctrl+/)"))).toEqual([
      ["text", "주석 "],
      ["kbd", "Ctrl+/"],
    ]);
  });
});
