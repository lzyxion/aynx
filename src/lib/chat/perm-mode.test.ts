import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string, a?: Record<string, unknown>) => `${key}${a ? JSON.stringify(a) : ""}` }));

import { PERM_AUTO_ICON, PERM_MANUAL_ICON, PERM_MODE_WORD, allowKeyLabel, permChipTitle, policyResultKey } from "$lib/chat/perm-mode";
import { emptyLive, foldAll, foldLive, pendingPermissions, policyResolved, seedLive } from "$lib/side-chat-live";
import { isSideChatEvent, type SideChatSnapshot } from "$lib/side-chat-api";

describe("사이드 채팅 권한 모드 칩 (2026-11-20)", () => {
  it("모드 낱말은 번역하지 않고 그림은 상수 하나", () => {
    expect(PERM_MODE_WORD).toEqual({ manual: "Manual", auto: "Auto" });
    expect(PERM_MANUAL_ICON).toBe("shield-check");
    expect(PERM_AUTO_ICON).toBe("zap");
  });

  it("허용 목록 열쇠 → 사람 말 · MCP 는 서버 이름 · 모르는 열쇠는 그대로", () => {
    const tr = (k: string, a?: Record<string, string | number>) => `${k}${a ? JSON.stringify(a) : ""}`;
    expect(allowKeyLabel("fileChange", tr)).toBe("app.chatDock.permMode.kind.fileChange");
    expect(allowKeyLabel("outsideRead", tr)).toBe("app.chatDock.permMode.kind.outsideRead");
    expect(allowKeyLabel("command", tr)).toBe("app.chatDock.permMode.kind.command");
    expect(allowKeyLabel("mcp:tavily", tr)).toBe('app.chatDock.permMode.kind.mcp{"name":"tavily"}');
    expect(allowKeyLabel("weird", tr)).toBe("weird");
  });

  it("칩 title 은 지금 모드를 풀어 적는다", () => {
    const tr = (k: string, a?: Record<string, string | number>) => `${k}${a ? JSON.stringify(a) : ""}`;
    expect(permChipTitle("auto", 3, tr)).toBe("app.chatDock.permMode.title.auto");
    expect(permChipTitle("manual", 0, tr)).toBe("app.chatDock.permMode.title.manual");
    expect(permChipTitle("manual", 2, tr)).toBe('app.chatDock.permMode.title.manualAllow{"n":2}');
  });

  it("대신 답한 줄의 글자는 auto · remembered 만", () => {
    expect(policyResultKey("auto")).toBe("app.chatDock.perm.byAuto");
    expect(policyResultKey("remembered")).toBe("app.chatDock.perm.byRemembered");
    expect(policyResultKey("human")).toBeNull();
    expect(policyResolved("auto") && policyResolved("remembered") && !policyResolved("human") && !policyResolved(null)).toBe(true);
  });
});

describe("꼬리 접기 — 대신 허용한 요청 · 모드 사건", () => {
  it("permissionAuto 는 끝난 카드 하나(기다림 없음) · 뒤따르는 permissionResolved 는 같은 결과", () => {
    const s = foldAll(emptyLive("running"), [
      { t: "permissionAuto", requestId: "r1", kind: "fileChange", title: "a.ts", toolName: "fileChange", by: "auto" },
      { t: "permissionResolved", requestId: "r1", decision: "allow", by: "auto" },
    ]);
    expect(pendingPermissions(s)).toEqual([]);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ kind: "permission", requestId: "r1", resolved: { decision: "allow", by: "auto" } });
  });

  it("기다리던 카드가 Auto 로 풀리면 그 카드의 결과가 auto", () => {
    const s = foldAll(emptyLive("running"), [
      { t: "permission", requestId: "r2", kind: "command", title: "rm x", detail: "", toolName: "commandExecution" },
      { t: "permissionResolved", requestId: "r2", decision: "allow", by: "auto" },
    ]);
    expect(pendingPermissions(s)).toEqual([]);
    expect(s.entries[0]).toMatchObject({ resolved: { by: "auto" } });
  });

  it("permPolicy · 스냅숏이 모드 · 목록을 맞춘다(옛 서버 = Manual)", () => {
    expect(emptyLive().perm).toEqual({ mode: "manual", allow: [] });
    const s = foldLive(emptyLive(), { t: "permPolicy", mode: "auto", allow: ["mcp:x"] });
    expect(s.perm).toEqual({ mode: "auto", allow: ["mcp:x"] });
    const snap: SideChatSnapshot = {
      links: [], chat: "c", cli: "claude", model: "", effort: null, epoch: 0, leaseEpoch: 1, seq: 0, status: "stopped",
      conversationId: null, liveTurn: [], pending: [],
    };
    expect(seedLive(snap).perm).toEqual({ mode: "manual", allow: [] });
    expect(seedLive({ ...snap, permMode: "auto", permAllow: ["command"] }).perm).toEqual({ mode: "auto", allow: ["command"] });
  });

  it("통로가 새 사건 꼬리표를 받는다", () => {
    const env = (ev: unknown) => ({ windows: ["main"], chat: "c", epoch: 1, seq: 1, ev });
    expect(isSideChatEvent(env({ t: "permissionAuto", requestId: "r", kind: "tool", title: "", toolName: "Read", by: "remembered" }))).toBe(true);
    expect(isSideChatEvent(env({ t: "permPolicy", mode: "manual", allow: [] }))).toBe(true);
  });
});
