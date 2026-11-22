import { describe, expect, it } from "vitest";
import {
  accordionEdges,
  botConnected,
  botHandle,
  botHead,
  channelConnected,
  codeSpans,
  dualDefaultVia,
  dualHead,
  dualKind,
  dualMode,
  dualNeedsConfirm,
  dualSwitchLocked,
  dualView,
  formatPairCode,
  joinTokens,
  parseBotStatus,
  parseHookStatus,
  SLACK_MANIFEST,
  splitAtMark,
  telegramHead,
  tokenFields,
  webhookHead,
  type BotStatus,
  type HookStatus,
} from "$lib/settings/messenger-view";

/** 설정 › 알림 › 채널 목록의 순수 판정 (docs/log/2026-11-18-messenger-bridge.md "1b") */

const base: BotStatus = {
  configured: true,
  bot: "my_aynx_bot",
  paired: false,
  pairName: null,
  pending: null,
  link: "ok",
};

const hook: HookStatus = { configured: true, via: "webhook" };

describe("parseHookStatus · dualMode — 한 번에 한 방식", () => {
  it("via 는 둘 중 하나 · 등록이 없으면 없음 · 옛 답(via 없음)은 등록만", () => {
    expect(parseHookStatus({ configured: true, via: "bot" })).toEqual({ configured: true, via: "bot" });
    expect(parseHookStatus({ configured: true, via: "webhook" })).toEqual(hook);
    expect(parseHookStatus({ configured: true })).toEqual({ configured: true, via: null });
    expect(parseHookStatus({ configured: false, via: "bot" })).toEqual({ configured: false, via: null });
    expect(parseHookStatus({ configured: true, via: "sms" })).toEqual({ configured: true, via: null });
    expect(parseHookStatus(null)).toEqual({ configured: false, via: null });
  });

  it("봇 토큰이 있으면 봇 · 웹훅만이면 웹훅 · 없거나 모르면 고르기", () => {
    expect(dualMode(null, null)).toBe("none");
    expect(dualMode({ configured: false, via: null }, { ...base, configured: false })).toBe("none");
    expect(dualMode(hook, { ...base, configured: false })).toBe("webhook");
    expect(dualMode({ configured: true, via: null }, null)).toBe("webhook");
    expect(dualMode({ configured: true, via: "bot" }, null)).toBe("bot");
    expect(dualMode(hook, base)).toBe("bot");
    expect(dualMode(null, base)).toBe("bot");
  });
});

describe("parseBotStatus — 백엔드 답의 모양", () => {
  it("모양이 맞으면 그대로 · 빈 글자는 없음으로", () => {
    expect(
      parseBotStatus({
        configured: true,
        bot: "my_aynx_bot",
        paired: true,
        pairName: "Jin",
        pending: { code: "482913", name: "Jin" },
        link: "conflict",
      }),
    ).toEqual({
      configured: true,
      bot: "my_aynx_bot",
      paired: true,
      pairName: "Jin",
      pending: { code: "482913", name: "Jin" },
      link: "conflict",
    });
    expect(parseBotStatus({ configured: false, bot: "", paired: false, pairName: " ", pending: null, link: "off" })).toEqual({
      configured: false,
      bot: null,
      paired: false,
      pairName: null,
      pending: null,
      link: "off",
    });
  });

  it("모르는 값은 안전한 쪽으로 — link 는 off · 코드 없는 대기는 없음 · configured 가 없으면 모름", () => {
    expect(parseBotStatus({ configured: true, link: "weird", pending: { name: "x" } })).toMatchObject({
      link: "off",
      pending: null,
      paired: false,
    });
    expect(parseBotStatus(null)).toBeNull();
    expect(parseBotStatus("ok")).toBeNull();
    expect(parseBotStatus({ bot: "x" })).toBeNull();
  });
});

describe("Telegram 의 연결 · 이름", () => {
  it("연결됨 = 토큰 + 짝", () => {
    expect(botConnected(null)).toBe(false);
    expect(botConnected(base)).toBe(false);
    expect(botConnected({ ...base, paired: true })).toBe(true);
    expect(botConnected({ ...base, configured: false, paired: true })).toBe(false);
  });

  it("채널마다의 연결 — 웹훅은 등록, Telegram 은 봇", () => {
    const hooks = { discord: hook, slack: null };
    expect(channelConnected("discord", hooks, {})).toBe(true);
    expect(channelConnected("slack", hooks, {})).toBe(false);
    expect(channelConnected("slack", { slack: { configured: true, via: "webhook" } }, {})).toBe(true);
    expect(channelConnected("telegram", hooks, { telegram: base })).toBe(false);
    expect(channelConnected("telegram", hooks, { telegram: { ...base, paired: true } })).toBe(true);
    // Telegram 의 짝이 Discord 를 연결하지 않는다 — 채널마다 따로
    expect(channelConnected("discord", {}, { telegram: { ...base, paired: true } })).toBe(false);
  });

  it("Discord 봇 — 토큰만이면 연결 전(웹훅이 있던 자리도), 짝을 지어야 연결", () => {
    const viaBot: HookStatus = { configured: true, via: "bot" };
    expect(channelConnected("discord", { discord: viaBot }, { discord: base })).toBe(false);
    expect(channelConnected("discord", { discord: viaBot }, { discord: { ...base, paired: true } })).toBe(true);
    // 봇 토큰을 막 넣었고 messenger_status 를 아직 다시 읽지 않았다 — 웹훅이 남아 보여도 봇이 이긴다
    expect(channelConnected("discord", { discord: hook }, { discord: base })).toBe(false);
  });

  it("봇 이름 · 짝짓기 코드 모양", () => {
    expect(botHandle("my_aynx_bot")).toBe("@my_aynx_bot");
    expect(botHandle("@my_aynx_bot")).toBe("@my_aynx_bot");
    expect(botHandle(null)).toBe("");
    expect(botHandle("aynx-bot", "discord")).toBe("aynx-bot");
    expect(botHandle(null, "discord")).toBe("");
    expect(formatPairCode("482913")).toBe("482 913");
    expect(formatPairCode("48291")).toBe("48291");
  });

  it("안내 문장을 봇 이름 자리에서 가른다 — 자리가 한 번이 아니면 가르지 않는다", () => {
    expect(splitAtMark("폰에서 \u0000 에게 보내세요", "\u0000")).toEqual(["폰에서 ", " 에게 보내세요"]);
    expect(splitAtMark("\u0000 first", "\u0000")).toEqual(["", " first"]);
    expect(splitAtMark("자리가 없다", "\u0000")).toBeNull();
    expect(splitAtMark("\u0000 둘 \u0000", "\u0000")).toBeNull();
  });
});

describe("머리줄 상태 칩", () => {
  const keys = (h: ReturnType<typeof botHead>) => h.chips.map((c) => `${c.tone}:${c.key.split(".").pop()}`);

  it("웹훅 — 등록 전(모름 포함) · 보내는 중 · 보내기 꺼짐", () => {
    expect(webhookHead(null, true).chips).toEqual([{ tone: "off", key: "settings.messenger.status.none" }]);
    expect(webhookHead(false, true).chips[0].tone).toBe("off");
    expect(webhookHead(true, true).chips).toEqual([{ tone: "ok", key: "settings.messenger.status.sending" }]);
    expect(webhookHead(true, false).chips).toEqual([{ tone: "idle", key: "settings.messenger.status.paused" }]);
  });

  it("Telegram — 연결 안 됨 · 계정 연결 대기(봇 이름은 머리줄에 없다) · 보내는 중 · 말하기 켜짐", () => {
    expect(keys(botHead(null, true, false))).toEqual(["off:none"]);
    expect(keys(botHead({ ...base, configured: false }, true, true))).toEqual(["off:none"]);
    const waiting = botHead(base, true, true);
    expect(keys(waiting)).toEqual(["idle:pairing"]);
    expect(base.bot).toBeTruthy();
    expect(waiting.aside).toBeNull();
    expect(keys(botHead({ ...base, paired: true }, true, false))).toEqual(["ok:sending"]);
    expect(keys(botHead({ ...base, paired: true }, false, false))).toEqual(["idle:paused"]);
    expect(keys(botHead({ ...base, paired: true }, true, true))).toEqual(["ok:sending", "ok:chat"]);
  });

  it("받는 고리가 막히면 글을 받지 못함 — conflict 면 곁글", () => {
    const conflict = botHead({ ...base, paired: true, link: "conflict" }, true, false);
    expect(keys(conflict)).toEqual(["ok:sending", "bad:no_receive"]);
    expect(conflict.aside).toBe("conflict");
    const error = botHead({ ...base, paired: true, link: "error" }, true, false);
    expect(keys(error)).toEqual(["ok:sending", "bad:no_receive"]);
    expect(error.aside).toBeNull();
    // 짝 전에도 — 짝짓기도 받는 고리로 온다
    expect(keys(botHead({ ...base, link: "conflict" }, true, false))).toEqual(["idle:pairing", "bad:no_receive"]);
  });

  it("Telegram 머리 — 봇 토큰이 있으면(계정 연결 대기도) 맨 앞 방식 칩 봇 · 없거나 모르면 칩 없음 · 상태 칩 · 곁글은 botHead 그대로", () => {
    expect(telegramHead(null, true, false).kind).toBeNull();
    expect(telegramHead({ ...base, configured: false }, true, true).kind).toBeNull();
    expect(telegramHead(base, true, false).kind).toBe("settings.messenger.kind.bot");
    expect(telegramHead({ ...base, paired: true }, true, true).kind).toBe("settings.messenger.kind.bot");
    const cases: [BotStatus | null, boolean, boolean][] = [
      [null, true, false],
      [{ ...base, configured: false }, true, true],
      [base, true, true],
      [{ ...base, paired: true }, false, false],
      [{ ...base, paired: true }, true, true],
      [{ ...base, paired: true, link: "conflict" }, true, false],
    ];
    for (const [s, send, chat] of cases) {
      const { kind: _kind, ...rest } = telegramHead(s, send, chat);
      expect(rest).toEqual(botHead(s, send, chat));
    }
  });
});

describe("Discord 머리 — 방식대로", () => {
  const keys = (h: ReturnType<typeof dualHead>) => h.chips.map((c) => `${c.tone}:${c.key.split(".").pop()}`);

  it("고르기 전 = 연결 안 됨 · 웹훅 = 보내는 중/꺼짐(말하기 칩 없음) · 봇 = Telegram 과 같다", () => {
    expect(keys(dualHead("none", null, true, true))).toEqual(["off:none"]);
    expect(keys(dualHead("webhook", null, true, true))).toEqual(["ok:sending"]);
    expect(keys(dualHead("webhook", null, false, false))).toEqual(["idle:paused"]);
    const waiting = dualHead("bot", base, true, false);
    expect(keys(waiting)).toEqual(["idle:pairing"]);
    expect(waiting.aside).toBeNull();
    expect(keys(dualHead("bot", { ...base, paired: true }, true, true))).toEqual(["ok:sending", "ok:chat"]);
    expect(keys(dualHead("bot", { ...base, paired: true, link: "error" }, true, false))).toEqual(["ok:sending", "bad:no_receive"]);
  });

  it("맨 앞 방식 칩 — 서 있는 방식(계정 연결 대기도 봇) · 없으면 칩 없음 · 방식 없는 머리 조각(botHead · webhookHead)에는 없다", () => {
    expect(dualHead("none", null, true, true).kind).toBeNull();
    expect(dualHead("webhook", null, true, false).kind).toBe("settings.messenger.kind.webhook");
    expect(dualHead("bot", base, true, false).kind).toBe("settings.messenger.kind.bot");
    expect(dualHead("bot", { ...base, paired: true }, true, true).kind).toBe("settings.messenger.kind.bot");
    expect(dualKind("none")).toBeNull();
    expect(botHead(base, true, false).kind).toBeUndefined();
    expect(webhookHead(true, true).kind).toBeUndefined();
  });
});

describe("Discord 몸통 — 연결 방식 고르기 · 바꾸기 확인(목업 ①–⑥)", () => {
  it("고르기의 기본은 연결된 방식 · 아무것도 없으면 봇", () => {
    expect(dualDefaultVia("none")).toBe("bot");
    expect(dualDefaultVia("webhook")).toBe("webhook");
    expect(dualDefaultVia("bot")).toBe("bot");
  });

  it("연결 전 = 고른 방식의 칸 · 연결된 방식 = 그 몸통 · 다른 방식 = 바꾸기", () => {
    expect(dualView("none", null)).toBe("bot");
    expect(dualView("none", "webhook")).toBe("webhook");
    expect(dualView("webhook", null)).toBe("webhook"); // ①
    expect(dualView("webhook", "bot")).toBe("to-bot"); // ②③
    expect(dualView("webhook", "webhook")).toBe("webhook");
    expect(dualView("bot", null)).toBe("bot"); // ④ · 계정 연결 대기
    expect(dualView("bot", "webhook")).toBe("to-webhook"); // ⑤⑥
    expect(dualView("bot", "bot")).toBe("bot");
  });

  it("확인은 바꾸기에만 · 연결 전 등록은 확인 없음", () => {
    expect(dualNeedsConfirm("to-bot")).toBe(true);
    expect(dualNeedsConfirm("to-webhook")).toBe(true);
    expect(dualNeedsConfirm("bot")).toBe(false);
    expect(dualNeedsConfirm("webhook")).toBe(false);
  });

  it("원격 창은 어느 방향이든 바꾸기가 잠긴다 · 메인 PC 는 열림 · 연결 전 칸은 몸통이 정한다", () => {
    for (const v of ["to-bot", "to-webhook"] as const) {
      expect(dualSwitchLocked(v, true)).toBe(true);
      expect(dualSwitchLocked(v, false)).toBe(false);
    }
    expect(dualSwitchLocked("webhook", true)).toBe(false);
    expect(dualSwitchLocked("bot", true)).toBe(false);
  });
});

describe("Slack — 두 방식 채널(Discord 와 같은 뼈대) · 토큰 둘", () => {
  it("연결 판정은 Discord 와 같다 — 웹훅은 등록, 봇은 토큰 + 짝 · 채널마다 따로", () => {
    expect(channelConnected("slack", { slack: { configured: true, via: "bot" } }, { slack: base })).toBe(false);
    expect(channelConnected("slack", { slack: { configured: true, via: "bot" } }, { slack: { ...base, paired: true } })).toBe(true);
    expect(channelConnected("slack", { slack: hook }, { slack: base })).toBe(false);
    expect(channelConnected("slack", {}, { discord: { ...base, paired: true } })).toBe(false);
    expect(channelConnected("discord", {}, { slack: { ...base, paired: true } })).toBe(false);
    expect(dualMode({ configured: true, via: "bot" }, null)).toBe("bot");
    expect(dualHead("bot", base, true, false).kind).toBe("settings.messenger.kind.bot");
  });

  it("봇 이름(멤버 ID 포함)은 그대로 — @ 를 붙이지 않는다", () => {
    expect(botHandle("aynx", "slack")).toBe("aynx");
    expect(botHandle("U024BE7LH", "slack")).toBe("U024BE7LH");
  });

  it("토큰 칸 — Slack 은 봇 · 앱 둘(Discord · Telegram 은 하나 · id 는 그대로)", () => {
    expect(tokenFields("slack").map((f) => [f.id, f.placeholder])).toEqual([
      ["messenger-slack-token", "xoxb-…"],
      ["messenger-slack-app-token", "xapp-…"],
    ]);
    expect(tokenFields("discord").map((f) => f.id)).toEqual(["messenger-discord-token"]);
    expect(tokenFields("telegram").map((f) => f.id)).toEqual(["messenger-telegram-token"]);
  });

  it("두 칸은 줄바꿈 하나로 잇는다 — 앞뒤 공백을 걷고 · 빈 칸이 있으면 보내지 않는다", () => {
    expect(joinTokens([" xoxb-1 ", "xapp-2\n"])).toBe("xoxb-1\nxapp-2");
    expect(joinTokens(["xoxb-1", " "])).toBeNull();
    expect(joinTokens([])).toBeNull();
    expect(joinTokens([" MTIz.x "])).toBe("MTIz.x");
  });

  it("매니페스트 — 권한 둘 · DM 받기 · Socket Mode · 메시지 탭", () => {
    for (const s of ["chat:write", "im:history", "message.im", "socket_mode_enabled: true", "messages_tab_enabled: true"]) {
      expect(SLACK_MANIFEST).toContain(s);
    }
  });

  it("요령의 백틱은 코드 조각으로", () => {
    expect(codeSpans("a `connections:write` b")).toEqual([
      { text: "a ", code: false },
      { text: "connections:write", code: true },
      { text: " b", code: false },
    ]);
    expect(codeSpans("plain")).toEqual([{ text: "plain", code: false }]);
    expect(codeSpans("odd ` tick")).toEqual([{ text: "odd ` tick", code: false }]);
  });
});

describe("accordionEdges — 펼친 칸은 홀로 선다", () => {
  const edges = (n: number, open: number) =>
    Array.from({ length: n }, (_, i) => {
      const e = accordionEdges(i, n, open);
      return `${e.first ? "F" : "-"}${e.last ? "L" : "-"}`;
    });

  it("다 접힘 — 첫 · 끝만", () => {
    expect(edges(3, -1)).toEqual(["F-", "--", "-L"]);
  });

  it("가운데를 펼치면 셋으로 갈린다", () => {
    expect(edges(3, 1)).toEqual(["FL", "FL", "FL"]);
  });

  it("첫 칸을 펼치면 나머지 둘이 한 묶음", () => {
    expect(edges(3, 0)).toEqual(["FL", "F-", "-L"]);
  });
});
