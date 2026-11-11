import { describe, expect, it } from "vitest";
import {
  codeForTerm,
  codeInsertBytes,
  isShellLang,
  planTermTarget,
  shellReadyForInsert,
  TERM_QUIET_MS,
  type TermTile,
} from "$lib/code-to-term";

const tile = (paneId: string, tabId: string, lastFocusedAt: number | null = null, extra: Partial<TermTile> = {}): TermTile => ({
  paneId,
  tabId,
  name: "PowerShell",
  host: null,
  code: paneId,
  tabTitle: `탭 ${tabId}`,
  tabIndex: 1,
  busy: false,
  lastFocusedAt,
  ...extra,
});

describe("isShellLang", () => {
  it("언어 없음 · 셸 계열은 참", () => {
    for (const l of [null, undefined, "", "  ", "sh", "bash", "zsh", "shell", "console", "powershell", "ps1", "pwsh", "cmd", "bat"]) {
      expect(isShellLang(l)).toBe(true);
    }
  });
  it("대소문자 · 뒤의 속성은 보지 않는다", () => {
    expect(isShellLang("Bash")).toBe(true);
    expect(isShellLang("PowerShell")).toBe(true);
    expect(isShellLang("bash title=install")).toBe(true);
  });
  it("그 밖의 언어는 거짓", () => {
    for (const l of ["python", "json", "ts", "rust", "yaml", "mermaid", "svg", "math", "shx"]) expect(isShellLang(l)).toBe(false);
  });
});

describe("codeForTerm", () => {
  it("줄 전체 주석 · 셔뱅 · 빈 줄을 뺀다", () => {
    expect(codeForTerm("# 의존성 받기\nnpm ci\n", "bash")).toBe("npm ci");
    expect(codeForTerm("#!/usr/bin/env bash\n\n  # 들여쓴 주석\nset -e\n   \nmake\n", null)).toBe("set -e\nmake");
    expect(codeForTerm("# a\r\nls\r\n", "powershell")).toBe("ls");
  });
  it("줄 안 주석 · 줄 안 # 는 그대로", () => {
    expect(codeForTerm("npm ci  # 설치", "sh")).toBe("npm ci  # 설치");
    expect(codeForTerm('echo $# "a#b" http://x/#frag', "bash")).toBe('echo $# "a#b" http://x/#frag');
  });
  it("남은 줄의 들여쓰기 · 순서는 그대로", () => {
    expect(codeForTerm("if true; then\n  # 설명\n    echo hi\nfi", "bash")).toBe("if true; then\n    echo hi\nfi");
  });
  it("cmd 계열 — REM(대소문자 무시 · 뒤가 공백이거나 끝) · :: 만 주석, # 는 아니다", () => {
    expect(codeForTerm("REM 빌드\n  rem\n:: 설명\nnmake\n", "cmd")).toBe("nmake");
    expect(codeForTerm("Rem x\nremove-thing\n# not\n", "bat")).toBe("remove-thing\n# not");
    expect(codeForTerm("REM x\ndir", "Batch")).toBe("dir");
    // cmd 가 아니면 REM 은 명령이다
    expect(codeForTerm("REM x\ndir", "bash")).toBe("REM x\ndir");
  });
  it("전부 주석 · 빈 줄이면 빈 글 — codeInsertBytes 가 empty", () => {
    expect(codeForTerm("# a\n\n  # b\n", "sh")).toBe("");
    expect(codeInsertBytes(codeForTerm("# a\n\n", "sh"), true)).toEqual({ ok: false, why: "empty" });
  });
  it("주석을 빼면 한 줄 — 괄호 붙여넣기가 꺼져 있어도 들어간다", () => {
    const code = "# 의존성 받기\nnpm ci\n";
    expect(codeInsertBytes(code, false)).toEqual({ ok: false, why: "multiline" });
    expect(codeInsertBytes(codeForTerm(code, "powershell"), false)).toEqual({ ok: true, bytes: "npm ci" });
  });
});

describe("codeInsertBytes", () => {
  it("한 줄 — 모드가 켜져 있으면 감싸고, 꺼져 있으면 글자 그대로 · 끝 줄바꿈은 뗀다", () => {
    expect(codeInsertBytes("npm run build\n", true)).toEqual({ ok: true, bytes: "\x1b[200~npm run build\x1b[201~" });
    expect(codeInsertBytes("npm run build\n", false)).toEqual({ ok: true, bytes: "npm run build" });
    expect(codeInsertBytes("ls\r\n\r\n  \n", false)).toEqual({ ok: true, bytes: "ls" });
  });
  it("여러 줄 — 모드가 켜져 있을 때만 · 줄바꿈은 \\r", () => {
    expect(codeInsertBytes("cd app\nnpm i\n", true)).toEqual({ ok: true, bytes: "\x1b[200~cd app\rnpm i\x1b[201~" });
    expect(codeInsertBytes("cd app\nnpm i\n", false)).toEqual({ ok: false, why: "multiline" });
  });
  it("가운데 빈 줄은 남는다", () => {
    expect(codeInsertBytes("a\n\nb", true)).toEqual({ ok: true, bytes: "\x1b[200~a\r\rb\x1b[201~" });
  });
  it("제어 문자 · ESC 를 걷는다 — 괄호 붙여넣기를 스스로 닫지 못한다", () => {
    expect(codeInsertBytes("echo hi\x1b[201~\x07", true)).toEqual({ ok: true, bytes: "\x1b[200~echo hi[201~\x1b[201~" });
    expect(codeInsertBytes("rm\u009b -rf", false)).toEqual({ ok: true, bytes: "rm -rf" });
  });
  it("프롬프트 글자는 그대로 둔다", () => {
    expect(codeInsertBytes("$ ls -la", false)).toEqual({ ok: true, bytes: "$ ls -la" });
  });
  it("빈 글은 넣지 않는다", () => {
    expect(codeInsertBytes("", true)).toEqual({ ok: false, why: "empty" });
    expect(codeInsertBytes("\n  \n", false)).toEqual({ ok: false, why: "empty" });
  });
});

describe("planTermTarget", () => {
  it("이 탭에 정확히 하나면 곧장 (다른 탭에 더 있어도)", () => {
    const plan = planTermTarget({ tiles: [tile("p1", "a"), tile("p2", "b", 99)], currentTabId: "a" });
    expect(plan).toEqual({ mode: "direct", tile: tile("p1", "a") });
  });

  it("이 탭에 여럿 — 이 탭 먼저(최근 포커스가 위) · 다른 탭 · 끝에 새 터미널 · 마지막 포커스가 골라짐", () => {
    const plan = planTermTarget({
      tiles: [tile("p1", "a", 10), tile("p2", "a", 30), tile("p3", "b", 50), tile("p4", "a", null)],
      currentTabId: "a",
    });
    if (plan.mode !== "pick") throw new Error("pick 이어야 한다");
    expect(plan.rows.map((r) => (r.kind === "tile" ? `${r.group}:${r.tile.paneId}` : "new"))).toEqual([
      "here:p2",
      "here:p1",
      "here:p4",
      "other:p3",
      "new",
    ]);
    expect(plan.selected).toBe(3);
    expect(plan.rows[3]).toMatchObject({ kind: "tile", last: true });
    expect(plan.hasTiles).toBe(true);
  });

  it("다른 탭에만 있음 — 상자, 포커스 기록이 없으면 첫 줄", () => {
    const plan = planTermTarget({ tiles: [tile("p3", "b"), tile("p5", "c")], currentTabId: "a" });
    if (plan.mode !== "pick") throw new Error("pick 이어야 한다");
    expect(plan.rows.map((r) => r.kind)).toEqual(["tile", "tile", "new"]);
    expect(plan.selected).toBe(0);
  });

  it("어디에도 없음 — 새 터미널 줄만", () => {
    expect(planTermTarget({ tiles: [], currentTabId: "a" })).toEqual({
      mode: "pick",
      rows: [{ kind: "new" }],
      selected: 0,
      hasTiles: false,
    });
  });
});

describe("shellReadyForInsert", () => {
  const base = { now: 10_000, attached: true, drawn: true, changedAt: 10_000 - TERM_QUIET_MS, busy: false };
  it("붙었고 · 그렸고 · 도는 명령 없이 · 조용해야 준비", () => {
    expect(shellReadyForInsert(base)).toBe(true);
    expect(shellReadyForInsert({ ...base, attached: false })).toBe(false);
    expect(shellReadyForInsert({ ...base, drawn: false })).toBe(false);
    expect(shellReadyForInsert({ ...base, busy: true })).toBe(false);
    expect(shellReadyForInsert({ ...base, changedAt: null })).toBe(false);
    expect(shellReadyForInsert({ ...base, changedAt: base.now - TERM_QUIET_MS + 1 })).toBe(false);
  });
});
