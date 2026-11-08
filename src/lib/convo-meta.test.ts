import { describe, expect, it } from "vitest";
import { convoMetaChips } from "$lib/convo-meta";

const base = { cwd: "C:\\src\\proj-wt\\feat-a", branch: "feat-a", model: "claude-opus-5-5", forkedFrom: null };
const input = { mixed: false, tokens: "182k 토큰", forkedLabel: "↳ 갈라짐" };

describe("convoMetaChips — 지난 대화 줄의 아래 칩", () => {
  it("순서 = 브랜치 · 모델 · 사용량 (· 갈라짐)", () => {
    expect(convoMetaChips(base, input).map((c) => c.kind)).toEqual(["branch", "model", "tokens"]);
    expect(convoMetaChips({ ...base, forkedFrom: "x" }, input).map((c) => c.kind)).toEqual([
      "branch",
      "model",
      "tokens",
      "forked",
    ]);
  });

  it("섞어 보는 범위의 폴더 칩은 브랜치와 다를 때만 맨 앞에", () => {
    expect(convoMetaChips(base, { ...input, mixed: true }).map((c) => c.kind)).toEqual(["branch", "model", "tokens"]);
    expect(convoMetaChips({ ...base, branch: "feat/b" }, { ...input, mixed: true })).toEqual([
      { kind: "folder", text: "feat-a" },
      { kind: "branch", text: "feat/b" },
      { kind: "model", text: "claude-opus-5-5" },
      { kind: "tokens", text: "182k 토큰" },
    ]);
    expect(convoMetaChips({ ...base, branch: null }, { ...input, mixed: true })[0]).toEqual({ kind: "folder", text: "feat-a" });
  });

  it("모르는 값은 칩을 세우지 않는다", () => {
    expect(convoMetaChips({ ...base, branch: " ", model: null }, { ...input, tokens: null })).toEqual([]);
  });
});
