import { describe, expect, it } from "vitest";
import { isClaudeTrustPrompt } from "./claude-trust";

/** 2.1.318 실측 화면 */
const MEASURED = [
  "",
  "────────────────────",
  " Accessing workspace:",
  "",
  " C:\\tmp\\empty",
  "",
  " Quick safety check: Is this a project you created or one you trust? (Like your own code, a",
  " well-known open source project, or work from your team). If not, take a moment to review what's in",
  " this folder first.",
  "",
  " Claude Code'll be able to read, edit, and execute files here.",
  "",
  " Security guide",
  "",
  " ❯ No, exit",
  "   Yes, I trust this folder",
  "",
  " Enter to confirm · Esc to cancel",
];

describe("isClaudeTrustPrompt", () => {
  it("실측 화면을 알아본다", () => {
    expect(isClaudeTrustPrompt(MEASURED)).toBe(true);
  });

  it("고른 표시가 Yes 쪽으로 옮겨도 · 순서가 바뀌어도 같다", () => {
    expect(isClaudeTrustPrompt(["   No, exit", " ❯ Yes, I trust this folder", " Enter to confirm · Esc to cancel"])).toBe(true);
    expect(isClaudeTrustPrompt([" ❯ Yes, I trust this folder", "   No, exit", " Enter to confirm · Esc to cancel"])).toBe(true);
  });

  it("예전 판의 문구도 받는다", () => {
    expect(isClaudeTrustPrompt([" ❯ Yes, proceed", "   No, exit", " Enter to confirm · Esc to cancel"])).toBe(true);
  });

  it("문장 안의 인용은 질문이 아니다", () => {
    expect(
      isClaudeTrustPrompt([
        "터미널에 ❯ No, exit 와 Yes, I trust this folder 가 뜹니다.",
        "Enter to confirm · Esc to cancel 도 보입니다.",
      ]),
    ).toBe(false);
  });

  it("세 줄 중 하나라도 없으면 질문이 아니다", () => {
    expect(isClaudeTrustPrompt([" ❯ No, exit", "   Yes, I trust this folder"])).toBe(false);
    expect(isClaudeTrustPrompt(["   Yes, I trust this folder", " Enter to confirm · Esc to cancel"])).toBe(false);
    expect(isClaudeTrustPrompt([" ❯ No, exit", " Enter to confirm · Esc to cancel"])).toBe(false);
  });

  it("두 선택지 사이가 벌어지면 질문이 아니다", () => {
    expect(isClaudeTrustPrompt(["No, exit", "다른 글", "Yes, I trust this folder", "Enter to confirm"])).toBe(false);
  });

  it("빈 화면 · 평범한 화면", () => {
    expect(isClaudeTrustPrompt([])).toBe(false);
    expect(isClaudeTrustPrompt(["╭─ Claude Code ─╮", "│ > │", "╰───────╯"])).toBe(false);
  });
});
