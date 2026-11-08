import { describe, expect, it, vi } from "vitest";

// 이 모듈은 invoke 만 끌어온다 — 문구 함수(reasonText)는 순수라 가짜 t 로 고정한다.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { reasonText } from "./auto-approval-test";
import { settings as koSettings } from "$lib/i18n/ko/settings";

/** 가짜 t — 키(앞머리를 뗀)와 인자를 그대로 보여 준다. */
const tr = (key: string, args?: Record<string, string | number>) =>
  `${key.replace("settings.automation.test.", "")}${args ? JSON.stringify(args) : ""}`;
const name = (id: string) => `<${id}>`;

describe("reasonText — 시험 칸의 이유 문구", () => {
  it("묶음 id 는 화면 이름으로 바꿔 끼운다", () => {
    expect(reasonText({ code: "match_bundle", args: { bundle: "files", key: "cat", segment: "cat x" } }, tr, name)).toBe(
      'reason.match_bundle{"bundle":"<files>","key":"cat","segment":"cat x"}',
    );
  });

  it("인자 제약은 칸 문구를 먼저 만들어 묶음/규칙 문장에 넣는다", () => {
    const s = reasonText({ code: "constraint", args: { bundle: "files", key: "tail", kind: "deny", item: "-f" } }, tr, name);
    expect(s.startsWith("reason.constraint.bundle")).toBe(true);
    expect(s).toContain('"detail":"kind.deny');
    expect(s).toContain("<files>");
    const r = reasonText({ code: "constraint", args: { exec: "mytool", kind: "max_args", n: "0" } }, tr, name);
    expect(r.startsWith("reason.constraint.rule")).toBe(true);
  });

  it("모르는 코드는 코드 그대로", () => {
    expect(reasonText({ code: "nope", args: {} }, (k) => k, name)).toBe("nope");
  });

  // 10-22 — 검토 카드의 "자동 승인 안 됨" 칩(서버 `autoWhy`)이 쓰는 두 코드도 사전에 있다(없으면 코드 글자가 화면에 그대로 선다).
  it("검토 카드용 코드(auto_off · max_targets)는 실제 사전으로 문장이 된다", () => {
    const real = (key: string, args?: Record<string, string | number>) => {
      const k = key.replace("settings.", "") as keyof typeof koSettings;
      let v: string = koSettings[k] ?? key;
      for (const [a, b] of Object.entries(args ?? {})) v = v.replace(`{${a}}`, String(b));
      return v;
    };
    expect(reasonText({ code: "auto_off", args: {} }, real, name)).toContain("꺼져");
    expect(reasonText({ code: "max_targets", args: { n: "12", max: "10" } }, real, name)).toBe("대상 12곳 — 자동 승인 상한 10곳을 넘습니다");
    expect(reasonText({ code: "split_pipe", args: {} }, real, name)).toContain("파이프(|) 허용");
    expect(reasonText({ code: "pipe_stage", args: { segment: "cat" } }, real, name)).toBe("파이프 단계 ‘cat’ 가 허용 범위 밖입니다");
  });
});
