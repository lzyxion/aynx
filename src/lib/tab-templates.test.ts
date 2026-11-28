import { describe, expect, it } from "vitest";
import {
  MAX_TEMPLATES,
  TAB_TEMPLATE_VERSION,
  chipCounts,
  cleanTemplateName,
  findByName,
  firstAiLeaf,
  hasRelativeFolders,
  leafChip,
  parseTemplates,
  rebaseTemplate,
  relativizeFolder,
  replaceMissing,
  resolveFolder,
  resolveTemplate,
  serializeTemplates,
  templateCells,
  templateFromTree,
  templateLeaves,
  templatesForProject,
  withoutProjectTemplates,
  withTemplate,
  withoutTemplate,
  withFirstAi,
  type TabTemplate,
} from "$lib/tab-templates";
import { freshAgentAutorun } from "$lib/agent-sessions";
import { leafOf, newChatTilePane, newLocalPane, newProjectStartPane, newQueryPane, newRunPane, newSshPane, type PaneNode } from "$lib/session";
import type { SavedNode } from "$lib/tabs";

const split = (dir: "row" | "col", a: PaneNode, b: PaneNode, ratio = 0.5): PaneNode => ({ type: "split", dir, ratio, a, b });

describe("폴더 상대화 · 풀기", () => {
  it("로컬은 구분자 · 대소문자를 가리지 않고 프로젝트 폴더 아래만 상대로", () => {
    expect(relativizeFolder("C:\\work\\aynx", "C:\\work\\aynx", true)).toBe(".");
    expect(relativizeFolder("c:/Work/aynx/src/lib", "C:\\work\\aynx\\", true)).toBe("./src/lib");
    expect(relativizeFolder("C:\\work\\aynx-other", "C:\\work\\aynx", true)).toBeNull();
    expect(relativizeFolder("D:\\x", "C:\\work\\aynx", true)).toBeNull();
  });

  it("원격은 대소문자를 가린다", () => {
    expect(relativizeFolder("/home/u/proj/api", "/home/u/proj", false)).toBe("./api");
    expect(relativizeFolder("/home/u/Proj/api", "/home/u/proj", false)).toBeNull();
  });

  it("푼다 — 기준 폴더의 구분자로 잇는다 · 상대가 아니면 그대로", () => {
    expect(resolveFolder(".", "C:\\wt\\feat")).toBe("C:\\wt\\feat");
    expect(resolveFolder("./src/lib", "C:\\wt\\feat")).toBe("C:\\wt\\feat\\src\\lib");
    expect(resolveFolder("./api", "/srv/app/")).toBe("/srv/app/api");
    expect(resolveFolder("C:\\abs", "C:\\wt")).toBe("C:\\abs");
  });
});

describe("살아 있는 트리 → 템플릿 트리", () => {
  function sampleTree(): PaneNode {
    const ai = newLocalPane("pwsh");
    ai.autorun = "claude --resume 0f8fad5b-d9cb-469f-a165-70867728950e --model opus";
    ai.cwd = "C:\\work\\aynx";
    ai.injectMcpToken = true;
    ai.agentLink = { agent: "claude", id: "0f8fad5b-d9cb-469f-a165-70867728950e" };
    ai.tileKey = "tile-1";
    const shell = newLocalPane();
    shell.lastCwd = "C:\\work\\aynx\\src";
    const ssh = newSshPane("web-01", 5000);
    ssh.tmux = "aynx-3";
    const q = newQueryPane({ connId: "conn1", sql: "select 1" });
    return split("row", leafOf(ai), split("col", leafOf(shell), split("row", leafOf(ssh), leafOf(q))), 0.6);
  }

  it("세션 고유 값을 지우고 AI 는 새 대화 줄로 · 폴더는 상대로", () => {
    const { root, skipped } = templateFromTree(sampleTree(), { folder: "C:\\work\\aynx", remote: null });
    expect(skipped).toBe(0);
    expect(root).not.toBeNull();
    const leaves = templateLeaves(root as SavedNode);
    expect(leaves).toHaveLength(4);
    const [ai, shell, ssh, q] = leaves;
    expect(ai).toEqual({ kind: "local", shell: "pwsh", autorun: "claude --model opus", cwd: ".", injectMcpToken: true });
    expect(shell).toEqual({ kind: "local", cwd: "./src" });
    expect(ssh.kind).toBe("ssh");
    expect(ssh.alias).toBe("web-01");
    expect(ssh.tmux).toBeUndefined();
    expect(ssh.scrollback).toBeUndefined();
    expect(ssh.historyStreamId).toBeUndefined();
    expect(q).toEqual({ kind: "query", query: { connId: "conn1" } });
  });

  it("붙이지 않으면 경로 그대로", () => {
    const { root } = templateFromTree(sampleTree(), null);
    expect(templateLeaves(root as SavedNode)[0].cwd).toBe("C:\\work\\aynx");
  });

  it("시작 화면 · 오케스트레이션 타일은 빼고 센다 — 남는 것이 없으면 null", () => {
    const tree = split("row", leafOf(newProjectStartPane("p1", "C:\\w")), split("col", leafOf(newRunPane("r1")), leafOf(newLocalPane())));
    const out = templateFromTree(tree, null);
    expect(out.skipped).toBe(2);
    expect(out.root).toEqual({ kind: "local" });
    expect(templateFromTree(leafOf(newProjectStartPane("p1", "C:\\w")), null)).toEqual({ root: null, skipped: 1 });
  });

  it("원격 프로젝트는 그 호스트의 SSH 타일 폴더만 상대로", () => {
    const a = newSshPane("dev-01");
    a.cwd = "/home/u/proj/api";
    a.autorun = "codex";
    const b = newSshPane("other");
    b.cwd = "/home/u/proj";
    const { root } = templateFromTree(split("row", leafOf(a), leafOf(b)), { folder: "/home/u/proj", remote: "dev-01" });
    const [x, y] = templateLeaves(root as SavedNode);
    expect(x.cwd).toBe("./api");
    expect(x.autorun).toBe("codex");
    expect(y.cwd).toBe("/home/u/proj");
  });
});

describe("열 때", () => {
  const tpl: SavedNode = {
    dir: "row",
    ratio: 0.5,
    a: { kind: "local", autorun: "claude", cwd: "." },
    b: { kind: "localfs", path: "./docs" },
  };

  it("상대 폴더를 기준에 붙여 푼다 — 기준이 없으면 칸을 지운다", () => {
    expect(hasRelativeFolders(tpl)).toBe(true);
    const r = templateLeaves(resolveTemplate(tpl, { folder: "C:\\wt\\x", remote: null }));
    expect(r[0].cwd).toBe("C:\\wt\\x");
    expect(r[1].path).toBe("C:\\wt\\x\\docs");
    const none = templateLeaves(resolveTemplate(tpl, null));
    expect(none[0].cwd).toBeUndefined();
    expect(none[1].path).toBeUndefined();
  });

  it("사라진 대상은 빈 타일 — 이름은 한 번씩", () => {
    const tree: SavedNode = {
      dir: "row",
      ratio: 0.5,
      a: { kind: "ssh", alias: "gone" },
      b: { dir: "col", ratio: 0.5, a: { kind: "ssh", alias: "gone" }, b: { kind: "ssh", alias: "web" } },
    };
    const out = replaceMissing(tree, (l) => (l.alias === "gone" ? "gone" : null));
    expect(out.missing).toEqual(["gone"]);
    expect(templateLeaves(out.root).map((l) => l.kind)).toEqual(["start", "start", "ssh"]);
  });
});

describe("프로젝트 옮기기 — rebaseTemplate", () => {
  const P = { folder: "C:\\work\\aynx", remote: null };
  const Q = { folder: "D:\\proj\\q", remote: null };
  const abs: SavedNode = {
    dir: "row",
    ratio: 0.5,
    a: { kind: "local", autorun: "claude", cwd: "C:\\work\\aynx" },
    b: {
      dir: "col",
      ratio: 0.5,
      a: { kind: "localfs", path: "C:\\work\\aynx\\docs" },
      b: { kind: "local", cwd: "E:\\other" },
    },
  };

  it("없음 → P 는 P 기준으로 상대화 · 기준 밖은 절대 그대로 · P → 없음은 다시 절대로(왕복)", () => {
    const onP = rebaseTemplate(abs, null, P);
    expect(templateLeaves(onP).map((l) => l.cwd ?? l.path)).toEqual([".", "./docs", "E:\\other"]);
    expect(templateLeaves(onP)[0].autorun).toBe("claude");
    const back = rebaseTemplate(onP, P, null);
    expect(back).toEqual(abs);
    expect(hasRelativeFolders(back)).toBe(false);
  });

  it("P → Q — P 기준 상대는 P 폴더로 풀려 Q 밖이면 절대로 · Q 안의 절대 경로는 Q 기준 상대로", () => {
    const onP: SavedNode = {
      dir: "row",
      ratio: 0.5,
      a: { kind: "local", cwd: "./src" },
      b: { kind: "local", cwd: "D:\\proj\\q\\api" },
    };
    const onQ = rebaseTemplate(onP, P, Q);
    expect(templateLeaves(onQ).map((l) => l.cwd)).toEqual(["C:\\work\\aynx\\src", "./api"]);
  });

  it("원격 프로젝트 — 그 호스트의 SSH 타일만 상대화 · 다른 호스트 · 로컬 타일은 그대로", () => {
    const R = { folder: "/home/u/proj", remote: "dev-01" };
    const tree: SavedNode = {
      dir: "row",
      ratio: 0.5,
      a: { kind: "ssh", alias: "dev-01", cwd: "/home/u/proj/api" },
      b: {
        dir: "col",
        ratio: 0.5,
        a: { kind: "ssh", alias: "other", cwd: "/home/u/proj" },
        b: { kind: "local", cwd: "C:\\work\\aynx" },
      },
    };
    const onR = rebaseTemplate(tree, null, R);
    expect(templateLeaves(onR).map((l) => l.cwd)).toEqual(["./api", "/home/u/proj", "C:\\work\\aynx"]);
    // 원격 → 로컬 P: 원격 SSH 타일의 상대는 원격 폴더로 풀리고 P 를 따르지 않는다 · 로컬 셸은 P 기준 상대로
    const onP = rebaseTemplate(onR, R, P);
    expect(templateLeaves(onP).map((l) => l.cwd)).toEqual(["/home/u/proj/api", "/home/u/proj", "."]);
  });
});

describe("미리보기 · 요약", () => {
  const tree: SavedNode = {
    dir: "row",
    ratio: 0.25,
    a: { kind: "local", autorun: "claude" },
    b: { dir: "col", ratio: 0.5, a: { kind: "ssh", alias: "web" }, b: { kind: "query", query: { connId: "c" } } },
  };

  it("칸은 비율대로", () => {
    expect(templateCells(tree).map(({ leaf: _leaf, ...c }) => c)).toEqual([
      { x: 0, y: 0, w: 0.25, h: 1, chip: "ai" },
      { x: 0.25, y: 0, w: 0.75, h: 0.5, chip: "ssh" },
      { x: 0.25, y: 0.5, w: 0.75, h: 0.5, chip: "db" },
    ]);
  });

  it("칩 개수는 늘 같은 순서", () => {
    expect(chipCounts({ dir: "row", ratio: 0.5, a: tree, b: { kind: "local" } })).toEqual([
      { chip: "ai", n: 1 },
      { chip: "ssh", n: 1 },
      { chip: "shell", n: 1 },
      { chip: "db", n: 1 },
    ]);
    expect(leafChip({ kind: "ssh", alias: "x", autorun: "codex" })).toBe("ai");
  });
});

describe("목록 · 파일", () => {
  const mk = (id: string, name: string, projectId?: string): TabTemplate => ({
    id,
    name,
    ...(projectId ? { projectId } : {}),
    root: { kind: "local" },
    savedAt: 1,
  });

  it("이름 다듬기 · 같은 이름은 대소문자 무시", () => {
    expect(cleanTemplateName("  백엔드   작업 ")).toBe("백엔드 작업");
    const list = [mk("a", "Backend"), mk("b", "front")];
    expect(findByName(list, "backend")?.id).toBe("a");
    expect(findByName(list, "backend", "a")).toBeUndefined();
  });

  it("넣으면 맨 앞 · 같은 id 는 갈아 끼운다 · 상한", () => {
    let list = [mk("a", "A"), mk("b", "B")];
    list = withTemplate(list, mk("b", "B2"));
    expect(list.map((x) => x.name)).toEqual(["B2", "A"]);
    expect(withoutTemplate(list, "a").map((x) => x.id)).toEqual(["b"]);
    const many = Array.from({ length: MAX_TEMPLATES + 5 }, (_, i) => mk(`t${i}`, `n${i}`));
    expect(withTemplate(many, mk("new", "new"))).toHaveLength(MAX_TEMPLATES);
  });

  it("프로젝트에 붙인 것만", () => {
    expect(templatesForProject([mk("a", "A", "p1"), mk("b", "B"), mk("c", "C", "p1")], "p1").map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("프로젝트를 지우면 그 프로젝트 템플릿만 빠진다", () => {
    const list = [mk("a", "A", "p1"), mk("b", "B"), mk("c", "C", "p2"), mk("d", "D", "p1")];
    expect(withoutProjectTemplates(list, "p1").map((x) => x.id)).toEqual(["b", "c"]);
    expect(withoutProjectTemplates(list, "zz")).toHaveLength(4);
  });

  it("왕복 — 같은 목록은 같은 글자", () => {
    const list = [mk("a", "A", "p1"), mk("b", "B")];
    const json = JSON.stringify(serializeTemplates(list));
    expect(parseTemplates(json)).toEqual(list);
    expect(JSON.stringify(serializeTemplates(parseTemplates(json) ?? []))).toBe(json);
    expect(JSON.parse(json).version).toBe(TAB_TEMPLATE_VERSION);
  });

  it("없는 파일은 빈 목록 · 깨진 파일과 모르는 버전은 null(덮어쓰지 않게) · 틀린 항목만 버린다", () => {
    expect(parseTemplates(null)).toEqual([]);
    expect(parseTemplates("{")).toBeNull();
    expect(parseTemplates(JSON.stringify({ version: 99, templates: [] }))).toBeNull();
    const json = JSON.stringify({
      version: TAB_TEMPLATE_VERSION,
      templates: [
        { id: "ok", name: "좋음", root: { kind: "local" }, savedAt: 2 },
        { id: "bad", name: "모르는 종류", root: { kind: "hosts" }, savedAt: 2 },
        { id: "", name: "id 없음", root: { kind: "local" } },
        { id: "ok", name: "같은 id", root: { kind: "local" } },
      ],
    });
    expect(parseTemplates(json)?.map((x) => x.id)).toEqual(["ok"]);
  });
});

describe("freshAgentAutorun", () => {
  it("재개 줄을 새 대화 줄로 — 추가 인자는 남긴다", () => {
    expect(freshAgentAutorun("claude --resume 0f8fad5b-d9cb-469f-a165-70867728950e --model opus")).toBe("claude --model opus");
    expect(freshAgentAutorun("codex resume -m o3 0198b5e2-7c3a-7d4e-9f00-1234567890ab")).toBe("codex -m o3");
    expect(freshAgentAutorun("claude")).toBe("claude");
    expect(freshAgentAutorun("npm run dev")).toBe("npm run dev");
  });
});

describe("첫 AI 잎 — firstAiLeaf · withFirstAi", () => {
  const tree: SavedNode = {
    dir: "row",
    ratio: 0.5,
    a: { kind: "local", shell: "pwsh", cwd: "." },
    b: {
      dir: "col",
      ratio: 0.5,
      a: { kind: "local", autorun: "claude --model opus", cwd: "." },
      b: { kind: "local", autorun: "codex", cwd: "./api" },
    },
  };

  it("화면 순서로 첫 AI 잎 — 없으면 null", () => {
    expect(firstAiLeaf(tree)?.autorun).toBe("claude --model opus");
    expect(firstAiLeaf({ kind: "local", shell: "pwsh" })).toBeNull();
  });

  it("첫 AI 잎만 바꾼다 — 실행 줄 · 시작 폴더 · MCP 표식, 둘째 AI 잎과 셸은 그대로", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const out = withFirstAi(tree, { autorun: `codex resume ${id}`, cwd: "C:\\work\\other" });
    const leaves = templateLeaves(out);
    expect(leaves[0]).toEqual({ kind: "local", shell: "pwsh", cwd: "." });
    expect(leaves[1]).toEqual({ kind: "local", autorun: `codex resume ${id}`, cwd: "C:\\work\\other", injectMcpToken: true });
    expect(leaves[2]).toEqual({ kind: "local", autorun: "codex", cwd: "./api" });
    // 원본은 건드리지 않는다
    expect(templateLeaves(tree)[1]).toEqual({ kind: "local", autorun: "claude --model opus", cwd: "." });
  });

  it("폴더를 주지 않으면 잎의 폴더 그대로 · SSH 잎은 MCP 표식을 켜지 않는다", () => {
    const ssh: SavedNode = { kind: "ssh", alias: "web-01", autorun: "claude", cwd: "./api" };
    expect(withFirstAi(ssh, { autorun: "codex" })).toEqual({ kind: "ssh", alias: "web-01", autorun: "codex", cwd: "./api" });
  });

  it("AI 잎이 없으면 트리 그대로", () => {
    const plain: SavedNode = { kind: "query", query: { connId: "c1" } };
    expect(withFirstAi(plain, { autorun: "claude" })).toEqual(plain);
  });
});

describe("채팅 모양 AI 타일 — 템플릿에서 빠진다", () => {
  it("채팅 잎은 세지 않고 빼며 남는 것만 템플릿이 된다", () => {
    const chat = newChatTilePane({ chatId: "ct-0f8fad5b-d9cb-469f-a165-70867728950e", cli: "claude", model: "", effort: "", cwd: "C:\\w" });
    const out = templateFromTree(split("row", leafOf(chat), leafOf(newLocalPane())), null);
    expect(out.skipped).toBe(1);
    expect(out.root).toEqual({ kind: "local" });
  });
});
