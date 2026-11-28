import { describe, expect, it } from "vitest";
import { setComposerText, type ComposerField } from "./composer-text";

// 시험 환경에 DOM 이 없어(`environment: "node"`) 칸의 꼴만 흉내 낸다 — 사건 순서 · 값 · 커서를 본다
function fakeField(initial: string) {
  const log: string[] = [];
  const field: ComposerField & { sel: [number, number] | null; focused: boolean } = {
    value: initial,
    sel: null,
    focused: false,
    setSelectionRange(a, b) {
      log.push(`sel:${a}-${b}`);
      field.sel = [a, b];
    },
    dispatchEvent(ev) {
      log.push(`${ev.type}:${ev.bubbles}:${field.value}`);
      return true;
    },
    focus() {
      log.push("focus");
      field.focused = true;
    },
  };
  return { field, log };
}

describe("setComposerText", () => {
  it("값을 바꾸고 input 사건 하나 · 커서 끝 · 포커스", () => {
    const { field, log } = fakeField("/co");
    setComposerText(field, "/compact ");
    expect(field.value).toBe("/compact ");
    expect(log.filter((x) => x.startsWith("input:"))).toEqual(["input:true:/compact "]);
    expect(field.sel).toEqual([9, 9]);
    expect(field.focused).toBe(true);
    // 사건이 나갈 때 값은 이미 새 글이다 — `bind:value` 가 새 글을 읽는다
    expect(log[0]).toBe("input:true:/compact ");
  });

  it("빈 글도 같은 길", () => {
    const { field, log } = fakeField("/model");
    setComposerText(field, "");
    expect(field.value).toBe("");
    expect(log).toEqual(["input:true:", "sel:0-0", "focus"]);
  });
});
