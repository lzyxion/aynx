import { describe, expect, it } from "vitest";
import { launchItems, openAliases, recentHostRows, recentProjectIds } from "./launch";

describe("새 탭 시트의 새 타일 칸", () => {
  it("기본 셸 · AI 마다 · 로컬 파일 순서 — 같은 AI 는 한 번", () => {
    const items = launchItems({
      shellId: "pwsh",
      shellName: "PowerShell",
      ai: [
        { id: "claude", command: "claude", name: "Claude Code" },
        { id: "codex", command: "codex", name: "Codex" },
        { id: "claude", command: "claude", name: "Claude Code" },
      ],
      filesName: "로컬 파일",
    });
    expect(items.map((i) => i.key)).toEqual(["shell", "ai:claude", "ai:codex", "localfs"]);
    expect(items[0]).toMatchObject({ kind: "shell", shellId: "pwsh", name: "PowerShell" });
    expect(items[1]).toMatchObject({ kind: "ai", command: "claude" });
  });

  it("AI 를 모두 끄면 셸 · 로컬 파일 둘 · 감지가 비면 셸 id 없음", () => {
    const items = launchItems({ shellId: null, shellName: "셸", ai: [], filesName: "파일" });
    expect(items.map((i) => i.kind)).toEqual(["shell", "localfs"]);
    expect(items[0]).toMatchObject({ shellId: null });
  });
});

describe("최근 줄", () => {
  it("열린 SSH 별칭 — 설정 호스트의 SSH 타일만(소문자 · 빠른 접속 뺌)", () => {
    const s = openAliases([
      { kind: "ssh", alias: "Dev-01" },
      { kind: "ssh", alias: "q@x", adhoc: { host: "x" } },
      { kind: "local" },
      { kind: "ssh", alias: "  " },
    ]);
    expect([...s]).toEqual(["dev-01"]);
  });

  it("최근 호스트 — 앞에서 세 줄 · 연결 점 · 시각", () => {
    const rows = recentHostRows(
      [{ name: "a" }, { name: "B" }, { name: "c" }, { name: "d" }],
      (n) => (n === "a" ? 100 : null),
      new Set(["b"]),
    );
    expect(rows).toEqual([
      { name: "a", connected: false, at: 100 },
      { name: "B", connected: true, at: null },
      { name: "c", connected: false, at: null },
    ]);
  });

  it("최근 프로젝트 — 프로젝트마다 한 번 · 늦은 순 · 지금 목록에 있는 것만", () => {
    const opens = [
      { projectId: "p1", at: 10 },
      { projectId: "p2", at: 30 },
      { projectId: "gone", at: 40 },
      { projectId: "p1", at: 20 },
      { projectId: "p3", at: 5 },
      { projectId: "p4", at: 1 },
    ];
    expect(recentProjectIds(opens, new Set(["p1", "p2", "p3", "p4"]))).toEqual([
      { id: "p2", at: 30 },
      { id: "p1", at: 20 },
      { id: "p3", at: 5 },
    ]);
    expect(recentProjectIds([], new Set(["p1"]))).toEqual([]);
  });
});
