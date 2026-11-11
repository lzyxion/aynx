import { describe, expect, it } from "vitest";
import { choiceFromDialog, closeAfterSave, unsavedVerdict } from "./unsaved-guard";

const dirty = (ids: string[]) => (id: string) => ids.includes(id);

describe("unsavedVerdict — 저장 안 한 글을 잃게 하는 조작인가", () => {
  it("저장 안 한 타일이 없으면 어떤 조작이든 free", () => {
    for (const action of ["close", "move-window", "replace"] as const) {
      expect(unsavedVerdict(action, ["p1", "p2"], dirty([]))).toEqual({ kind: "free" });
      expect(unsavedVerdict(action, [], dirty(["p1"]))).toEqual({ kind: "free" });
    }
  });

  it("닫기는 묻는다 — 저장 안 한 타일만 추려서", () => {
    expect(unsavedVerdict("close", ["p1", "p2", "p3"], dirty(["p2", "p3"]))).toEqual({
      kind: "ask",
      paneIds: ["p2", "p3"],
    });
  });

  it("창 넘기기 · 갈아 끼우기는 거절한다", () => {
    expect(unsavedVerdict("move-window", ["p1", "p2"], dirty(["p1"]))).toEqual({
      kind: "refuse",
      paneIds: ["p1"],
    });
    expect(unsavedVerdict("replace", ["p9"], dirty(["p9"]))).toEqual({ kind: "refuse", paneIds: ["p9"] });
  });

  it("창 넘기기는 초안을 실을 수 있으면 싣는다 — 하나라도 못 실으면 못 실은 것만 들고 거절", () => {
    const carry = (ids: string[]) => (id: string) => ids.includes(id);
    expect(unsavedVerdict("move-window", ["p1", "p2", "p3"], dirty(["p1", "p2"]), carry(["p1", "p2"]))).toEqual({
      kind: "carry",
      paneIds: ["p1", "p2"],
    });
    expect(unsavedVerdict("move-window", ["p1", "p2"], dirty(["p1", "p2"]), carry(["p1"]))).toEqual({
      kind: "refuse",
      paneIds: ["p2"],
    });
    // 저장 안 한 것이 없으면 물어보지도 않는다
    expect(unsavedVerdict("move-window", ["p1"], dirty([]), () => false)).toEqual({ kind: "free" });
  });

  it("갈아 끼우기 · 닫기는 실을 수 있어도 예전 규칙 그대로", () => {
    expect(unsavedVerdict("replace", ["p9"], dirty(["p9"]), () => true)).toEqual({ kind: "refuse", paneIds: ["p9"] });
    expect(unsavedVerdict("close", ["p9"], dirty(["p9"]), () => true)).toEqual({ kind: "ask", paneIds: ["p9"] });
  });

  it("같은 id 가 두 번 와도 한 번만 센다(파일 N개 숫자)", () => {
    expect(unsavedVerdict("close", ["p1", "p1"], dirty(["p1"]))).toEqual({ kind: "ask", paneIds: ["p1"] });
  });
});

describe("choiceFromDialog — 네이티브 대화의 값 → 답", () => {
  const labels = { save: "저장하고 닫기", discard: "버리고 닫기" };
  it("기본 이름과 라벨 그대로를 모두 받는다", () => {
    expect(choiceFromDialog("Yes", labels)).toBe("save");
    expect(choiceFromDialog("저장하고 닫기", labels)).toBe("save");
    expect(choiceFromDialog("No", labels)).toBe("discard");
    expect(choiceFromDialog("버리고 닫기", labels)).toBe("discard");
  });
  it("취소 · 모르는 값 · 없음은 취소", () => {
    expect(choiceFromDialog("Cancel", labels)).toBe("cancel");
    expect(choiceFromDialog("취소", labels)).toBe("cancel");
    expect(choiceFromDialog("Ok", labels)).toBe("cancel");
    expect(choiceFromDialog(null, labels)).toBe("cancel");
    expect(choiceFromDialog(undefined, labels)).toBe("cancel");
  });
});

describe("closeAfterSave — 하나라도 저장 실패면 닫지 않는다", () => {
  it("전부 성공일 때만 닫는다", () => {
    expect(closeAfterSave([true, true])).toBe(true);
    expect(closeAfterSave([true, false])).toBe(false);
    expect(closeAfterSave([false])).toBe(false);
  });
});
