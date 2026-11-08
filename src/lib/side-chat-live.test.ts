import { describe, expect, it } from "vitest";
import {
  addSent,
  clearEnded,
  emptyLive,
  entryItem,
  foldAll,
  foldLive,
  historyHold,
  liveBusy,
  markSendFailed,
  pendingPermissions,
  seedLive,
  setSentLink,
  type LiveEntry,
  type LiveState,
} from "$lib/side-chat-live";
import type { SideChatEv, SideChatSnapshot } from "$lib/side-chat-api";
import { liveCut } from "$lib/transcript";
import { sentMatches } from "$lib/pane/ai-flip-keys";
import type { TranscriptItem } from "$lib/context";

/**
 * 사이드 채팅 v2 4단계 — 사건 → 꼬리 접기(순수). 턴 하나의 흐름 · 조각 모으기 · 도구 · 권한 · 끝(끊김은 실패가 아님) · 알림 · 종료 ·
 * 스냅숏 다시 세우기 · 기록 받은 뒤 걷기 · 겹침 자르기.
 */

const CONV = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

const ready: SideChatEv = { t: "ready", cli: "claude", version: "2.1.309", model: "sonnet", models: ["default", "opus", "sonnet"], efforts: { "": ["low", "high"], sonnet: ["low", "high"] }, conversationId: CONV };

function kinds(s: LiveState): string[] {
  return s.entries.map((e) => e.kind);
}

function only<K extends LiveEntry["kind"]>(s: LiveState, kind: K): Extract<LiveEntry, { kind: K }>[] {
  return s.entries.filter((e): e is Extract<LiveEntry, { kind: K }> => e.kind === kind);
}

function snap(over: Partial<SideChatSnapshot> = {}): SideChatSnapshot {
  return {
    link: null,
    chat: "c1",
    cli: "claude",
    model: "sonnet",
    effort: null,
    epoch: 1,
    leaseEpoch: 1,
    seq: 0,
    status: "ready",
    conversationId: CONV,
    liveTurn: [],
    pending: [],
    ...over,
  };
}

describe("foldLive — 턴 하나", () => {
  it("준비 → 보냄 → 받음 → 글 조각이 한 항목으로 모이고 끝 덩어리가 갈음한다 → 잘 끝남(알림 없음)", () => {
    let s = foldLive(emptyLive(), ready);
    expect(s.status).toBe("ready");
    expect(s.ready?.models).toEqual(["default", "opus", "sonnet"]);
    expect(s.ready?.efforts.sonnet).toEqual(["low", "high"]);
    expect(s.effort).toBeNull();
    expect(foldLive(s, { t: "effortChanged", effort: "high" }).effort).toBe("high");
    expect(seedLive(snap({ effort: "low" })).effort).toBe("low");
    expect(s.model).toBe("sonnet");
    expect(s.conversationId).toBe(CONV);
    s = addSent(s, "안녕", "c1");
    expect(only(s, "user")[0]).toMatchObject({ text: "안녕", accepted: false, failed: false });
    s = foldAll(s, [
      { t: "turnStarted", turn: null },
      { t: "userAccepted", clientId: "c1" },
      { t: "textDelta", item: "m1", text: "안" },
      { t: "textDelta", item: "m1", text: "녕하" },
      { t: "textDelta", item: "m1", text: "세요" },
    ]);
    expect(liveBusy(s)).toBe(true);
    expect(only(s, "user")[0].accepted).toBe(true);
    expect(kinds(s)).toEqual(["user", "text"]);
    expect(only(s, "text")[0]).toMatchObject({ text: "안녕하세요", done: false });
    s = foldLive(s, { t: "text", item: "m1", text: "안녕하세요!" });
    expect(only(s, "text")).toHaveLength(1);
    expect(only(s, "text")[0]).toMatchObject({ text: "안녕하세요!", done: true });
    const before = s.ended;
    s = foldLive(s, { t: "turnEnded", turn: null, outcome: "ok", message: null });
    expect(s.status).toBe("ready");
    expect(s.ended).toBe(before + 1);
    expect(kinds(s)).toEqual(["user", "text"]);
  });

  it("다른 item 의 조각 · 도구 뒤의 조각은 새 항목", () => {
    const s = foldAll(foldLive(emptyLive(), ready), [
      { t: "turnStarted", turn: null },
      { t: "textDelta", item: "m1", text: "a" },
      { t: "toolStarted", item: "t1", name: "Read", summary: "x.ts" },
      { t: "textDelta", item: "m1", text: "b" },
      { t: "textDelta", item: "m2", text: "c" },
    ]);
    expect(kinds(s)).toEqual(["text", "tool", "text", "text"]);
    expect(only(s, "text").map((e) => e.text)).toEqual(["a", "b", "c"]);
  });

  it("조각 없이 온 끝 덩어리(item 없음)는 새 항목", () => {
    const s = foldAll(emptyLive("running"), [{ t: "text", item: null, text: "끝" }]);
    expect(only(s, "text")[0]).toMatchObject({ item: null, text: "끝", done: true });
  });

  it("clientId 가 없는 받음(Codex null)은 받지 않은 첫 말을 받는다", () => {
    let s = addSent(addSent(emptyLive("ready"), "하나", "a"), "둘", "b");
    s = foldLive(s, { t: "userAccepted", clientId: null });
    expect(only(s, "user").map((e) => e.accepted)).toEqual([true, false]);
  });

  it("다른 창이 보낸 글(본문이 얹힌 받음)은 곧바로 받은 말풍선 — 내 글은 겹치지 않는다(2026-11-01)", () => {
    let s = addSent(emptyLive("ready"), "내 말", "mine");
    s = foldLive(s, { t: "userAccepted", clientId: "theirs", text: "원격에서", files: ["a.png"] });
    s = foldLive(s, { t: "userAccepted", clientId: "mine", text: "내 말" });
    const users = only(s, "user");
    expect(users.map((e) => [e.text, e.clientId, e.accepted])).toEqual([
      ["내 말", "mine", true],
      ["원격에서", "theirs", true],
    ]);
    expect(users[1].files).toEqual(["a.png"]);
    // 다시 접기(스냅숏 꼬리) — 같은 clientId 는 하나
    s = foldLive(s, { t: "userAccepted", clientId: "theirs", text: "원격에서" });
    expect(only(s, "user")).toHaveLength(2);
    // 본문이 없는 받음(옛 꼴 · 프로듀서)은 그대로
    expect(only(foldLive(s, { t: "userAccepted", clientId: "x" }), "user")).toHaveLength(2);
  });
});

describe("foldLive — 도구", () => {
  it("시작 → 흘러 온 출력 → 끝(ok) · 끝의 output 이 있으면 그것으로", () => {
    let s = foldAll(emptyLive("running"), [
      { t: "toolStarted", item: "t1", name: "Bash", summary: "ls", input: { command: "ls" } },
      { t: "toolOutput", item: "t1", text: "a\n" },
      { t: "toolOutput", item: "t1", text: "b\n" },
    ]);
    const t = only(s, "tool")[0];
    expect(t).toMatchObject({ name: "Bash", summary: "ls", output: "a\nb\n", finished: false, ok: null });
    expect(t.input).toContain('"command": "ls"');
    expect(entryItem(t)?.tool?.output).toBeNull(); // 도는 중
    s = foldLive(s, { t: "toolFinished", item: "t1", ok: true, output: null });
    expect(only(s, "tool")[0]).toMatchObject({ output: "a\nb\n", finished: true, ok: true });
    expect(entryItem(only(s, "tool")[0])?.tool).toMatchObject({ output: "a\nb\n", error: false });
    s = foldLive(s, { t: "toolStarted", item: "t2", name: "Read", summary: "y" });
    s = foldLive(s, { t: "toolFinished", item: "t2", ok: false, output: "nope" });
    expect(entryItem(only(s, "tool")[1])?.tool).toMatchObject({ output: "nope", error: true });
  });

  it("시작을 못 본 결과는 이름 없는 한 줄", () => {
    const s = foldLive(emptyLive("running"), { t: "toolFinished", item: "tx", ok: true, output: "r" });
    expect(only(s, "tool")[0]).toMatchObject({ name: "", finished: true, output: "r" });
  });

  it("문자열 입력은 그대로 · 입력 없음은 null", () => {
    let s = foldLive(emptyLive("running"), { t: "toolStarted", item: "t1", name: "X", summary: "", input: "raw" });
    s = foldLive(s, { t: "toolStarted", item: "t2", name: "Y", summary: "" });
    expect(only(s, "tool").map((e) => e.input)).toEqual(["raw", null]);
  });

  it("끊긴 턴의 끝나지 않은 도구는 턴 끝에 끝난 것으로(영영 돌지 않게)", () => {
    const s = foldAll(emptyLive("running"), [
      { t: "toolStarted", item: "t1", name: "Bash", summary: "sleep" },
      { t: "turnEnded", turn: null, outcome: "interrupted", message: null },
    ]);
    expect(only(s, "tool")[0].finished).toBe(true);
  });
});

describe("foldLive — 권한", () => {
  const perm: SideChatEv = { t: "permission", requestId: "r1", kind: "command", title: "Run git push", detail: "git push", toolName: "Bash" };

  it("묻기 → 기다림 → 사람이 허용 · 같은 요청이 두 번 와도 카드 하나", () => {
    let s = foldAll(emptyLive("running"), [perm, perm]);
    expect(pendingPermissions(s)).toHaveLength(1);
    expect(pendingPermissions(s)[0]).toMatchObject({ requestId: "r1", permKind: "command", title: "Run git push", detail: "git push", toolName: "Bash" });
    s = foldLive(s, { t: "permissionResolved", requestId: "r1", decision: "allow", by: "human" });
    expect(pendingPermissions(s)).toHaveLength(0);
    expect(only(s, "permission")[0].resolved).toEqual({ decision: "allow", by: "human" });
  });

  it("CLI 가 거둔 것 · 프로세스가 끝나 닫힌 것", () => {
    let s = foldAll(emptyLive("running"), [perm, { t: "permissionResolved", requestId: "r1", decision: null, by: "cli" }]);
    expect(only(s, "permission")[0].resolved).toEqual({ decision: null, by: "cli" });
    s = foldAll(emptyLive("running"), [{ ...perm, requestId: "r2" }, { t: "exited", code: 1, reason: "crash" }]);
    expect(only(s, "permission")[0].resolved).toEqual({ decision: null, by: "closed" });
  });

  it("파일 바꾸기(diff) 카드 · 모르는 요청 결과는 무시", () => {
    let s = foldLive(emptyLive("running"), { t: "permission", requestId: "f1", kind: "fileChange", title: "Edit a.ts", detail: "--- a\n+++ b", toolName: "apply_patch" });
    expect(only(s, "permission")[0].permKind).toBe("fileChange");
    const same = foldLive(s, { t: "permissionResolved", requestId: "zz", decision: "deny", by: "human" });
    expect(same).toBe(s);
  });

  it("다음 턴이 서면 끝난 카드는 걷히고 기다리는 카드는 남는다", () => {
    const s = foldAll(emptyLive("ready"), [
      perm,
      { t: "permissionResolved", requestId: "r1", decision: "deny", by: "human" },
      { ...perm, requestId: "r9" },
      { t: "turnStarted", turn: null },
    ]);
    expect(only(s, "permission").map((e) => e.requestId)).toEqual(["r9"]);
  });
});

describe("foldLive — 끝 · 알림 · 종료", () => {
  it("끊김은 실패가 아니라 '중단함' 알림 · 오류는 그 글과 함께", () => {
    let s = foldLive(emptyLive("running"), { t: "turnEnded", turn: null, outcome: "interrupted", message: null });
    expect(only(s, "outcome")[0]).toMatchObject({ outcome: "interrupted" });
    s = foldLive(emptyLive("running"), { t: "turnEnded", turn: null, outcome: "error", message: "overloaded" });
    expect(only(s, "outcome")[0]).toMatchObject({ outcome: "error", message: "overloaded" });
  });

  it("확인하지 않은 버전은 항목이 아니라 칩 경고 · 대화 바뀜은 대화 id 만", () => {
    let s = foldLive(emptyLive(), { t: "notice", code: "untested-version", detail: "2.2.0" });
    expect(s.untested).toBe("2.2.0");
    expect(s.entries).toHaveLength(0);
    s = foldLive(s, { t: "notice", code: "conversation-changed", detail: "11111111-2222-4333-8444-555555555555" });
    expect(s.conversationId).toBe("11111111-2222-4333-8444-555555555555");
    expect(s.entries).toHaveLength(0);
    s = foldLive(s, { t: "notice", code: "stderr", detail: "boom" });
    expect(only(s, "notice")[0]).toMatchObject({ code: "stderr", detail: "boom" });
  });

  it("모델 바뀜", () => {
    expect(foldLive(emptyLive(), { t: "modelChanged", model: "opus" }).model).toBe("opus");
  });

  it("실린 외부 MCP — 사건이 이름 목록을 갈아 끼우고(꼬리 항목 없음) · 스냅숏이 다시 세운다", () => {
    const s = foldLive(emptyLive(), { t: "mcpServers", names: ["tavily", "context7"] });
    expect(s.mcp).toEqual(["tavily", "context7"]);
    expect(s.entries).toHaveLength(0);
    expect(foldLive(s, { t: "mcpServers", names: [] }).mcp).toEqual([]);
    expect(seedLive(snap({ mcpServers: ["tavily"] })).mcp).toEqual(["tavily"]);
    // 옛 서버(칸 없음)는 알던 것을 잇는다
    expect(seedLive(snap({}), s).mcp).toEqual(["tavily", "context7"]);
    expect(emptyLive().mcp).toEqual([]);
  });

  it("종료 — 상태 멈춤 · 이유 · 악수 정보 비움 · 도는 턴이었으면 턴 끝으로 센다", () => {
    let s = foldAll(emptyLive(), [ready, { t: "turnStarted", turn: null }, { t: "toolStarted", item: "t1", name: "Read", summary: "" }]);
    const ended = s.ended;
    s = foldLive(s, { t: "exited", code: null, reason: "protocol" });
    expect(s.status).toBe("stopped");
    expect(s.ready).toBeNull();
    expect(s.ended).toBe(ended + 1);
    expect(only(s, "tool")[0].finished).toBe(true);
    expect(only(s, "exited")[0]).toMatchObject({ reason: "protocol", code: null });
    // 쉬던 프로세스의 종료는 턴 끝이 아니다
    const idle = foldLive(foldLive(emptyLive(), ready), { t: "exited", code: 0, reason: "exit" });
    expect(idle.ended).toBe(0);
  });

  it("다시 준비되면 종료 알림은 걷힌다 · 다음 턴은 지난 알림을 걷는다", () => {
    let s = foldAll(emptyLive(), [{ t: "exited", code: 0, reason: "exit" }, { t: "notice", code: "stderr", detail: "x" }]);
    s = foldLive(s, ready);
    expect(kinds(s)).toEqual(["notice"]);
    s = foldLive(s, { t: "turnStarted", turn: null });
    expect(kinds(s)).toEqual([]);
  });
});

describe("clearEnded — 기록을 받은 뒤 끝난 턴의 꼬리 걷기", () => {
  it("끝난 턴의 본문 · 카드는 걷고, 알림과 그 뒤에 보낸 말은 남는다", () => {
    let s = addSent(foldLive(emptyLive(), ready), "하나", "a");
    s = foldAll(s, [
      { t: "turnStarted", turn: null },
      { t: "userAccepted", clientId: "a" },
      { t: "textDelta", item: "m", text: "답" },
      { t: "permission", requestId: "r1", kind: "tool", title: "WebFetch", detail: "https://x", toolName: "WebFetch" },
      { t: "permissionResolved", requestId: "r1", decision: "deny", by: "human" },
      { t: "turnEnded", turn: null, outcome: "error", message: "overloaded" },
    ]);
    s = addSent(s, "둘", "b"); // 기록을 받는 사이 보낸 다음 말
    const c = clearEnded(s);
    expect(kinds(c)).toEqual(["outcome", "user"]);
    expect(only(c, "user")[0].text).toBe("둘");
    expect(clearEnded(c)).toBe(c); // 걷을 것이 없으면 그대로
  });

  it("끝난 턴의 '중단함' 은 걷는다 — 기록이 끊김 표식으로 같은 줄을 그린다(F5 뒤와 같은 그림 · 겹치지 않게)", () => {
    let s = addSent(foldLive(emptyLive(), ready), "길게", "a");
    s = foldAll(s, [
      { t: "turnStarted", turn: null },
      { t: "textDelta", item: "m", text: "부분" },
      { t: "turnEnded", turn: null, outcome: "interrupted", message: null },
      { t: "notice", code: "stderr", detail: "x" },
    ]);
    expect(kinds(s)).toEqual(["user", "text", "outcome", "notice"]);
    s = addSent(s, "다음", "b");
    const c = clearEnded(s);
    expect(kinds(c)).toEqual(["notice", "user"]);
    // 기록을 받기 전(턴 끝의 한 번이 실패)에는 그대로 남는다
    expect(only(s, "outcome")).toHaveLength(1);
  });
});

describe("seedLive — 스냅숏으로 다시 세우기", () => {
  it("처음 붙기(F5) — 꼬리를 접고 기다리는 권한을 더한다 · 상태는 스냅숏의 것", () => {
    const perm: SideChatEv = { t: "permission", requestId: "r1", kind: "tool", title: "Bash", detail: "rm x", toolName: "Bash" };
    const s = seedLive(
      snap({
        status: "running",
        liveTurn: [{ t: "turnStarted", turn: null }, { t: "userAccepted", clientId: "c1" }, { t: "textDelta", item: "m", text: "생각 중" }],
        pending: [perm as Extract<SideChatEv, { t: "permission" }>],
      }),
    );
    expect(s.status).toBe("running");
    expect(kinds(s)).toEqual(["text", "permission"]);
    expect(pendingPermissions(s)).toHaveLength(1);
    expect(s.conversationId).toBe(CONV);
    expect(s.model).toBe("sonnet");
  });

  it("꼬리에 이미 든 권한 요청은 겹치지 않는다", () => {
    const perm = { t: "permission", requestId: "r1", kind: "tool", title: "Bash", detail: "", toolName: "Bash" } as const;
    const s = seedLive(snap({ status: "running", liveTurn: [{ t: "turnStarted", turn: null }, perm], pending: [perm] }));
    expect(only(s, "permission")).toHaveLength(1);
  });

  it("같은 페이지의 다시 맞추기 — 악수 정보 · 버전 경고 · 지금 턴의 내 말을 잇는다", () => {
    let prev = foldAll(emptyLive(), [ready, { t: "notice", code: "untested-version", detail: "9" }]);
    prev = addSent(prev, "질문", "c1");
    prev = foldAll(prev, [{ t: "turnStarted", turn: null }, { t: "textDelta", item: "m", text: "부분" }]);
    const s = seedLive(snap({ status: "running", liveTurn: [{ t: "turnStarted", turn: null }, { t: "textDelta", item: "m", text: "부분과 더" }] }), prev);
    expect(s.ready?.models).toEqual(ready.t === "ready" ? ready.models : []);
    expect(s.untested).toBe("9");
    expect(kinds(s)).toEqual(["user", "text"]);
    expect(only(s, "text")[0].text).toBe("부분과 더");
    expect(s.next).toBeGreaterThan(prev.next - 1); // 번호는 이어진다(화면 열쇠가 겹치지 않게)
  });

  it("빈틈 사이 턴이 끝났으면 ended 를 늘린다(기록을 다시 받게)", () => {
    let prev = foldAll(emptyLive(), [ready, { t: "turnStarted", turn: null }, { t: "textDelta", item: "m", text: "부분" }]);
    prev = { ...prev };
    const s = seedLive(snap({ status: "ready" }), prev);
    expect(s.ended).toBe(prev.ended + 1);
    expect(s.entries).toEqual([]);
  });

  it("쉬는 채팅의 다시 맞추기 — 아직 받지 않은 내 말만 남는다", () => {
    let prev = addSent(foldLive(emptyLive(), ready), "보내는 중", "c9");
    prev = markSendFailed(addSent(prev, "실패", "c8"), "c8");
    const s = seedLive(snap({ status: "ready" }), prev);
    expect(only(s, "user").map((e) => e.text)).toEqual(["보내는 중"]);
  });
});

describe("setSentLink — 서버가 붙인 연결 머리글의 칩", () => {
  it("그 말에만 붙고 entryItem 이 기록 항목처럼 싣는다 · 없거나 모르는 clientId 는 그대로", () => {
    const s = addSent(addSent(emptyLive(), "첫", "a"), "둘", "b");
    const linked = setSentLink(s, "b", { label: "p2 PowerShell 7" });
    expect(only(linked, "user").map((e) => e.link ?? null)).toEqual([null, { label: "p2 PowerShell 7" }]);
    expect(entryItem(only(linked, "user")[1])?.link).toEqual({ label: "p2 PowerShell 7" });
    expect(entryItem(only(linked, "user")[0])?.link).toBeNull();
    expect(setSentLink(s, "b", null)).toBe(s);
    expect(setSentLink(s, "zz", { unlinked: true })).toBe(s);
  });
});

describe("markSendFailed · entryItem", () => {
  it("보내지 못한 말에 표시 · 모르는 clientId 는 그대로", () => {
    const s = addSent(emptyLive(), "x", "a");
    expect(only(markSendFailed(s, "a"), "user")[0].failed).toBe(true);
    expect(markSendFailed(s, "zz")).toBe(s);
  });

  it("본문만 기록 항목 꼴 — 카드 · 알림은 null", () => {
    const s = foldAll(addSent(emptyLive("running"), "q", "a"), [
      { t: "text", item: null, text: "a" },
      { t: "permission", requestId: "r", kind: "tool", title: "", detail: "", toolName: "" },
      { t: "notice", code: "stderr", detail: null },
    ]);
    expect(s.entries.map((e) => entryItem(e)?.role ?? null)).toEqual(["user", "assistant", null, null]);
  });
});

describe("historyHold · liveCut — 턴이 도는 동안 받은 기록의 겹침 자르기", () => {
  const u = (text: string): TranscriptItem => ({ role: "user", text, truncated: false, images: 0, tool: null, at: 1 });
  const a = (text: string): TranscriptItem => ({ role: "assistant", text, truncated: false, images: 0, tool: null, at: 2 });

  it("돌지 않으면 자르지 않는다", () => {
    expect(historyHold(foldLive(emptyLive(), ready))).toBeNull();
    expect(liveCut([u("x"), a("y")], null, sentMatches)).toBeNull();
  });

  it("이 페이지에서 보낸 말 — 기록의 마지막 사람 말이 그 글이면 거기서부터, 아니면(아직 안 적힘) 자르지 않는다", () => {
    let s = addSent(foldLive(emptyLive(), ready), "새 질문", "c");
    s = foldLive(s, { t: "turnStarted", turn: null });
    const hold = historyHold(s);
    expect(hold).toEqual({ userText: "새 질문" });
    expect(liveCut([u("옛 질문"), a("옛 답"), u("새 질문"), a("부분")], hold, sentMatches)).toBe(2);
    expect(liveCut([u("옛 질문"), a("옛 답")], hold, sentMatches)).toBeNull();
  });

  it("그림만 보낸 말(2026-10-24) — 꼬리에 이름이 실리고, 기록의 글 없는 사람 말에서 자른다", () => {
    let s = addSent(foldLive(emptyLive(), ready), "", "c", ["a.png", "b.webp"]);
    const e = s.entries[s.entries.length - 1];
    expect(e.kind === "user" && e.files).toEqual(["a.png", "b.webp"]);
    expect("files" in addSent(emptyLive(), "글", "d").entries[0]).toBe(false);
    s = foldLive(s, { t: "turnStarted", turn: null });
    const hold = historyHold(s);
    const pic: TranscriptItem = { role: "user", text: null, truncated: false, images: 1, tool: null, at: 1 };
    expect(liveCut([u("옛 질문"), a("옛 답"), pic, a("부분")], hold, sentMatches)).toBe(2);
  });

  it("F5(꼬리에 내 말이 없다) — 마지막 사람 말 뒤부터 자른다 · 사람 말이 없으면 자르지 않는다", () => {
    const s = seedLive(snap({ status: "running", liveTurn: [{ t: "turnStarted", turn: null }, { t: "textDelta", item: "m", text: "부분" }] }));
    const hold = historyHold(s);
    expect(hold).toEqual({ userText: null });
    expect(liveCut([u("옛"), a("옛 답"), u("지금"), a("부분")], hold, sentMatches)).toBe(3);
    expect(liveCut([a("머리")], hold, sentMatches)).toBeNull();
  });

  it("끝난 턴의 내 말은 근거가 아니다(경계 뒤의 것만)", () => {
    let s = addSent(foldLive(emptyLive(), ready), "옛 질문", "c1");
    s = foldAll(s, [{ t: "turnStarted", turn: null }, { t: "turnEnded", turn: null, outcome: "ok", message: null }, { t: "turnStarted", turn: null }]);
    expect(historyHold(s)).toEqual({ userText: null });
  });
});
