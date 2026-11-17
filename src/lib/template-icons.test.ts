import { describe, expect, it } from "vitest";
import { leafLogo, logoKey, type LogoEnv } from "$lib/template-icons";
import { templateCells } from "$lib/tab-templates";
import type { SavedLeaf, SavedNode } from "$lib/tabs";

const env: LogoEnv = {
  hostOf: (alias) =>
    alias === "dev-01" ? { icon: "svg:ubuntu", color: null } : alias === "plain" ? { icon: null, color: "#f00" } : null,
  engineIconOf: (id) => (id === "pg" ? "svg:postgres" : null),
};

const row = (a: SavedNode, b: SavedNode): SavedNode => ({ dir: "row", ratio: 0.5, a, b });

describe("잎 → 그림", () => {
  it("로컬 셸은 셸 종류 로고 · 모르면 터미널", () => {
    expect(leafLogo({ kind: "local", shell: "pwsh" }, env)).toEqual({ type: "host", icon: "svg:powershell", fallback: "none", color: null });
    expect(leafLogo({ kind: "local", shell: "gitbash" }, env)).toMatchObject({ icon: "svg:bash" });
    expect(leafLogo({ kind: "local", shell: "wsl:Ubuntu-24.04" }, env)).toMatchObject({ icon: "svg:ubuntu" });
    expect(leafLogo({ kind: "local" }, env)).toMatchObject({ icon: "svg:terminal" });
  });

  it("AI 는 그 CLI 로고 — 로컬 · 원격 모두, 모르는 CLI 는 셸 · 호스트 그림", () => {
    expect(leafLogo({ kind: "local", shell: "pwsh", autorun: "claude" }, env)).toEqual({ type: "ai", name: "claude" });
    expect(leafLogo({ kind: "ssh", alias: "dev-01", autorun: "codex --x" }, env)).toEqual({ type: "ai", name: "codex" });
    expect(leafLogo({ kind: "local", shell: "cmd", autorun: "aider" }, env)).toMatchObject({ icon: "svg:windows" });
  });

  it("SSH · SFTP 는 그 호스트 아이콘(색 포함) · 모르는 별칭은 서버 랙", () => {
    expect(leafLogo({ kind: "ssh", alias: "dev-01" }, env)).toEqual({ type: "host", icon: "svg:ubuntu", fallback: "server", color: null });
    expect(leafLogo({ kind: "sftp", alias: "plain" }, env)).toEqual({ type: "host", icon: null, fallback: "server", color: "#f00" });
    expect(leafLogo({ kind: "ssh", alias: "nope" }, env)).toEqual({ type: "host", icon: null, fallback: "server", color: null });
  });

  it("DB 는 엔진 로고 · 모르면 DB 그림, 나머지는 UI 아이콘", () => {
    expect(leafLogo({ kind: "query", query: { connId: "pg" } } as SavedLeaf, env)).toMatchObject({ icon: "svg:postgres" });
    expect(leafLogo({ kind: "query", query: { connId: "gone" } } as SavedLeaf, env)).toEqual({ type: "ui", name: "database" });
    expect(leafLogo({ kind: "localfs" }, env)).toEqual({ type: "host", icon: null, fallback: "folder", color: null });
    expect(leafLogo({ kind: "doc" }, env)).toEqual({ type: "ui", name: "file-text" });
    expect(leafLogo({ kind: "image" }, env)).toEqual({ type: "ui", name: "image" });
    expect(leafLogo({ kind: "branches" }, env)).toEqual({ type: "ui", name: "git-branch" });
    expect(leafLogo({ kind: "diff" }, env)).toEqual({ type: "ui", name: "git-compare" });
  });

  it("그림 키 — 같은 그림이면 같은 키", () => {
    expect(logoKey({ type: "ai", name: "claude" })).not.toBe(logoKey({ type: "ui", name: "claude" }));
    expect(logoKey(leafLogo({ kind: "ssh", alias: "nope" }, env))).toBe(logoKey(leafLogo({ kind: "sftp", alias: "x" }, env)));
  });
});

describe("배치 그림의 칸", () => {
  it("칸마다 그 잎이 실린다 — 읽는 순서(왼쪽 · 위 먼저)", () => {
    const root = row({ kind: "local", autorun: "claude" }, { dir: "col", ratio: 0.5, a: { kind: "ssh", alias: "dev-01" }, b: { kind: "query", query: { connId: "pg" } } as SavedLeaf });
    const cells = templateCells(root);
    expect(cells.map((c) => logoKey(leafLogo(c.leaf, env)))).toEqual(["ai:claude", "host:svg:ubuntu:", "host:svg:postgres:"]);
    expect(cells.map((c) => c.chip)).toEqual(["ai", "ssh", "db"]);
  });
});describe("배치 그림의 칸", () => {
  it("칸마다 그 잎이 실린다 — 읽는 순서(왼쪽 · 위 먼저)", () => {
    const root = row({ kind: "local", autorun: "claude" }, { dir: "col", ratio: 0.5, a: { kind: "ssh", alias: "dev-01" }, b: { kind: "query", query: { connId: "pg" } } as SavedLeaf });
    const cells = templateCells(root);
    expect(cells.map((c) => logoKey(leafLogo(c.leaf, env)))).toEqual(["ai:claude", "host:svg:ubuntu:", "host:svg:postgres:"]);
    expect(cells.map((c) => c.chip)).toEqual(["ai", "ssh", "db"]);
  });
});
