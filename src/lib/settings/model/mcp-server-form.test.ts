import { describe, expect, it } from "vitest";
import type { AiMcpServer } from "./schema";
import {
  buildServer,
  cannotSubmitServer,
  putServer,
  sameScopeNames,
  scopeIds,
  secretDrafts,
  secretRefs,
  secretVaultKey,
  serverSummary,
  sideChatFields,
  sortForDisplay,
  toggleAgentIn,
  toggleSideChat,
} from "./mcp-server-form";

/**
 * 설정 › MCP 의 **외부 MCP 서버 요약 · 추가/편집 하위 화면** 순수 부분 (docs/log/2026-10-05-mcp-subview.md) —
 * 옛 모달의 인라인 계산을 그대로 옮긴 것이라, 모양(참조만 · 1차 호환 · 볼트 이름 꼴)이 바뀌지 않았음을 못 박는다.
 */

const stdio = (over: Partial<AiMcpServer> = {}): AiMcpServer => ({
  name: "pg",
  enabled: true,
  transport: "stdio",
  command: "npx",
  args: ["-y", "pg-mcp"],
  ...over,
});

const form = (over: Partial<Parameters<typeof buildServer>[0]> = {}): Parameters<typeof buildServer>[0] => ({
  name: " pg ",
  enabled: true,
  agents: ["claude"],
  projectId: "",
  transport: "stdio",
  command: " npx ",
  args: ["-y"],
  url: "",
  secrets: [],
  ...over,
});

describe("비밀 칸", () => {
  it("편집을 열면 값은 늘 빈 칸이고 참조만 남는다", () => {
    expect(secretDrafts([{ name: "DB", secret_ref: "r1" }])).toEqual([{ name: "DB", secret_ref: "r1", value: "", changed: false }]);
    expect(secretDrafts(undefined)).toEqual([]);
  });

  it("목록에는 이름(다듬음)과 참조만 — 아직 볼트에 안 간 줄은 pending, 값은 싣지 않는다", () => {
    const refs = secretRefs([
      { name: " DB ", value: "secret", changed: true },
      { name: "K", value: "", secret_ref: "r2", changed: false },
    ]);
    expect(refs).toEqual([{ name: "DB", secret_ref: "pending" }, { name: "K", secret_ref: "r2" }]);
    expect(JSON.stringify(refs)).not.toContain("secret\"");
  });

  it("볼트 이름 꼴 — 범위|global / 서버 / [header:]이름", () => {
    expect(secretVaultKey("", "pg", "stdio", " DB ")).toBe("global/pg/DB");
    expect(secretVaultKey("P1", "api", "http", "Authorization")).toBe("P1/api/header:Authorization");
  });
});

describe("buildServer", () => {
  it("stdio — 다듬고 env 참조, url/headers 없음", () => {
    const s = buildServer(form({ secrets: [{ name: "DB", value: "x", changed: true }] }), null, false);
    expect(s).toEqual({ name: "pg", enabled: true, agents: ["claude"], transport: "stdio", command: "npx", args: ["-y"], env: [{ name: "DB", secret_ref: "pending" }] });
  });

  it("http — url 과 headers, 프로젝트 범위", () => {
    const s = buildServer(form({ transport: "http", url: " https://x/mcp ", projectId: "P1" }), null, false);
    expect(s).toEqual({ name: "pg", enabled: true, agents: ["claude"], project_id: "P1", transport: "http", url: "https://x/mcp", headers: [] });
  });

  it("사이드 채팅 — 켤 때만 적고, 묻지 않기는 사이드 채팅이 켜졌을 때만 남는다", () => {
    expect(buildServer(form(), null, false)).not.toHaveProperty("side_chat");
    expect(buildServer(form({ sideChat: true }), null, false)).toMatchObject({ side_chat: true });
    expect(buildServer(form({ sideChat: true }), null, false)).not.toHaveProperty("side_chat_no_ask");
    expect(buildServer(form({ sideChat: true, sideChatNoAsk: true }), null, false)).toMatchObject({ side_chat: true, side_chat_no_ask: true });
    expect(buildServer(form({ sideChat: false, sideChatNoAsk: true }), null, false)).not.toHaveProperty("side_chat_no_ask");
    expect(sideChatFields(undefined, true)).toEqual({});
  });

  it("목록의 사이드 채팅 칩 — 켜고 끄기, 끄면 묻지 않기도 걷는다", () => {
    const on = toggleSideChat(stdio());
    expect(on).toEqual({ ...stdio(), side_chat: true });
    const noAsk = { ...on, side_chat_no_ask: true };
    expect(toggleSideChat(noAsk)).toEqual(stdio());
  });

  it("대상 칩을 안 건드린 옛 항목은 agents 생략을 보존한다", () => {
    const legacy = stdio();
    expect(buildServer(form({ agents: ["claude", "codex"] }), legacy, false).agents).toBeUndefined();
    expect(buildServer(form({ agents: ["codex"] }), legacy, true).agents).toEqual(["codex"]);
  });
});

describe("검사 · 미리 보기", () => {
  const base = { busy: false, name: "pg", transport: "stdio" as const, command: "npx", url: "", secretCount: 0, storeSecrets: false };
  it("빈 이름 · 빈 명령/URL · 동의 없는 비밀 · 검사 중이면 흐리다", () => {
    expect(cannotSubmitServer(base)).toBe(false);
    expect(cannotSubmitServer({ ...base, name: " " })).toBe(true);
    expect(cannotSubmitServer({ ...base, command: "" })).toBe(true);
    expect(cannotSubmitServer({ ...base, transport: "http" })).toBe(true);
    expect(cannotSubmitServer({ ...base, transport: "http", url: "https://x" })).toBe(false);
    expect(cannotSubmitServer({ ...base, secretCount: 1 })).toBe(true);
    expect(cannotSubmitServer({ ...base, secretCount: 1, storeSecrets: true })).toBe(false);
    expect(cannotSubmitServer({ ...base, busy: true })).toBe(true);
  });

  it("요약 줄은 명령 · 인자를 그대로 잇는다", () => {
    expect(serverSummary(stdio())).toBe("npx -y pg-mcp");
    expect(serverSummary(stdio({ transport: "http", url: "https://x" }))).toBe("https://x");
  });

  it("칩 켜고 끄기", () => {
    expect(toggleAgentIn(["claude"], "codex")).toEqual(["claude", "codex"]);
    expect(toggleAgentIn(["claude", "codex"], "claude")).toEqual(["codex"]);
  });
});

describe("목록", () => {
  const list = [stdio({ name: "b", project_id: "P2" }), stdio({ name: "a" }), stdio({ name: "c", project_id: "P1" }), stdio({ name: "d" })];
  const label = (id: string) => ({ P1: "Zeta", P2: "Alpha" })[id] ?? id;

  it("앱 전체 먼저(저장 순서), 그다음 범위 이름순 — index 는 저장 자리", () => {
    expect(sortForDisplay(list, label).map((v) => [v.server.name, v.index])).toEqual([["a", 1], ["d", 3], ["b", 0], ["c", 2]]);
  });

  it("범위 후보 — 로컬 프로젝트 + 목록에만 남은 id, 중복 없이", () => {
    expect(scopeIds(["P1", "P3"], list)).toEqual(["P1", "P3", "P2"]);
  });

  it("이름 중복은 같은 범위에서만, 고치는 항목 자신은 빼고", () => {
    expect(sameScopeNames(list, null, "")).toEqual(["a", "d"]);
    expect(sameScopeNames(list, 1, "")).toEqual(["d"]);
    expect(sameScopeNames(list, null, "P1")).toEqual(["c"]);
  });

  it("넣기 — 추가는 끝, 편집은 제자리, 넣은 자리를 돌려준다", () => {
    const added = putServer(list, null, stdio({ name: "e" }));
    expect(added.index).toBe(4);
    expect(added.list[4].name).toBe("e");
    expect(list).toHaveLength(4);
    const edited = putServer(list, 2, stdio({ name: "c2" }));
    expect(edited.index).toBe(2);
    expect(edited.list.map((s) => s.name)).toEqual(["b", "a", "c2", "d"]);
  });
});
