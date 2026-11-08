import { describe, expect, it, vi } from "vitest";

// `src/test/setup.ts` 가 다른 시험을 위해 곧바로 취소하는 스텁을 건다 — 여기는 진짜 줄 · 결과를 본다.
vi.unmock("$lib/app/confirm-dialog.svelte.js");
// 모듈 상태 — 컴파일러 없이 평범한 값으로(`tabs.test.ts` 와 같은 관례). 줄은 통째로 갈아 끼우므로 `$state.raw` 도 값 그대로.
vi.hoisted(() => {
  const state = <T>(value: T) => value;
  vi.stubGlobal("$state", Object.assign(state, { raw: state }));
});
vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string) => key }));

import {
  ackBlocks,
  answerConfirm,
  askChoice,
  askConfirm,
  askHookInstall,
  cancelResult,
  confirmAcked,
  confirmDialogOpen,
  currentConfirm,
  dismissConfirm,
  initialChoice,
  setConfirmAcked,
  showMessage,
} from "./confirm-dialog.svelte.js";

/** 지금 떠 있는 상자에서 `result` 단추를 누른다 */
function press(result: string): void {
  const req = currentConfirm();
  expect(req?.choices.some((c) => c.result === result)).toBe(true);
  answerConfirm(result);
}

describe("확인 상자 — 결과", () => {
  it("[확인] = true · [취소] = false · Escape · 바깥 누르기 = false", async () => {
    const a = askConfirm("본문");
    expect(confirmDialogOpen()).toBe(true);
    press("Ok");
    expect(await a).toBe(true);
    expect(confirmDialogOpen()).toBe(false);

    const b = askConfirm("본문");
    press("Cancel");
    expect(await b).toBe(false);

    const c = askConfirm("본문");
    dismissConfirm();
    expect(await c).toBe(false);
  });

  it("라벨 · 제목 · 종류를 그대로 싣고, 기본 라벨은 앱 문구다", async () => {
    const p = askConfirm("지울까요?", { title: "삭제", kind: "warning", okLabel: "지우기", cancelLabel: "그만" });
    const req = currentConfirm()!;
    expect(req).toMatchObject({ title: "삭제", body: "지울까요?", kind: "warning" });
    expect(req.choices.map((c) => c.label)).toEqual(["그만", "지우기"]);
    dismissConfirm();
    await p;

    const q = askConfirm("x");
    expect(currentConfirm()!.choices.map((c) => c.label)).toEqual(["app.actions.cancel", "app.confirmDialog.ok"]);
    expect(currentConfirm()!.kind).toBe("info");
    dismissConfirm();
    await q;
  });

  it("알림은 단추 하나 — Escape 로도 닫힌다", async () => {
    const m = showMessage("끝났습니다", { title: "알림" });
    expect(currentConfirm()!.choices).toHaveLength(1);
    dismissConfirm();
    await expect(m).resolves.toBeUndefined();
    expect(confirmDialogOpen()).toBe(false);
  });

  it("단추 셋 — Yes · No · Cancel(Escape 는 Cancel)", async () => {
    const opts = { yesLabel: "저장", noLabel: "버리기", cancelLabel: "취소" };
    const a = askChoice("x", opts);
    press("Yes");
    expect(await a).toBe("Yes");
    const b = askChoice("x", opts);
    press("No");
    expect(await b).toBe("No");
    const c = askChoice("x", opts);
    dismissConfirm();
    expect(await c).toBe("Cancel");
  });
});

describe("훅 설치 확인", () => {
  it("상세를 싣고 첫 포커스는 [설치] · [설치] = true · Escape = false", async () => {
    const hooks = { remote: "dev-01", scriptPath: "/s.sh", settingsPath: "/settings.json", preview: "{}" };
    const a = askHookInstall("Claude", hooks);
    const req = currentConfirm()!;
    expect(req.hooks).toEqual(hooks);
    expect(req.choices[req.focus].result).toBe("Ok");
    press("Ok");
    expect(await a).toBe(true);

    const b = askHookInstall("Claude", { ...hooks, remote: null });
    dismissConfirm();
    expect(await b).toBe(false);
  });
});

describe("확인 상자 — 줄", () => {
  it("동시에 물으면 하나씩 — 앞의 답이 뒤로 새지 않는다", async () => {
    const first = askConfirm("하나");
    const second = askConfirm("둘");
    const third = showMessage("셋");
    expect(currentConfirm()!.body).toBe("하나");
    press("Ok");
    expect(await first).toBe(true);
    expect(currentConfirm()!.body).toBe("둘");
    dismissConfirm();
    expect(await second).toBe(false);
    expect(currentConfirm()!.body).toBe("셋");
    dismissConfirm();
    await third;
    expect(confirmDialogOpen()).toBe(false);
  });

  it("떠 있는 것이 없으면 답 · 닫기는 아무 일도 하지 않는다", () => {
    expect(() => answerConfirm("Ok")).not.toThrow();
    expect(() => dismissConfirm()).not.toThrow();
    expect(currentConfirm()).toBeNull();
  });
});

describe("확인 상자 — 첫 포커스 · 위험 단추", () => {
  it("일반은 [확인], 경고 · 오류 · 위험은 [취소]", async () => {
    const cases: [Parameters<typeof askConfirm>[1], string][] = [
      [{}, "Ok"],
      [{ kind: "info" }, "Ok"],
      [{ kind: "warning" }, "Cancel"],
      [{ kind: "error" }, "Cancel"],
      [{ danger: true }, "Cancel"],
    ];
    for (const [opts, want] of cases) {
      const p = askConfirm("x", opts);
      const req = currentConfirm()!;
      expect(req.choices[req.focus].result).toBe(want);
      dismissConfirm();
      await p;
    }
  });

  it("위험이면 확인 단추가 위험 색 · 아니면 강조", async () => {
    const p = askConfirm("x", { danger: true, kind: "warning" });
    expect(currentConfirm()!.choices.find((c) => c.result === "Ok")!.tone).toBe("danger");
    dismissConfirm();
    await p;
    const q = askConfirm("x", { kind: "warning" });
    expect(currentConfirm()!.choices.find((c) => c.result === "Ok")!.tone).toBe("primary");
    dismissConfirm();
    await q;
  });

  it("단추 셋 — 경고면 [취소], 아니면 강조(Yes)", async () => {
    const opts = { yesLabel: "y", noLabel: "n" };
    const p = askChoice("x", { ...opts, kind: "warning" });
    let req = currentConfirm()!;
    expect(req.choices[req.focus].result).toBe("Cancel");
    dismissConfirm();
    await p;
    const q = askChoice("x", opts);
    req = currentConfirm()!;
    expect(req.choices[req.focus].result).toBe("Yes");
    dismissConfirm();
    await q;
  });

  it("순수 조각 — 취소 쪽이 없으면 마지막 단추", () => {
    const only = [{ label: "확인", result: "Ok", tone: "primary" as const, cancel: false }];
    expect(cancelResult(only)).toBe("Ok");
    expect(initialChoice(only, "warning", false)).toBe(0);
  });
});

describe("확인 상자 — 「이해했습니다」 칸(10-23 모두 승인)", () => {
  it("칸이 있으면 체크 전에는 [확인] 이 답이 되지 않고 · 취소는 언제나 · 체크는 상자마다 처음엔 꺼짐", async () => {
    const p = askConfirm("본문", { ack: "이해했습니다", points: ["a", "b"], variant: "approve-all", danger: true, kind: "warning" });
    const req = currentConfirm()!;
    expect(req.points).toEqual(["a", "b"]);
    expect(req.variant).toBe("approve-all");
    expect(req.choices[req.focus].result).toBe("Cancel");
    expect(confirmAcked()).toBe(false);
    answerConfirm("Ok"); // 막힘 — 상자는 그대로
    expect(currentConfirm()).toBe(req);
    setConfirmAcked(true);
    answerConfirm("Ok");
    expect(await p).toBe(true);
    // 다음 상자는 다시 꺼진 칸
    const q = askConfirm("본문", { ack: "이해했습니다" });
    expect(confirmAcked()).toBe(false);
    answerConfirm("Cancel");
    expect(await q).toBe(false);
  });

  it("칸이 없는 상자는 예전 그대로 · 순수 판정 `ackBlocks`", async () => {
    const p = askConfirm("본문");
    answerConfirm("Ok");
    expect(await p).toBe(true);
    const ok = { cancel: false }, cancel = { cancel: true };
    expect(ackBlocks({ ack: "x" }, ok, false)).toBe(true);
    expect(ackBlocks({ ack: "x" }, ok, true)).toBe(false);
    expect(ackBlocks({ ack: "x" }, cancel, false)).toBe(false);
    expect(ackBlocks({}, ok, false)).toBe(false);
  });
});
