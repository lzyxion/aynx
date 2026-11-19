import { describe, expect, it } from "vitest";
import {
  accordionEdges,
  botConnected,
  botHandle,
  botHead,
  channelConnected,
  discordDefaultVia,
  discordHead,
  discordKind,
  discordMode,
  discordNeedsConfirm,
  discordSwitchLocked,
  discordView,
  formatPairCode,
  parseBotStatus,
  parseHookStatus,
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

describe("parseHookStatus · discordMode — 한 번에 한 방식", () => {
  it("via 는 둘 중 하나 · 등록이 없으면 없음 · 옛 답(via 없음)은 등록만", () => {
    expect(parseHookStatus({ configured: true, via: "bot" })).toEqual({ configured: true, via: "bot" });
    expect(parseHookStatus({ configured: true, via: "webhook" })).toEqual(hook);
    expect(parseHookStatus({ configured: true })).toEqual({ configured: true, via: null });
    expect(parseHookStatus({ configured: false, via: "bot" })).toEqual({ configured: false, via: null });
    expect(parseHookStatus({ configured: true, via: "sms" })).toEqual({ configured: true, via: null });
    expect(parseHookStatus(null)).toEqual({ configured: false, via: null });
  });

  it("봇 토큰이 있으면 봇 · 웹훅만이면 웹훅 · 없거나 모르면 고르기", () => {
    expect(discordMode(null, null)).toBe("none");
    expect(discordMode({ configured: false, via: null }, { ...base, configured: false })).toBe("none");
    expect(discordMode(hook, { ...base, configured: false })).toBe("webhook");
    expect(discordMode({ configured: true, via: null }, null)).toBe("webhook");
    expect(discordMode({ configured: true, via: "bot" }, null)).toBe("bot");
    expect(discordMode(hook, base)).toBe("bot");
    expect(discordMode(null, base)).toBe("bot");
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
});

describe("머리줄 상태 칩", () => {
  const keys = (h: ReturnType<typeof botHead>) => h.chips.map((c) => `${c.tone}:${c.key.split(".").pop()}`);

  it("웹훅 — 등록 전(모름 포함) · 보내는 중 · 보내기 꺼짐", () => {
    expect(webhookHead(null, true).chips).toEqual([{ tone: "off", key: "settings.messenger.status.none" }]);
    expect(webhookHead(false, true).chips[0].tone).toBe("off");
    expect(webhookHead(true, true).chips).toEqual([{ tone: "ok", key: "settings.messenger.status.sending" }]);
    expect(webhookHead(true, false).chips).toEqual([{ tone: "idle", key: "settings.messenger.status.paused" }]);
  });

  it("Telegram — 연결 안 됨 · 계정 연결 대기(+ 봇 이름) · 보내는 중 · 말하기 켜짐", () => {
    expect(keys(botHead(null, true, false))).toEqual(["off:none"]);
    expect(keys(botHead({ ...base, configured: false }, true, true))).toEqual(["off:none"]);
    const waiting = botHead(base, true, true);
    expect(keys(waiting)).toEqual(["idle:pairing"]);
    expect(waiting.aside).toBe("bot");
    expect(botHead({ ...base, bot: null }, true, false).aside).toBeNull();
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
});

describe("Discord 머리 — 방식대로", () => {
  const keys = (h: ReturnType<typeof discordHead>) => h.chips.map((c) => `${c.tone}:${c.key.split(".").pop()}`);

  it("고르기 전 = 연결 안 됨 · 웹훅 = 보내는 중/꺼짐(말하기 칩 없음) · 봇 = Telegram 과 같다", () => {
    expect(keys(discordHead("none", null, true, true))).toEqual(["off:none"]);
    expect(keys(discordHead("webhook", null, true, true))).toEqual(["ok:sending"]);
    expect(keys(discordHead("webhook", null, false, false))).toEqual(["idle:paused"]);
    const waiting = discordHead("bot", base, true, false);
    expect(keys(waiting)).toEqual(["idle:pairing"]);
    expect(waiting.aside).toBe("bot");
    expect(keys(discordHead("bot", { ...base, paired: true }, true, true))).toEqual(["ok:sending", "ok:chat"]);
    expect(keys(discordHead("bot", { ...base, paired: true, link: "error" }, true, false))).toEqual(["ok:sending", "bad:no_receive"]);
  });

  it("맨 앞 방식 칩 — 서 있는 방식(계정 연결 대기도 봇) · 없으면 칩 없음 · 다른 채널 머리에는 없다", () => {
    expect(discordHead("none", null, true, true).kind).toBeNull();
    expect(discordHead("webhook", null, true, false).kind).toBe("settings.messenger.discord.kind.webhook");
    expect(discordHead("bot", base, true, false).kind).toBe("settings.messenger.discord.kind.bot");
    expect(discordHead("bot", { ...base, paired: true }, true, true).kind).toBe("settings.messenger.discord.kind.bot");
    expect(discordKind("none")).toBeNull();
    expect(botHead(base, true, false).kind).toBeUndefined();
    expect(webhookHead(true, true).kind).toBeUndefined();
  });
});

describe("Discord 몸통 — 연결 방식 고르기 · 바꾸기 확인(목업 ①–⑥)", () => {
  it("고르기의 기본은 연결된 방식 · 아무것도 없으면 봇", () => {
    expect(discordDefaultVia("none")).toBe("bot");
    expect(discordDefaultVia("webhook")).toBe("webhook");
    expect(discordDefaultVia("bot")).toBe("bot");
  });

  it("연결 전 = 고른 방식의 칸 · 연결된 방식 = 그 몸통 · 다른 방식 = 바꾸기", () => {
    expect(discordView("none", null)).toBe("bot");
    expect(discordView("none", "webhook")).toBe("webhook");
    expect(discordView("webhook", null)).toBe("webhook"); // ①
    expect(discordView("webhook", "bot")).toBe("to-bot"); // ②③
    expect(discordView("webhook", "webhook")).toBe("webhook");
    expect(discordView("bot", null)).toBe("bot"); // ④ · 계정 연결 대기
    expect(discordView("bot", "webhook")).toBe("to-webhook"); // ⑤⑥
    expect(discordView("bot", "bot")).toBe("bot");
  });

  it("확인은 바꾸기에만 · 연결 전 등록은 확인 없음", () => {
    expect(discordNeedsConfirm("to-bot")).toBe(true);
    expect(discordNeedsConfirm("to-webhook")).toBe(true);
    expect(discordNeedsConfirm("bot")).toBe(false);
    expect(discordNeedsConfirm("webhook")).toBe(false);
  });

  it("원격 창은 어느 방향이든 바꾸기가 잠긴다 · 메인 PC 는 열림 · 연결 전 칸은 몸통이 정한다", () => {
    for (const v of ["to-bot", "to-webhook"] as const) {
      expect(discordSwitchLocked(v, true)).toBe(true);
      expect(discordSwitchLocked(v, false)).toBe(false);
    }
    expect(discordSwitchLocked("webhook", true)).toBe(false);
    expect(discordSwitchLocked("bot", true)).toBe(false);
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
