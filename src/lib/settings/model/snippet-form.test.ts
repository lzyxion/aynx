import { describe, expect, it } from "vitest";
import { MAX_SNIPPET_COMMAND, MAX_SNIPPET_DESCRIPTION, MAX_SNIPPET_NAME, type Snippet } from "$lib/snippets";
import {
  canSaveSnippetForm,
  emptySnippetForm,
  formToSnippet,
  previewSnippet,
  scopeAliasOptions,
  scopeOfAlias,
  snippetFormProblems,
  snippetToForm,
  type SnippetForm,
} from "./snippet-form";

/**
 * 설정 › 스니펫 **추가 · 편집 하위 화면**의 순수 부분 (docs/log/2026-10-05-snippets-subview.md) —
 * 폼 ↔ 스니펫 · 검증 · 범위 후보 · 미리보기.
 */

const form = (over: Partial<SnippetForm> = {}): SnippetForm => ({ ...emptySnippetForm(), ...over });

describe("폼 ↔ 스니펫", () => {
  it("빈 폼은 모든 호스트 · 바로 실행으로 시작한다", () => {
    expect(emptySnippetForm()).toEqual({ name: "", command: "", description: "", alias: "", enter: true });
  });

  it("스니펫 → 폼 → 값 은 제자리다", () => {
    const s: Snippet = {
      id: "S1",
      name: "nginx",
      command: "systemctl status {{svc=nginx}}",
      description: "상태",
      scope: { kind: "host", alias: "web-01" },
      enter: false,
    };
    const f = snippetToForm(s);
    expect(f).toEqual({ name: "nginx", command: s.command, description: "상태", alias: "web-01", enter: false });
    const { name, command, description, scope, enter } = s;
    expect(formToSnippet(f)).toEqual({ name, command, description, scope, enter });
  });

  it("설명이 없는 스니펫은 빈 칸, 전역 범위는 빈 select 값", () => {
    const f = snippetToForm({ id: "S", name: "a", command: "b", scope: { kind: "all" }, enter: true });
    expect(f.description).toBe("");
    expect(f.alias).toBe("");
  });

  it("앞뒤 공백을 떼고 상한에서 자른다", () => {
    const out = formToSnippet(
      form({
        name: `  ${"n".repeat(MAX_SNIPPET_NAME + 5)}  `,
        command: ` ${"c".repeat(MAX_SNIPPET_COMMAND + 5)} `,
        description: ` ${"d".repeat(MAX_SNIPPET_DESCRIPTION + 5)} `,
      }),
    );
    expect(out.name).toHaveLength(MAX_SNIPPET_NAME);
    expect(out.command).toHaveLength(MAX_SNIPPET_COMMAND);
    expect(out.description).toHaveLength(MAX_SNIPPET_DESCRIPTION);
  });

  it("범위 — 빈 값은 모든 호스트, 아니면 그 별칭", () => {
    expect(scopeOfAlias("")).toEqual({ kind: "all" });
    expect(scopeOfAlias("  ")).toEqual({ kind: "all" });
    expect(scopeOfAlias("web-01")).toEqual({ kind: "host", alias: "web-01" });
  });
});

describe("검증", () => {
  it("이름 · 명령이 비면 저장할 수 없다 (공백만도 빈 것)", () => {
    expect(snippetFormProblems(form())).toEqual(["name-empty", "command-empty"]);
    expect(snippetFormProblems(form({ name: " ", command: "ls" }))).toEqual(["name-empty"]);
    expect(snippetFormProblems(form({ name: "a", command: "\n " }))).toEqual(["command-empty"]);
    expect(canSaveSnippetForm(form({ name: "a", command: "ls" }))).toBe(true);
  });

  it("설명은 비어도 된다", () => {
    expect(canSaveSnippetForm(form({ name: "a", command: "ls", description: "" }))).toBe(true);
  });
});

describe("범위 후보", () => {
  it("가나다순 · 중복 없음 · 빈 이름 빠짐", () => {
    expect(scopeAliasOptions(["web-02", "db", "web-02", ""], "")).toEqual(["db", "web-02"]);
  });

  it("목록에 없는 지금 별칭도 후보에 남는다 (열기만 해서 범위가 바뀌지 않게)", () => {
    expect(scopeAliasOptions(["db"], "gone")).toEqual(["db", "gone"]);
    expect(scopeAliasOptions([], "gone")).toEqual(["gone"]);
  });
});

describe("미리보기", () => {
  it("자리표시자가 없으면 명령 그대로", () => {
    const p = previewSnippet("uptime");
    expect(p.fields).toEqual([]);
    expect(p.annotated).toBe(false);
    expect(p.text).toBe("uptime");
  });

  it("기본값으로 채워지고, 없는 칸은 빈 글자", () => {
    const p = previewSnippet("tail -n {{n=100}} {{file}}");
    expect(p.fields.map((f) => f.name)).toEqual(["n", "file"]);
    expect(p.annotated).toBe(true);
    expect(p.values).toEqual({ n: "100" });
    expect(p.text).toBe("tail -n 100 ");
  });

  it("시험 삼아 적은 값이 기본값을 이긴다 — 지운 것(빈 값)도 그대로", () => {
    expect(previewSnippet("tail -n {{n=100}} {{file}}", { n: "5", file: "/var/log/x" }).text).toBe(
      "tail -n 5 /var/log/x",
    );
    expect(previewSnippet("tail -n {{n=100}}", { n: "" }).text).toBe("tail -n ");
  });

  it("같은 이름은 한 칸 · 모든 자리에 들어간다", () => {
    const p = previewSnippet("{{h}} && ping {{ h }}", { h: "web" });
    expect(p.fields).toHaveLength(1);
    expect(p.text).toBe("web && ping web");
  });

  it("지금 명령에 없는 칸의 값은 버린다", () => {
    expect(previewSnippet("echo {{a}}", { a: "1", gone: "2" }).values).toEqual({ a: "1" });
  });

  it("설명만 달린 칸도 annotated", () => {
    expect(previewSnippet("echo {{a|무엇}}").annotated).toBe(true);
  });
});
