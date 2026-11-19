import { describe, expect, it } from "vitest";
import {
  accordionEdges,
  botConnected,
  botHandle,
  channelConnected,
  formatPairCode,
  parseBotStatus,
  telegramHead,
  webhookHead,
  type BotStatus,
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
    const hooks = { discord: true, slack: null };
    expect(channelConnected("discord", hooks, null)).toBe(true);
    expect(channelConnected("slack", hooks, null)).toBe(false);
    expect(channelConnected("telegram", hooks, base)).toBe(false);
    expect(channelConnected("telegram", hooks, { ...base, paired: true })).toBe(true);
  });

  it("봇 이름 · 짝짓기 코드 모양", () => {
    expect(botHandle("my_aynx_bot")).toBe("@my_aynx_bot");
    expect(botHandle("@my_aynx_bot")).toBe("@my_aynx_bot");
    expect(botHandle(null)).toBe("");
    expect(formatPairCode("482913")).toBe("482 913");
    expect(formatPairCode("48291")).toBe("48291");
  });
});

describe("머리줄 상태 칩", () => {
  const keys = (h: ReturnType<typeof telegramHead>) => h.chips.map((c) => `${c.tone}:${c.key.split(".").pop()}`);

  it("웹훅 — 등록 전(모름 포함) · 보내는 중 · 보내기 꺼짐", () => {
    expect(webhookHead(null, true).chips).toEqual([{ tone: "off", key: "settings.messenger.status.none" }]);
    expect(webhookHead(false, true).chips[0].tone).toBe("off");
    expect(webhookHead(true, true).chips).toEqual([{ tone: "ok", key: "settings.messenger.status.sending" }]);
    expect(webhookHead(true, false).chips).toEqual([{ tone: "idle", key: "settings.messenger.status.paused" }]);
  });

  it("Telegram — 연결 안 됨 · 계정 연결 대기(+ 봇 이름) · 보내는 중 · 말하기 켜짐", () => {
    expect(keys(telegramHead(null, true, false))).toEqual(["off:none"]);
    expect(keys(telegramHead({ ...base, configured: false }, true, true))).toEqual(["off:none"]);
    const waiting = telegramHead(base, true, true);
    expect(keys(waiting)).toEqual(["idle:pairing"]);
    expect(waiting.aside).toBe("bot");
    expect(telegramHead({ ...base, bot: null }, true, false).aside).toBeNull();
    expect(keys(telegramHead({ ...base, paired: true }, true, false))).toEqual(["ok:sending"]);
    expect(keys(telegramHead({ ...base, paired: true }, false, false))).toEqual(["idle:paused"]);
    expect(keys(telegramHead({ ...base, paired: true }, true, true))).toEqual(["ok:sending", "ok:chat"]);
  });

  it("받는 고리가 막히면 글을 받지 못함 — conflict 면 곁글", () => {
    const conflict = telegramHead({ ...base, paired: true, link: "conflict" }, true, false);
    expect(keys(conflict)).toEqual(["ok:sending", "bad:no_receive"]);
    expect(conflict.aside).toBe("conflict");
    const error = telegramHead({ ...base, paired: true, link: "error" }, true, false);
    expect(keys(error)).toEqual(["ok:sending", "bad:no_receive"]);
    expect(error.aside).toBeNull();
    // 짝 전에도 — 짝짓기도 받는 고리로 온다
    expect(keys(telegramHead({ ...base, link: "conflict" }, true, false))).toEqual(["idle:pairing", "bad:no_receive"]);
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
