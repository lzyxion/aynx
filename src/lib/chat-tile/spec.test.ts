import { describe, expect, it } from "vitest";
import { chatTileIdOk, newChatTileId, parseChatTileSpec, saveChatTileSpec, tierOffered, tierOptions, tiersOf } from "./spec";
import type { ChatTileSpec } from "$lib/session/spec";
import { clonePane, leafOf, listPanes, newChatTilePane } from "$lib/session";
import { parseNode, restoreNode, saveNode } from "$lib/tabs";
import { sanitizePane } from "$lib/mirror/snapshot";
import { TEMPLATE_SKIP_KINDS } from "$lib/tab-templates";

const ID = "ct-0f8fad5b-d9cb-469f-a165-70867728950e";
const CONV = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";

describe("채팅 잎 id", () => {
  it("새 id 는 ct- + 소문자 uuid 이고 판정을 지난다", () => {
    const id = newChatTileId();
    expect(id).toMatch(/^ct-[0-9a-f-]{36}$/);
    expect(chatTileIdOk(id)).toBe(true);
    expect(newChatTileId()).not.toBe(id);
  });

  it("다른 종류 · 대문자 · 모양이 틀린 id 는 거절한다", () => {
    expect(chatTileIdOk(ID)).toBe(true);
    expect(chatTileIdOk("pc-0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(false);
    expect(chatTileIdOk("ct-0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe(false);
    expect(chatTileIdOk("ct-abc")).toBe(false);
    expect(chatTileIdOk(42)).toBe(false);
  });
});

describe("parseChatTileSpec", () => {
  it("id · cli 가 틀리면 null", () => {
    expect(parseChatTileSpec(null)).toBeNull();
    expect(parseChatTileSpec([])).toBeNull();
    expect(parseChatTileSpec({ chatId: "ct-bad", cli: "claude" })).toBeNull();
    expect(parseChatTileSpec({ chatId: ID, cli: "gemini" })).toBeNull();
    expect(parseChatTileSpec({ chatId: ID })).toBeNull();
  });

  it("틀린 칸은 빈 값으로 떨어진다 · conv 는 모양이 맞을 때만", () => {
    expect(
      parseChatTileSpec({ chatId: ID, cli: "codex", model: "gpt 5; rm", effort: 3, cwd: "x".repeat(4097), conv: "../../etc", extra: 1 }),
    ).toEqual({ chatId: ID, cli: "codex", model: "", effort: "", cwd: "" });
    expect(parseChatTileSpec({ chatId: ID, cli: "claude", model: "opus", effort: "high", cwd: "C:/src/proj", conv: CONV })).toEqual({
      chatId: ID,
      cli: "claude",
      model: "opus",
      effort: "high",
      cwd: "C:/src/proj",
      conv: CONV,
    });
  });

  it("permMode — CLI 별로 받을 수 있는 값만 · 아니면 칸만 버리고 잎은 산다", () => {
    const base = { chatId: ID, model: "", effort: "", cwd: "" };
    expect(parseChatTileSpec({ ...base, cli: "claude", permMode: "acceptEdits" })?.permMode).toBe("acceptEdits");
    expect(parseChatTileSpec({ ...base, cli: "claude", permMode: "auto" })?.permMode).toBe("auto");
    expect(parseChatTileSpec({ ...base, cli: "codex", permMode: "readOnly" })?.permMode).toBe("readOnly");
    for (const [cli, bad] of [
      ["claude", "bypassPermissions"],
      ["claude", "dontAsk"],
      ["claude", "readOnly"],
      ["codex", "acceptEdits"],
      ["codex", "fullAccess"],
      ["codex", 3],
    ] as const) {
      const out = parseChatTileSpec({ ...base, cli, permMode: bad });
      expect(out).not.toBeNull();
      expect(out).not.toHaveProperty("permMode");
    }
  });
});

describe("saveChatTileSpec", () => {
  it("permMode 는 conv 뒤 · 없으면 칸 없음", () => {
    const out = saveChatTileSpec({ permMode: "plan", conv: CONV, cwd: "", effort: "", model: "", cli: "codex", chatId: ID });
    expect(Object.keys(out)).toEqual(["chatId", "cli", "model", "effort", "cwd", "conv", "permMode"]);
    expect(Object.keys(saveChatTileSpec({ chatId: ID, cli: "codex", model: "", effort: "", cwd: "", permMode: "auto" }))).toEqual([
      "chatId",
      "cli",
      "model",
      "effort",
      "cwd",
      "permMode",
    ]);
  });

  it("키 순서가 chatId · cli · model · effort · cwd · conv 로 고정이다", () => {
    const messy = { conv: CONV, cwd: "C:/a", effort: "", model: "", cli: "claude", chatId: ID } as ChatTileSpec;
    const out = saveChatTileSpec(messy);
    expect(Object.keys(out)).toEqual(["chatId", "cli", "model", "effort", "cwd", "conv"]);
    expect(JSON.stringify(out)).toBe(JSON.stringify({ chatId: ID, cli: "claude", model: "", effort: "", cwd: "C:/a", conv: CONV }));
    expect(Object.keys(saveChatTileSpec({ ...messy, conv: undefined }))).toEqual(["chatId", "cli", "model", "effort", "cwd"]);
  });
});

describe("tier — Codex 속도 등급(명세에는 이 칸 하나)", () => {
  const base = { chatId: ID, model: "", effort: "", cwd: "" };

  it("Codex 만 · word 꼴 · 1–32 자 · 아니면 칸만 버린다", () => {
    expect(parseChatTileSpec({ ...base, cli: "codex", tier: "priority" })?.tier).toBe("priority");
    expect(parseChatTileSpec({ ...base, cli: "codex", tier: "x".repeat(32) })?.tier).toBe("x".repeat(32));
    for (const bad of ["", "x".repeat(33), "pri ority", "a;b", 3, null]) {
      const out = parseChatTileSpec({ ...base, cli: "codex", tier: bad });
      expect(out).not.toBeNull();
      expect(out).not.toHaveProperty("tier");
    }
    expect(parseChatTileSpec({ ...base, cli: "claude", tier: "priority" })).not.toHaveProperty("tier");
  });

  it("저장 키 순서 — permMode 뒤 · 없으면 칸 없음", () => {
    const out = saveChatTileSpec({ tier: "priority", permMode: "plan", conv: CONV, cwd: "", effort: "", model: "", cli: "codex", chatId: ID });
    expect(Object.keys(out)).toEqual(["chatId", "cli", "model", "effort", "cwd", "conv", "permMode", "tier"]);
    expect(Object.keys(saveChatTileSpec({ chatId: ID, cli: "codex", model: "", effort: "", cwd: "", tier: "priority" }))).toEqual(["chatId", "cli", "model", "effort", "cwd", "tier"]);
    expect(saveChatTileSpec({ chatId: ID, cli: "codex", model: "", effort: "", cwd: "" })).not.toHaveProperty("tier");
  });

  it("탭 저장 ↔ 복원 · 원격 거울 · 분할 복제가 칸을 잇는다(권한 모드와 달리 복제도 물려받는다)", () => {
    const chat: ChatTileSpec = { chatId: ID, cli: "codex", model: "gpt-6.2-sol", effort: "", cwd: "C:/w", permMode: "plan", tier: "priority" };
    const pane = newChatTilePane(chat);
    const saved = JSON.parse(JSON.stringify(saveNode(leafOf(pane))));
    const back = listPanes(restoreNode(parseNode(saved)!))[0];
    expect(back.chat).toEqual(chat);
    expect(sanitizePane(pane).chat).toEqual(chat);
    const copy = clonePane(pane);
    expect(copy.chat?.tier).toBe("priority");
    expect(copy.chat?.permMode).toBeUndefined();
    // 탭 템플릿은 채팅 잎을 싣지 않는다 — 명세 칸이 새지 않는다
    expect(TEMPLATE_SKIP_KINDS).toContain("chat");
  });

  it("tiersOf · tierOptions · tierOffered — 목록에 있는 id 만 · 모르면 거짓", () => {
    const tiers = tiersOf({
      byModel: {
        "gpt-6.2-sol": [{ id: "priority", name: "Fast", description: "2x speed, increased usage", extra: "x" }, { id: "bad id", name: "x", description: "" }],
        "gpt-mini": [],
        broken: "nope",
      },
      thread: "default",
      other: 1,
    });
    expect(tiers).toEqual({ byModel: { "gpt-6.2-sol": [{ id: "priority", name: "Fast", description: "2x speed, increased usage" }], "gpt-mini": [] }, thread: "default" });
    expect(tierOptions(tiers, "gpt-6.2-sol").map((x) => x.id)).toEqual(["priority"]);
    expect(tierOptions(tiers, "gpt-mini")).toEqual([]);
    expect(tierOptions(null, "gpt-6.2-sol")).toEqual([]);
    expect(tierOffered(tiers, "gpt-6.2-sol", "priority")).toBe(true);
    expect(tierOffered(tiers, "gpt-6.2-sol", "flex")).toBe(false);
    expect(tierOffered(tiers, "gpt-mini", "priority")).toBe(false);
    expect(tierOffered(null, "gpt-6.2-sol", "priority")).toBe(false);
    expect(tiersOf(null)).toBeNull();
    expect(tiersOf({ byModel: {}, thread: "a b" })).toEqual({ byModel: {}, thread: null });
  });
});
