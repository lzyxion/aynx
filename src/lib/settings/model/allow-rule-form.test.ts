import { describe, expect, it } from "vitest";
import { cleanAllowRules, sameAllowRules } from "$lib/settings-codec";
import {
  denyItemOk,
  emptyForm,
  formToRule,
  hasErrors,
  isWideRule,
  joinList,
  ruleToForm,
  splitList,
  validateForm,
  validatePattern,
} from "./allow-rule-form";
import type { AllowRule } from "./schema";

describe("splitList / joinList", () => {
  it("쉼표·공백 어느 쪽으로도 나누고 빈 조각은 버린다(순서·중복 그대로)", () => {
    expect(splitList(" -f, --follow  -F,,-f ")).toEqual(["-f", "--follow", "-F", "-f"]);
    expect(splitList("")).toEqual([]);
    expect(joinList(["a", "b"])).toBe("a, b");
    expect(joinList(undefined)).toBe("");
  });
});

describe("ruleToForm → formToRule — 손대지 않으면 그대로", () => {
  const cases: AllowRule[] = [
    { exec: "df", subcommands: [] },
    { exec: "git", subcommands: ["branch", "status"] }, // 옛 모양 — sub_first 없음
    { exec: "journalctl", subcommands: [], deny_flags: ["-f", "--follow", "--vacuum-*"] },
    {
      exec: "git",
      subcommands: ["branch"],
      allow_flags: ["-a", "--list"],
      max_args: 0,
      sub_first: true,
    },
    { exec: "date", subcommands: [], first_arg: ["+*"], max_args: 1, require_flags: ["-u"] },
    // 손으로 적은 이상한 항목 — 공백·쉼표가 든 낱말도 왕복에서 바뀌지 않는다
    { exec: "x", subcommands: ["a b"], first_arg: ["c,d"] },
    // 하위 명령 없이 sub_first 만 있는 손 파일 — 지우지 않는다
    { exec: "y", subcommands: [], sub_first: true },
  ];
  for (const r of cases) {
    it(`${JSON.stringify(r)}`, () => {
      const back = formToRule(ruleToForm(r), r);
      expect(back).toEqual(r);
      expect(sameAllowRules([back], [r])).toBe(true);
      // 저장 코덱을 지나도 같다
      expect(sameAllowRules(cleanAllowRules([back]), cleanAllowRules([r]))).toBe(true);
    });
  }

  it("옛 규칙은 sub_first 가 꺼진 채로 보이고, 다른 칸만 고쳐도 sub_first 가 생기지 않는다", () => {
    const old: AllowRule = { exec: "git", subcommands: ["branch"] };
    const f = ruleToForm(old);
    expect(f.sub_first).toBe(false);
    f.deny_flags = "-D";
    expect(formToRule(f, old)).toEqual({ exec: "git", subcommands: ["branch"], deny_flags: ["-D"] });
  });

  it("고친 칸만 바뀐다 — 손 파일의 이상한 항목은 다른 칸을 고쳐도 남는다", () => {
    const r: AllowRule = { exec: "x", subcommands: ["a b"], first_arg: ["c,d"] };
    const f = ruleToForm(r);
    f.max_args = "2";
    expect(formToRule(f, r)).toEqual({ exec: "x", subcommands: ["a b"], first_arg: ["c,d"], max_args: 2 });
  });

  it("체크를 끄면 sub_first 가 빠지고, 칸을 비우면 그 칸이 빠진다", () => {
    const r: AllowRule = { exec: "git", subcommands: ["log"], deny_flags: ["--output*"], max_args: 3, sub_first: true };
    const f = ruleToForm(r);
    f.sub_first = false;
    f.deny_flags = "";
    f.max_args = "";
    expect(formToRule(f, r)).toEqual({ exec: "git", subcommands: ["log"] });
  });
});

describe("새 규칙", () => {
  it("빈 폼은 하위 명령 바로 다음(sub_first)이 켜져 있다", () => {
    expect(emptyForm().sub_first).toBe(true);
  });
  it("하위 명령이 있으면 sub_first 를 싣고, 없으면 싣지 않는다", () => {
    const f = { ...emptyForm(), exec: " kubectl ", subcommands: "get, describe", deny_flags: "-w --watch*" };
    expect(formToRule(f)).toEqual({
      exec: "kubectl",
      subcommands: ["get", "describe"],
      deny_flags: ["-w", "--watch*"],
      sub_first: true,
    });
    expect(formToRule({ ...emptyForm(), exec: "uptime" })).toEqual({ exec: "uptime", subcommands: [] });
  });
  it("인자 수 0 은 '인자 없이' 로 실린다", () => {
    expect(formToRule({ ...emptyForm(), exec: "hostname", max_args: "0" }).max_args).toBe(0);
  });
});

describe("validateForm", () => {
  const v = (patch: Partial<ReturnType<typeof emptyForm>>) => validateForm({ ...emptyForm(), exec: "git", ...patch });
  it("통과", () => {
    expect(hasErrors(v({ subcommands: "status", deny_flags: "-f, --follow*", allow_flags: "-a", max_args: "0" }))).toBe(false);
  });
  it("exec — 빈칸 · 공백 · 경로", () => {
    expect(v({ exec: "  " }).exec?.code).toBe("exec_empty");
    expect(v({ exec: "git log" }).exec?.code).toBe("exec_space");
    expect(v({ exec: "/usr/bin/git" }).exec?.code).toBe("exec_slash");
  });
  it("하위 명령이 플래그 모양이면 오류", () => {
    expect(v({ subcommands: "status, -C" }).subcommands).toEqual({ code: "sub_flag", item: "-C" });
  });
  it("금지 플래그 형식 — policy 의 deny_pattern_ok 와 같다", () => {
    expect(v({ deny_flags: "-f, follow" }).deny_flags).toEqual({ code: "bad_deny", item: "follow" });
    expect(v({ deny_flags: "--a*b" }).deny_flags?.code).toBe("bad_deny");
    expect(v({ deny_flags: "--vac*" }).deny_flags).toBeUndefined();
    expect(denyItemOk("-f")).toBe(true);
    expect(denyItemOk("--x*")).toBe(true);
    expect(denyItemOk("--x**")).toBe(false);
    expect(denyItemOk("*")).toBe(false);
  });
  it("허용·필수 플래그는 - 로 시작해야", () => {
    expect(v({ allow_flags: "-a, list" }).allow_flags).toEqual({ code: "not_flag", item: "list" });
    expect(v({ require_flags: "no-stream" }).require_flags).toEqual({ code: "not_flag", item: "no-stream" });
  });
  it("인자 수 상한 — 0–999 정수", () => {
    expect(v({ max_args: "-1" }).max_args?.code).toBe("max_args");
    expect(v({ max_args: "1.5" }).max_args?.code).toBe("max_args");
    expect(v({ max_args: "1000" }).max_args?.code).toBe("max_args");
    expect(v({ max_args: " 12 " }).max_args).toBeUndefined();
  });
});

describe("isWideRule — exec 전부 허용", () => {
  it("하위 명령도 인자 제약도 없으면 넓다", () => {
    expect(isWideRule({ exec: "df", subcommands: [] })).toBe(true);
    expect(isWideRule({ exec: "df", subcommands: [], sub_first: true })).toBe(true);
  });
  it("무엇이든 좁히면 넓지 않다", () => {
    expect(isWideRule({ exec: "git", subcommands: ["status"] })).toBe(false);
    expect(isWideRule({ exec: "tail", subcommands: [], deny_flags: ["-f"] })).toBe(false);
    expect(isWideRule({ exec: "x", subcommands: [], allow_flags: ["-a"] })).toBe(false);
    expect(isWideRule({ exec: "x", subcommands: [], require_flags: ["-l"] })).toBe(false);
    expect(isWideRule({ exec: "x", subcommands: [], first_arg: ["show"] })).toBe(false);
    expect(isWideRule({ exec: "x", subcommands: [], max_args: 0 })).toBe(false);
  });
});

describe("validatePattern", () => {
  it("빈칸 · 중복", () => {
    expect(validatePattern("  ", [])).toBe("empty");
    expect(validatePattern(" df ", ["df"])).toBe("duplicate");
    expect(validatePattern("df -h", ["df"])).toBeNull();
  });
});
