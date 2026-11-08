import { describe, expect, it } from "vitest";
import {
  agentEvent,
  agentStatsLine,
  changedFilesBetween,
  commandFinishEvent,
  isAway,
  messengerChannels,
  oscEvent,
  resolveMessengerRules,
  shouldSendMessenger,
  type MessengerFacts,
  type MessengerRules,
} from "$lib/messenger-notify";
import type { Tr } from "$lib/finish-notify";
import { translate } from "$lib/i18n/dict";

/**
 * 메신저 알림의 규칙과 문구 (docs/log/2026-09-27-discord-notify.md · docs/log/2026-09-28-messenger-channels.md).
 * 순수 모듈이라 그대로 돈다 — 보내는 일(`invoke`)은 `app/messenger.ts` 에 있다. 여기 문구는 **평문**이다 —
 * 채널 서식(Discord 마크다운 · 남의 글자 걷기)의 시험은 `src-tauri/src/messenger.rs` 로 옮겼다.
 */

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

const on: MessengerRules = resolveMessengerRules({});
const here: MessengerFacts = { veiled: false, idleMs: 0 };
const veiled: MessengerFacts = { veiled: true, idleMs: 0 };
const idle: MessengerFacts = { veiled: false, idleMs: 5 * 60_000 };

describe("resolveMessengerRules — 안 정한 칸의 기본값", () => {
  it("자리 비움만 · 사건 칸은 켬 · 명령 줄은 뺀다", () => {
    expect(resolveMessengerRules(undefined)).toEqual({
      when: "away",
      agentStop: true,
      agentPermission: true,
      commandMinSecs: 300,
      osc: true,
      operationResults: true,
      operationPending: true,
      includeSummary: true,
      includeCommand: false,
      includeConversation: false,
      awayAfterMin: 5,
      discord: true,
      slack: true,
    });
  });

  it("채널 칸 — 안 정하면 둘 다 켬 · 하나만 · 둘 다 끄면 목록이 빈다", () => {
    expect(messengerChannels(resolveMessengerRules({}))).toEqual(["discord", "slack"]);
    expect(messengerChannels(resolveMessengerRules({ discord: null, slack: null }))).toEqual(["discord", "slack"]);
    expect(messengerChannels(resolveMessengerRules({ discord: false }))).toEqual(["slack"]);
    expect(messengerChannels(resolveMessengerRules({ slack: false }))).toEqual(["discord"]);
    expect(messengerChannels(resolveMessengerRules({ discord: false, slack: false }))).toEqual([]);
  });

  it("모르는 when 은 기본(away)으로 떨어지고, 0 은 살아남는다", () => {
    const r = resolveMessengerRules({ when: "sometimes", command_min_secs: 0, away_after_min: 0 });
    expect(r.when).toBe("away");
    expect(r.commandMinSecs).toBe(0);
    expect(r.awayAfterMin).toBe(0);
  });
});

describe("isAway — 가림막이거나 입력이 한참 없었다", () => {
  it("가림막이 걸렸으면 자리 비움", () => {
    expect(isAway(on, veiled)).toBe(true);
  });

  it("입력 시계는 넘거나 같으면 친다", () => {
    expect(isAway(on, { veiled: false, idleMs: 5 * 60_000 - 1 })).toBe(false);
    expect(isAway(on, idle)).toBe(true);
  });

  it("0 분이면 입력 시계를 보지 않는다 (가림막만)", () => {
    const r = { ...on, awayAfterMin: 0 };
    expect(isAway(r, { veiled: false, idleMs: 10 * 3_600_000 })).toBe(false);
    expect(isAway(r, veiled)).toBe(true);
  });
});

describe("shouldSendMessenger — 표 하나", () => {
  it("켜진 채널이 없으면 아무것도 안 보낸다", () => {
    const off = { ...on, discord: false, slack: false };
    for (const kind of ["agent-stop", "agent-permission", "osc", "operation-result"] as const) {
      expect(shouldSendMessenger(kind, off, veiled)).toBe(false);
    }
    expect(shouldSendMessenger("command-finish", off, { ...veiled, durationMs: 3_600_000 })).toBe(false);
  });

  it("away — 자리에 있으면 안 보내고 비웠으면 보낸다", () => {
    expect(shouldSendMessenger("agent-stop", on, here)).toBe(false);
    expect(shouldSendMessenger("agent-stop", on, veiled)).toBe(true);
    expect(shouldSendMessenger("agent-permission", on, idle)).toBe(true);
    expect(shouldSendMessenger("osc", on, idle)).toBe(true);
  });

  it("always — 자리에 있어도 보낸다", () => {
    expect(shouldSendMessenger("agent-stop", { ...on, when: "always" }, here)).toBe(true);
  });

  it("사건 칸을 끄면 그 사건만 빠진다", () => {
    expect(shouldSendMessenger("agent-stop", { ...on, agentStop: false }, veiled)).toBe(false);
    expect(shouldSendMessenger("agent-permission", { ...on, agentStop: false }, veiled)).toBe(true);
    expect(shouldSendMessenger("agent-permission", { ...on, agentPermission: false }, veiled)).toBe(false);
    expect(shouldSendMessenger("osc", { ...on, osc: false }, veiled)).toBe(false);
    // 작업안 실행 결과(③-4) — 제 칸 하나 · 안 정하면 켬
    expect(shouldSendMessenger("operation-result", on, veiled)).toBe(true);
    expect(shouldSendMessenger("operation-result", on, here)).toBe(false);
    expect(shouldSendMessenger("operation-result", { ...on, operationResults: false }, veiled)).toBe(false);
    expect(resolveMessengerRules({ operation_results: false }).operationResults).toBe(false);
    // 작업안 승인 대기(승인 요약) — 제 칸 하나 · 안 정하면 켬 · 자리 비움 규칙 그대로
    expect(shouldSendMessenger("operation-pending", on, veiled)).toBe(true);
    expect(shouldSendMessenger("operation-pending", on, here)).toBe(false);
    expect(shouldSendMessenger("operation-pending", { ...on, when: "always" }, here)).toBe(true);
    expect(shouldSendMessenger("operation-pending", { ...on, operationPending: false }, veiled)).toBe(false);
    expect(resolveMessengerRules({ operation_pending: false, include_summary: false })).toMatchObject({
      operationPending: false,
      includeSummary: false,
    });
  });

  it("긴 명령은 제 하한을 쓴다 — 넘거나 같으면 · 0 은 끔 · 길이를 모르면 안 보낸다", () => {
    expect(shouldSendMessenger("command-finish", on, { ...veiled, durationMs: 299_999 })).toBe(false);
    expect(shouldSendMessenger("command-finish", on, { ...veiled, durationMs: 300_000 })).toBe(true);
    expect(shouldSendMessenger("command-finish", { ...on, commandMinSecs: 0 }, { ...veiled, durationMs: 9e9 })).toBe(
      false,
    );
    expect(shouldSendMessenger("command-finish", on, veiled)).toBe(false);
    expect(shouldSendMessenger("command-finish", on, { ...veiled, durationMs: Number.NaN })).toBe(false);
    // 길어도 자리에 있으면(away) 안 보낸다
    expect(shouldSendMessenger("command-finish", on, { ...here, durationMs: 600_000 })).toBe(false);
  });
});

describe("문구 — 평문 (서식은 Rust 가 입힌다)", () => {
  it("에이전트 — OS 알림 본문과 같은 낱말 · 이름은 걷지 않은 채", () => {
    expect(agentEvent("stop", "Claude Code", ko)).toBe("Claude Code 작업이 끝났습니다");
    expect(agentEvent("permission", null, ko)).toBe("AI 에이전트 가 권한을 묻고 있습니다");
    expect(agentEvent("stop", "Codex", en)).toContain("Codex");
    expect(agentEvent("stop", "a*b", ko)).toBe("a*b 작업이 끝났습니다");
  });

  it("긴 명령 — 기본은 명령 줄을 싣지 않는다", () => {
    const base = { commandLine: "deploy --token=SECRET", durationMs: 185_000, exit: 1 };
    const hidden = commandFinishEvent({ ...base, includeCommand: false }, ko);
    expect(hidden).toBe("명령 실패 · 3분 05초 (코드 1)");
    expect(hidden).not.toContain("SECRET");
    expect(commandFinishEvent({ ...base, exit: 0, includeCommand: false }, ko)).toBe("명령 끝남 · 3분 05초");
  });

  it("긴 명령 — 켜면 명령 줄을 싣되 접어서(걷기는 Rust)", () => {
    const shown = commandFinishEvent(
      { commandLine: "npm run\n  *build*", durationMs: 185_000, exit: 0, includeCommand: true },
      ko,
    );
    expect(shown).toBe('"npm run *build*" 끝남 · 3분 05초');
    // 빈 명령 줄이면 켜 두어도 일반 문구
    expect(commandFinishEvent({ commandLine: "  ", durationMs: 1000, exit: 0, includeCommand: true }, ko)).toBe(
      "명령 끝남 · 1.0초",
    );
  });

  it("대화 싣기는 켠 사람만(안 정하면 끔)", () => {
    expect(resolveMessengerRules({ include_conversation: true }).includeConversation).toBe(true);
    expect(resolveMessengerRules({ include_conversation: null }).includeConversation).toBe(false);
  });

  it("프로그램 알림 — 본문을 걷지 않은 채 싣는다", () => {
    expect(oscEvent("build done", ko)).toBe("프로그램 알림 — build done");
    expect(oscEvent("[x](y)", en)).toBe("Program notification — [x](y)");
  });
});

describe("에이전트 알림 둘째 줄 — 맥락 (대화 글자가 아니다)", () => {
  it("시간 · 도구 · 파일 — 모르는 칸은 뺀다", () => {
    expect(agentStatsLine({ turnMs: 750_000, tools: 23, files: 4 }, ko)).toBe("12분 30초 · 도구 23회 · 파일 4개 변경");
    expect(agentStatsLine({ turnMs: 750_000, tools: null, files: null }, ko)).toBe("12분 30초");
    expect(agentStatsLine({ turnMs: null, tools: 1, files: 1 }, ko)).toBe("도구 1회 · 파일 1개 변경");
    expect(agentStatsLine({ turnMs: 42_300, tools: 0, files: 0 }, ko)).toBe("42.3초 · 파일 변경 없음");
    expect(agentStatsLine({ turnMs: null, tools: null, files: null }, ko)).toBe("");
    expect(agentStatsLine({ turnMs: null, tools: 2, files: 3 }, en)).toBe("2 tool uses · 3 files changed");
  });

  it("바뀐 파일 수 — 두 도장의 서로 다른 줄의 경로", () => {
    const before = [" M\t10\tsrc/a.ts", "??\t5\tnotes.md", " M\t7\tkeep.ts"];
    const after = [
      " M\t11\tsrc/a.ts", // 이미 더러웠는데 다시 고침(mtime)
      " M\t7\tkeep.ts", // 그대로 — 세지 않는다
      "A \t9\tsrc/new file.ts", // 새로 (경로에 빈칸)
    ]; // notes.md 는 깨끗해졌다(지웠거나 커밋)
    expect(changedFilesBetween(before, after)).toBe(3);
    expect(changedFilesBetween(before, before)).toBe(0);
    expect(changedFilesBetween(null, after)).toBe(null);
    expect(changedFilesBetween(before, null)).toBe(null);
  });
});
