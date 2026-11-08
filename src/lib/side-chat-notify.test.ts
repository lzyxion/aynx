import { describe, expect, it } from "vitest";
import { shouldNotifySideChat, sideChatNotifyText, sideChatTurnNotifyKind } from "$lib/side-chat-notify";

describe("sideChatTurnNotifyKind", () => {
  it("잘 끝남 · 오류는 알리고 사람이 끊은 턴은 알리지 않는다", () => {
    expect(sideChatTurnNotifyKind("ok")).toBe("finished");
    expect(sideChatTurnNotifyKind("error")).toBe("failed");
    expect(sideChatTurnNotifyKind("interrupted")).toBeNull();
  });
});

describe("shouldNotifySideChat", () => {
  it("끄면 어떤 경우에도 알리지 않는다", () => {
    expect(shouldNotifySideChat({ enabled: false, windowFocused: false, chatShown: false })).toBe("none");
    expect(shouldNotifySideChat({ enabled: false, windowFocused: true, chatShown: false })).toBe("none");
  });

  it("창이 앞이고 그 채팅을 보고 있으면 알리지 않는다", () => {
    expect(shouldNotifySideChat({ enabled: true, windowFocused: true, chatShown: true })).toBe("none");
  });

  it("창이 앞이어도 그 채팅이 안 보이면 토스트", () => {
    expect(shouldNotifySideChat({ enabled: true, windowFocused: true, chatShown: false })).toBe("toast");
  });

  it("창이 뒤면 채팅이 열려 있어도 OS 알림", () => {
    expect(shouldNotifySideChat({ enabled: true, windowFocused: false, chatShown: true })).toBe("os");
    expect(shouldNotifySideChat({ enabled: true, windowFocused: false, chatShown: false })).toBe("os");
  });
});

describe("sideChatNotifyText", () => {
  it("종류마다 제 문구에 채팅 제목만 싣는다", () => {
    const tr = (key: string, params?: Record<string, string | number>) => `${key}|${params?.title}`;
    expect(sideChatNotifyText("finished", "빌드 질문", tr)).toBe("app.chatDock.notify.finished|빌드 질문");
    expect(sideChatNotifyText("failed", "빌드 질문", tr)).toBe("app.chatDock.notify.failed|빌드 질문");
    expect(sideChatNotifyText("permission", "빌드 질문", tr)).toBe("app.chatDock.notify.permission|빌드 질문");
  });
});
