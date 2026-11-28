import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "$lib/context";
import { filesAfter, rewindQuote, rewindScopes, rewindable, scopeHasConversation, scopeHasFiles, userTurnsFrom } from "./chat-tile-rewind";

const A = "30b5bc5c-33b6-47d1-802c-c06d0d28a93a";
const B = "01a21d10-b57d-73b3-b3c6-f273fd0ffb1f";

const user = (text: string, anchor?: string | null): TranscriptItem => ({ role: "user", text, truncated: false, images: 0, tool: null, at: null, ...(anchor !== undefined ? { anchor } : {}) });
const said = (text: string): TranscriptItem => ({ role: "assistant", text, truncated: false, images: 0, tool: null, at: null });
const tool = (name: string, input: string | null): TranscriptItem => ({
  role: "tool",
  text: null,
  truncated: false,
  images: 0,
  tool: { name, summary: "", input, inputTruncated: false, output: null, outputTruncated: false, error: false },
  at: null,
});

describe("rewindScopes — 앞이 기본", () => {
  it("캡 없음 → 정적 범위(Claude 파일 · 대화 · Codex 대화)", () => {
    expect(rewindScopes("claude", null)).toEqual(["both", "conversation", "files"]);
    expect(rewindScopes("codex", null)).toEqual(["conversation"]);
  });

  it("Claude — 둘 다 → both 먼저 · 파일 캡 없음 → 대화만 · 대화 캡 없음 → 파일만 · 둘 다 거짓 → []", () => {
    expect(rewindScopes("claude", { files: true, conversation: true })).toEqual(["both", "conversation", "files"]);
    expect(rewindScopes("claude", { files: false, conversation: true })).toEqual(["conversation"]);
    expect(rewindScopes("claude", { files: true, conversation: false })).toEqual(["files"]);
    expect(rewindScopes("claude", { files: false, conversation: false })).toEqual([]);
  });

  it("Codex — 대화만 · 파일 캡을 알려도 파일 · both 는 없다", () => {
    expect(rewindScopes("codex", { files: false, conversation: true })).toEqual(["conversation"]);
    expect(rewindScopes("codex", { files: true, conversation: true })).toEqual(["conversation"]);
    expect(rewindScopes("codex", { files: false, conversation: false })).toEqual([]);
  });

  it("범위가 건드리는 것", () => {
    expect([scopeHasFiles("files"), scopeHasFiles("both"), scopeHasFiles("conversation")]).toEqual([true, true, false]);
    expect([scopeHasConversation("files"), scopeHasConversation("both"), scopeHasConversation("conversation")]).toEqual([false, true, true]);
  });
});

describe("rewindable", () => {
  it("사람 줄 · anchor 있음 · 범위가 있을 때만", () => {
    expect(rewindable(user("x", A), ["files"])).toBe(true);
    expect(rewindable(user("x"), ["files"])).toBe(false);
    expect(rewindable(user("x", null), ["files"])).toBe(false);
    expect(rewindable(user("x", ""), ["files"])).toBe(false);
    expect(rewindable(user("x", A), [])).toBe(false);
    expect(rewindable({ ...said("x"), anchor: A }, ["conversation"])).toBe(false);
  });
});

describe("rewindQuote", () => {
  it("첫 글 줄 · 빈칸 하나로 · 80자에서 말줄임 · null 은 빈 글", () => {
    expect(rewindQuote("\n  첫  줄 \n둘째 줄")).toBe("첫 줄");
    expect(rewindQuote(null)).toBe("");
    const long = "가".repeat(100);
    const q = rewindQuote(long);
    expect([...q].length).toBe(80);
    expect(q.endsWith("…")).toBe(true);
    expect(rewindQuote("가".repeat(80))).toBe("가".repeat(80));
  });
});

describe("filesAfter · userTurnsFrom — 받은 쪽에서 센다", () => {
  const items: TranscriptItem[] = [
    user("처음", B),
    tool("Edit", JSON.stringify({ file_path: "C:/p/before.ts", old_string: "a", new_string: "b" }, null, 2)),
    user("이것부터", A),
    tool("Edit", JSON.stringify({ file_path: "C:/p/a.ts", old_string: "a", new_string: "b" }, null, 2)),
    tool("Write", '{\n  "file_path": "C:/p/new.md",\n  "content": "잘린 내용…'),
    tool("MultiEdit", JSON.stringify({ file_path: "C:/p/a.ts", edits: [] })),
    tool("apply_patch", "*** Begin Patch\n*** Update File: src/x.rs\n@@\n-a\n+b\n*** Add File: src/y.rs\n+y\n*** Delete File: old.txt\n*** End Patch"),
    tool("apply_patch", JSON.stringify({ input: "*** Begin Patch\n*** Update File: src/z.rs\n*** Move to: src/z2.rs\n*** End Patch" })),
    tool("fileChange", JSON.stringify({ changes: [{ path: "web/i.ts", kind: "add" }] })),
    tool("shell", JSON.stringify({ command: ["rm", "gone.txt"] })),
    tool("Read", JSON.stringify({ file_path: "C:/p/read.ts" })),
    said("끝"),
    user("다음"),
  ];

  it("편집 도구 입력의 경로만 · 기준점 앞은 뺌 · 겹침 없음 · 잘린 JSON 도", () => {
    expect(filesAfter(items, A)).toEqual(["C:/p/a.ts", "C:/p/new.md", "src/x.rs", "src/y.rs", "old.txt", "src/z.rs", "src/z2.rs", "web/i.ts"]);
    expect(filesAfter(items, B)?.[0]).toBe("C:/p/before.ts");
  });

  it("최대 20 · 기준점 없음 → null", () => {
    const many = [user("x", A), ...Array.from({ length: 30 }, (_, i) => tool("Write", JSON.stringify({ file_path: `f${i}.txt`, content: "" })))];
    expect(filesAfter(many, A)).toHaveLength(20);
    expect(filesAfter(items, "a3bb189e-8bf9-3888-9912-ace4e6543002")).toBeNull();
    expect(filesAfter(items, "")).toBeNull();
  });

  it("userTurnsFrom — 기준점 줄과 그 뒤 사람 줄 수 · 없으면 null", () => {
    expect(userTurnsFrom(items, A)).toBe(2);
    expect(userTurnsFrom(items, B)).toBe(3);
    expect(userTurnsFrom(items, "nope")).toBeNull();
  });
});

describe("값 import 가 없다", () => {
  it("import 는 모두 type", () => {
    const src = readFileSync(new URL("./chat-tile-rewind.ts", import.meta.url), "utf8");
    const imports = [...src.matchAll(/^import .*$/gm)].map((m) => m[0]);
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^import type /);
  });
});
