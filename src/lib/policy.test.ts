import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  commandPassesAutoPolicy,
  describeArgConstraints,
  hasShellMetachar,
  matchesAllowlist,
  matchesStructuredAllow,
  pipeStageRefused,
  proposeAllowRules,
  segmentsForAutoApproval,
  shellWords,
  shouldAutoApprove,
} from "$lib/policy";
import { BUNDLES, expandBundles } from "$lib/automation-presets";
// **타입만** 가져온다 — `settings.svelte.ts` 는 룬 모듈이라 vitest(svelte 컴파일러 없음)에서
// 런타임 import 하면 `$state` 가 터진다(vitest.config 머리말). `import type` 는 지워지므로 안전.
import type { AllowRule, AutomationPrefs } from "$lib/settings.svelte.js";

/**
 * `shouldAutoApprove` 와 조각들 — 자동 승인의 **다섯 조건**(단계 10b)을 못 박는다.
 * 이 판정이 자동으로 실행을 일으키는 유일한 관문이라 경계가 결정적이다.
 */

/** 켜진 정책 하나 — 조건별로 한 축만 어긋뜨려 본다 (기본값은 auto_approve=false 라 여기서 켠다) */
function prefs(over: Partial<AutomationPrefs> = {}): AutomationPrefs {
  return {
    auto_approve: true,
    allow_patterns: ["df", "uptime"],
    bundles: [],
    bundle_off: {},
    max_targets: 10,
    max_concurrency: 4,
    auto_max_per_window: 20,
    auto_window_secs: 300,
    approval_ttl_minutes: 30,
    notify_review_requests: true,
    notify_operation_results: true,
    audit_retention_days: 90,
    audit_output_excerpt: false,
    allow_pipes: false,
    allow: [],
    ...over,
  };
}

/**
 * exec+서브커맨드 두 규칙 — Rust `policy.rs` 의 `structured_rules()` 와 **같은 픽스처**
 * (드리프트 잠금). systemctl 은 서브커맨드 제한, df 는 개념 없음(빈 목록).
 */
function structuredRules(): AllowRule[] {
  return [
    { exec: "systemctl", subcommands: ["is-active", "status", "show"] },
    { exec: "df", subcommands: [] },
  ];
}

/**
 * 구획 분해의 진실표 — Rust `policy.rs` 의 `SEGMENT_TABLE` 과 **행 하나까지 같아야 한다**
 * (드리프트 잠금). `null` = 자동 승인 후보 아님(수동으로 떨어진다).
 */
const SEGMENT_TABLE: readonly (readonly [string, readonly string[] | null])[] = [
  // 단순 단일 명령 — 예전과 같은 판정(구획 하나).
  ["df -h", ["df -h"]],
  ["uptime", ["uptime"]],
  ["  df -h  ", ["df -h"]],
  // 체이닝 — 이번 변경의 핵심. 세 연산자 모두 나뉜다.
  ["df -h && free -m", ["df -h", "free -m"]],
  ["df -h && rm -rf /", ["df -h", "rm -rf /"]], // 분해는 되고, 위험이 뒤에서 막는다.
  ["df; ls", ["df", "ls"]],
  ["df || ls", ["df", "ls"]],
  ["cd /srv && ls -la && uptime", ["cd /srv", "ls -la", "uptime"]],
  // 따옴표 안의 연산자는 literal — 나누지 않는다.
  ['echo "a && b"', ['echo "a && b"']],
  ["echo 'a; b'", ["echo 'a; b'"]],
  ['echo "a\\"b"', ['echo "a\\"b"']], // `\"` 이스케이프는 닫힘이 아니다.
  // 파이프·리다이렉트 — 구획 안에서도 여전히 탈락.
  ["df | sh", null],
  ["df | grep x", null],
  ["df > x", null],
  ["cat < in", null],
  ["df -h && ls > out", null],
  // 치환 — 어디에 있든(따옴표 안에서도) 탈락. `$` 는 통째로 막는다.
  ["df $(x)", null],
  ["echo $HOME", null],
  ["echo `whoami`", null],
  ['echo "$HOME"', null],
  ["echo '$HOME'", null],
  // 묶음·그룹·이스케이프·개행.
  ["(cd /tmp)", null],
  ["{ df; }", null],
  ["df\\", null],
  ["df\nrm", null],
  ["df\rrm", null],
  // 백그라운드 `&` — `&&` 의 일부가 아닌 홑 `&` 는 탈락.
  ["df & ls", null],
  ["df &", null],
  ["df -h & ", null],
  // 안 닫힌 따옴표.
  ['echo "a', null],
  ["echo 'a", null],
  ['echo "a\\"', null], // `\"` 를 먹어 치워 따옴표가 안 닫힌다.
  // 빈 구획.
  ["a &&", null],
  ["&& a", null],
  ["df ;; ls", null],
  ["df;", null],
  ["", null],
  ["   ", null],
];

describe("segmentsForAutoApproval — Rust policy.rs 와 같은 표", () => {
  it.each(SEGMENT_TABLE.map(([cmd, want]) => ({ cmd, want })))(
    "$cmd",
    ({ cmd, want }) => {
      const got = segmentsForAutoApproval(cmd);
      if (want === null) expect(got, cmd).toBeNull();
      else expect(got, cmd).toEqual([...want]);
    },
  );
});

describe("hasShellMetachar — 이제 `cwd` 그물로만 남은 옛 규칙", () => {
  it("체이닝·리다이렉트·치환·묶음·개행·이스케이프를 잡는다", () => {
    for (const cmd of [
      "df; rm -rf /",
      "df | grep x",
      "df && ls",
      "echo `whoami`",
      "echo $HOME",
      "ls > out",
      "cat < in",
      "(cd /tmp)",
      "df\nrm",
      "df\\",
    ]) {
      expect(hasShellMetachar(cmd), cmd).toBe(true);
    }
  });

  it("단순 단일 명령은 메타문자가 없다", () => {
    for (const cmd of ["df -h", "uptime", "ls -la /var/log", "systemctl status nginx"]) {
      expect(hasShellMetachar(cmd), cmd).toBe(false);
    }
  });
});

describe("matchesAllowlist", () => {
  it("단어 경계 prefix — 정확히 일치·뒤가 공백만 매칭", () => {
    expect(matchesAllowlist("df", ["df"])).toBe(true);
    expect(matchesAllowlist("df -h", ["df"])).toBe(true);
    // 부분 문자열은 안 된다 (dfx 는 df 가 아니다).
    expect(matchesAllowlist("dfx", ["df"])).toBe(false);
    expect(matchesAllowlist("diff a b", ["df"])).toBe(false);
  });

  it("빈 패턴은 무엇도 매칭하지 않는다 (모든 명령 매칭 사고 방지)", () => {
    expect(matchesAllowlist("df -h", ["", "   "])).toBe(false);
    expect(matchesAllowlist("df -h", [])).toBe(false);
  });
});

describe("matchesStructuredAllow (A4b) — Rust policy.rs 와 같은 픽스처", () => {
  it("exec+서브커맨드로 매칭한다", () => {
    const r = structuredRules();
    // 서브커맨드가 목록에 있으면 통과.
    expect(matchesStructuredAllow("systemctl is-active nginx", r)).toBe(true);
    expect(matchesStructuredAllow("systemctl status nginx", r)).toBe(true);
    // 목록에 없는 서브커맨드는 불가(restart 는 위임 안 함).
    expect(matchesStructuredAllow("systemctl restart nginx", r)).toBe(false);
    // 빈 subcommands 규칙(df)은 exec 만 맞으면 통과(플래그 무엇이든).
    expect(matchesStructuredAllow("df -h", r)).toBe(true);
    expect(matchesStructuredAllow("df", r)).toBe(true);
    // basename 비교 — 절대 경로도 exec 로 인정.
    expect(matchesStructuredAllow("/usr/bin/systemctl status", r)).toBe(true);
    // 플래그 토큰은 건너뛴다 — `--user` 를 건너 subcommand=status.
    expect(matchesStructuredAllow("systemctl --user status", r)).toBe(true);
    // 서브커맨드가 없는 systemctl(개념 있는 규칙)은 부재라 불가.
    expect(matchesStructuredAllow("systemctl --user", r)).toBe(false);
    // 모르는 exec → false.
    expect(matchesStructuredAllow("apt-get install foo", r)).toBe(false);
    // 빈 명령 → false.
    expect(matchesStructuredAllow("", r)).toBe(false);
    expect(matchesStructuredAllow("   ", r)).toBe(false);
  });
});

describe("shouldAutoApprove — 다섯 조건", () => {
  it("모두 충족하면 true", () => {
    expect(shouldAutoApprove("df -h", 3, prefs())).toBe(true);
    expect(shouldAutoApprove("uptime", 1, prefs())).toBe(true);
  });

  it("auto_approve 가 꺼져 있으면 false (기본 끔)", () => {
    expect(shouldAutoApprove("df -h", 1, prefs({ auto_approve: false }))).toBe(false);
    // 기본 정책(auto_approve=false·빈 목록)은 꺼져 있다.
    expect(
      shouldAutoApprove("df -h", 1, {
        auto_approve: false,
        allow_patterns: [],
        bundles: [],
        bundle_off: {},
        max_targets: 10,
        max_concurrency: 4,
        auto_max_per_window: 20,
        auto_window_secs: 300,
        approval_ttl_minutes: 30,
        notify_review_requests: true,
        notify_operation_results: true,
        audit_retention_days: 90,
        audit_output_excerpt: false,
        allow_pipes: false,
        allow: [],
      }),
    ).toBe(false);
  });

  it("위험(dangerous) 명령은 allowlist 에 있어도 false — ②가 ③을 이긴다", () => {
    // rm 은 위험 패턴. allowlist 에 "rm" 을 넣어 두어도 자동 승인되면 안 된다.
    expect(shouldAutoApprove("rm file", 1, prefs({ allow_patterns: ["rm"] }))).toBe(false);
    // 리다이렉트가 붙은 안전 동사도 classifyRisk 가 위험으로 본다(그리고 메타문자로도 걸린다).
    expect(shouldAutoApprove("echo hi > out", 1, prefs({ allow_patterns: ["echo"] }))).toBe(false);
  });

  it("셸 메타문자가 있으면 false — allowlist 우회 차단", () => {
    // 파이프·리다이렉트·치환은 구획 안에서도 여전히 탈락한다.
    expect(shouldAutoApprove("df | cat", 1, prefs())).toBe(false);
    expect(shouldAutoApprove("df > out", 1, prefs())).toBe(false);
    expect(shouldAutoApprove("df $(x)", 1, prefs())).toBe(false);
    // 체이닝은 이제 분해되지만, 목록에 없는 구획(`ls`)이 있으면 그 구획이 전체를 끌어내린다.
    expect(shouldAutoApprove("df; ls", 1, prefs())).toBe(false);
  });

  /** 체이닝 — Rust `policy.rs` 의 같은 이름 테스트와 **같은 표**(드리프트 잠금). */
  it("체이닝은 구획마다 판정한다 — 가장 약한 구획이 전체를 끌어내린다", () => {
    // 평탄 목록에 다섯 동사를 열어 둔다(체이닝 표를 돌리기 위한 픽스처).
    const open = ["df", "uptime", "free", "ls", "echo"];
    const p = prefs({ allow_patterns: open });

    // 모든 구획이 허용 + 안전 → 자동 승인.
    expect(shouldAutoApprove("df -h && free -m", 1, p)).toBe(true);
    expect(shouldAutoApprove("df; ls", 1, p)).toBe(true);
    expect(shouldAutoApprove("df || ls", 1, p)).toBe(true);
    expect(shouldAutoApprove('echo "a && b"', 1, p)).toBe(true);

    // 한 구획이라도 위험하면 전체가 거부(바닥은 그대로).
    expect(shouldAutoApprove("df -h && rm -rf /", 1, p)).toBe(false);
    // 한 구획이라도 목록 밖이면 전체가 거부.
    expect(shouldAutoApprove("df -h && whoami", 1, p)).toBe(false);
    // 구획 안의 파이프·리다이렉트·치환·백그라운드·안 닫힌 따옴표·빈 구획은 전체를 거부.
    expect(shouldAutoApprove("df | sh", 1, p)).toBe(false);
    expect(shouldAutoApprove("df > x", 1, p)).toBe(false);
    expect(shouldAutoApprove("df $(x)", 1, p)).toBe(false);
    expect(shouldAutoApprove('echo "a', 1, p)).toBe(false);
    expect(shouldAutoApprove("a &&", 1, p)).toBe(false);
    expect(shouldAutoApprove("df & ls", 1, p)).toBe(false);

    // `cd` 는 그냥 또 하나의 실행 파일이다 — 목록에 없으면 체이닝 전체가 수동으로 간다.
    expect(shouldAutoApprove("cd /srv && ls", 1, p)).toBe(false);
    expect(shouldAutoApprove("cd /srv && ls", 1, prefs({ allow_patterns: [...open, "cd"] }))).toBe(
      true,
    );
  });

  it("allowlist 에 없으면 false", () => {
    expect(shouldAutoApprove("ls -la", 1, prefs())).toBe(false);
    // 안전하고 메타문자도 없지만 목록에 없다.
    expect(shouldAutoApprove("whoami", 1, prefs())).toBe(false);
  });

  it("대상 수가 상한을 넘으면 false", () => {
    expect(shouldAutoApprove("df -h", 10, prefs({ max_targets: 10 }))).toBe(true);
    expect(shouldAutoApprove("df -h", 11, prefs({ max_targets: 10 }))).toBe(false);
  });

  it("구조적 규칙(A4b)으로도 통과하고, 바닥(floor)은 그대로 AND", () => {
    // 평탄 목록은 비우고 구조적 규칙만 켠다 — 게이트가 flat OR structured 임을 못 박는다.
    const p = prefs({ allow_patterns: [], allow: structuredRules() });
    expect(shouldAutoApprove("systemctl is-active nginx", 3, p)).toBe(true);
    // 목록에 없는 서브커맨드는 구조적으로도 매칭 안 됨.
    expect(shouldAutoApprove("systemctl start nginx", 1, p)).toBe(false);
    // 바닥은 그대로 AND: 위험(systemctl restart)·메타문자·상한 초과는 규칙이 있어도 거부.
    expect(shouldAutoApprove("systemctl restart nginx", 1, p)).toBe(false);
    // 구획 분해가 돼도 둘째 구획(`rm -rf /`)이 위험이자 목록 밖이라 전체가 거부된다.
    expect(shouldAutoApprove("df -h; rm -rf /", 1, p)).toBe(false);
    expect(shouldAutoApprove("df -h", 11, p)).toBe(false);
  });

  it("평탄 prefix 와 구조적 규칙은 OR 로 더해진다", () => {
    const p = prefs({ allow: structuredRules() }); // allow_patterns=[df,uptime] + 구조적
    expect(shouldAutoApprove("uptime", 1, p)).toBe(true); // 평탄
    expect(shouldAutoApprove("systemctl status nginx", 1, p)).toBe(true); // 구조적
  });

  /** 묶음(bundle) — Rust `policy.rs` 의 같은 이름 테스트와 짝(드리프트 잠금). */
  it("켜진 묶음의 규칙이 먹고, 바닥은 그대로다", () => {
    const off = prefs({ allow_patterns: [] });
    expect(shouldAutoApprove("systemctl status nginx", 1, off)).toBe(false);

    const p = prefs({ allow_patterns: [], bundles: ["services", "system"] });
    expect(shouldAutoApprove("systemctl status nginx", 1, p)).toBe(true);
    expect(shouldAutoApprove("df -h", 1, p)).toBe(true);
    expect(shouldAutoApprove("df -h && free -m", 1, p)).toBe(true);

    // 묶음은 목록을 넓힐 뿐 문을 열지 않는다.
    expect(shouldAutoApprove("systemctl restart nginx", 1, p)).toBe(false); // 위험
    expect(shouldAutoApprove("apt-get install x", 1, p)).toBe(false); // 묶음 밖
    expect(shouldAutoApprove("git status", 1, p)).toBe(false); // 다른 묶음
    expect(shouldAutoApprove("df | sh", 1, p)).toBe(false); // 파이프
    expect(shouldAutoApprove("df -h", 11, p)).toBe(false); // 상한
    expect(shouldAutoApprove("df -h", 1, { ...p, auto_approve: false })).toBe(false); // 토글

    // 모르는 id 는 아무 규칙도 열지 않는다(설정은 보존된다).
    expect(
      shouldAutoApprove("df -h", 1, prefs({ allow_patterns: [], bundles: ["from-the-future"] })),
    ).toBe(false);
  });
});

/**
 * `proposeAllowRules` — "승인하면서 배우기" 의 제안기
 * (docs/log/2026-09-16-auto-approval-bundles.md). 제안은 **exec + 서브커맨드 하나**까지다.
 */
describe("proposeAllowRules", () => {
  it("서브커맨드처럼 보이는 둘째 토큰을 잡는다", () => {
    expect(proposeAllowRules("systemctl is-active nginx", [])).toEqual([
      { exec: "systemctl", subcommands: ["is-active"] },
    ]);
    expect(proposeAllowRules("git status", [])).toEqual([{ exec: "git", subcommands: ["status"] }]);
  });

  it("플래그·경로·숫자만이면 exec 만 제안한다", () => {
    expect(proposeAllowRules("df -h", [])).toEqual([{ exec: "df", subcommands: [] }]);
    expect(proposeAllowRules("uptime", [])).toEqual([{ exec: "uptime", subcommands: [] }]);
    expect(proposeAllowRules("ls /var/log", [])).toEqual([{ exec: "ls", subcommands: [] }]);
    // 한계: 둘째 토큰이 플래그면 exec 이 통째로 열린다(미리보기가 이 사실을 보여 준다).
    expect(proposeAllowRules("systemctl --user status", [])).toEqual([
      { exec: "systemctl", subcommands: [] },
    ]);
  });

  it("첫 토큰의 basename 을 exec 으로 쓴다", () => {
    expect(proposeAllowRules("/usr/bin/df -h", [])).toEqual([{ exec: "df", subcommands: [] }]);
  });

  it("구획마다 제안하고, 같은 exec 은 한 규칙으로 모인다", () => {
    expect(proposeAllowRules("df -h && free -m", [])).toEqual([
      { exec: "df", subcommands: [] },
      { exec: "free", subcommands: [] },
    ]);
    expect(proposeAllowRules("git status && git log", [])).toEqual([
      { exec: "git", subcommands: ["status", "log"] },
    ]);
    // 넓은 쪽(빈 목록 = exec 전체)이 이긴다.
    expect(proposeAllowRules("git status && git -C /srv", [])).toEqual([
      { exec: "git", subcommands: [] },
    ]);
  });

  it("이미 먹는 규칙은 다시 제안하지 않는다 (사용자 규칙 · 묶음 모두)", () => {
    // exec 전체가 열려 있으면 아무것도 제안하지 않는다.
    expect(proposeAllowRules("df -h", [{ exec: "df", subcommands: [] }])).toEqual([]);
    // 서브커맨드가 이미 있으면 그 구획은 건너뛰고 나머지만 제안한다.
    expect(
      proposeAllowRules("git status && git log", [{ exec: "git", subcommands: ["status"] }]),
    ).toEqual([{ exec: "git", subcommands: ["log"] }]);
    // 묶음이 펼친 규칙도 같은 `existing` 으로 들어온다.
    expect(proposeAllowRules("df -h && free -m", expandBundles(["system"]))).toEqual([]);
  });

  it("위험한 구획이 하나라도 있으면 아무것도 제안하지 않는다", () => {
    expect(proposeAllowRules("rm -rf /tmp/x", [])).toEqual([]);
    expect(proposeAllowRules("df -h && rm -rf /", [])).toEqual([]);
    expect(proposeAllowRules("sudo systemctl status nginx", [])).toEqual([]);
  });

  it("토크나이저가 떨어뜨린 명령은 제안 대상이 아니다", () => {
    for (const cmd of ["df | grep x", "df > out", "echo $HOME", "(cd /tmp)", 'echo "a', "a &&", ""]) {
      expect(proposeAllowRules(cmd, []), cmd).toEqual([]);
    }
  });

  it("제안을 넣으면 그 명령이 실제로 통과한다 (제안이 헛돌지 않는다)", () => {
    const base = prefs({ allow_patterns: [], allow: [] });
    expect(commandPassesAutoPolicy("systemctl is-active nginx", base)).toBe(false);
    const learned = proposeAllowRules("systemctl is-active nginx", []);
    expect(commandPassesAutoPolicy("systemctl is-active nginx", { ...base, allow: learned })).toBe(
      true,
    );
  });
});

/**
 * 인자 제약 — `src-tauri/src/policy/args_cases.json` **공유 표**(Rust `policy/tests.rs` 가 같은
 * 파일을 읽는다 — 한쪽 구현만 고치면 다른 쪽이 깨진다). docs/log/2026-10-05-auto-approve-args.md.
 */
describe("인자 제약 (공유 표 args_cases.json)", () => {
  const ARGS_CASES = fileURLToPath(new URL("../../src-tauri/src/policy/args_cases.json", import.meta.url));
  const table = JSON.parse(readFileSync(ARGS_CASES, "utf8")) as {
    bundles: { deny: string[]; allow: string[] };
    split: { deny: [string, string][]; allow: [string, string][] };
    rules: { rules: AllowRule[]; cases: [string, boolean][] }[];
    words: [string, string[] | null][];
  };
  // 묶음 열 개를 전부 켠다(세분화 전에는 옛 두 묶음이었다 — 같은 표가 그대로 통한다).
  const bundlePrefs = prefs({ allow_patterns: [], bundles: BUNDLES.map((b) => b.id) });

  it("표를 실제로 읽었다", () => {
    expect(table.bundles.deny.length).toBeGreaterThan(50);
    expect(table.bundles.allow.length).toBeGreaterThan(50);
  });

  it("기본 묶음 — 쓰기·끝나지 않는 명령은 전부 거부", () => {
    for (const cmd of table.bundles.deny) expect(commandPassesAutoPolicy(cmd, bundlePrefs), cmd).toBe(false);
  });

  it("기본 묶음 — 의도한 읽기는 전부 허용", () => {
    for (const cmd of table.bundles.allow) expect(commandPassesAutoPolicy(cmd, bundlePrefs), cmd).toBe(true);
  });

  it("세분화 — 위험 예시는 전부 켜도 거부, 대표 조회는 그 묶음 하나만 켜도 허용", () => {
    expect(table.split.deny.length).toBeGreaterThan(80);
    for (const [, cmd] of table.split.deny) expect(commandPassesAutoPolicy(cmd, bundlePrefs), cmd).toBe(false);
    for (const [bundle, cmd] of table.split.allow) {
      expect(commandPassesAutoPolicy(cmd, prefs({ allow_patterns: [], bundles: [bundle] })), `${bundle}: ${cmd}`).toBe(true);
    }
  });

  it("묶음 안 끈 명령은 수동으로 — 같은 키의 줄은 함께, 다른 명령은 그대로 (Rust 와 짝)", () => {
    const p = prefs({
      allow_patterns: [],
      bundles: ["files", "docker"],
      bundle_off: { files: ["cat"], docker: ["docker compose"], nope: ["ls"] },
    });
    expect(commandPassesAutoPolicy("cat /etc/hosts", p)).toBe(false);
    expect(commandPassesAutoPolicy("ls -la", p)).toBe(true);
    expect(commandPassesAutoPolicy("docker compose ps", p)).toBe(false);
    expect(commandPassesAutoPolicy("docker compose logs --tail 5", p)).toBe(false);
    expect(commandPassesAutoPolicy("docker ps", p)).toBe(true);
    expect(commandPassesAutoPolicy("ls && cat x", p)).toBe(false);
  });

  it("규칙별 판정 — 옛 모양 하위 호환과 새 칸 다섯", () => {
    for (const g of table.rules) {
      for (const [cmd, want] of g.cases) {
        expect(matchesStructuredAllow(cmd, g.rules), `${cmd} · ${JSON.stringify(g.rules)}`).toBe(want);
      }
    }
  });

  it("따옴표 벗긴 낱말", () => {
    for (const [input, want] of table.words) expect(shellWords(input), input).toEqual(want);
  });
});

describe("describeArgConstraints — 칩 문구 조각", () => {
  it("제약이 없으면 빈 목록", () => {
    expect(describeArgConstraints({ exec: "df", subcommands: [] })).toEqual([]);
  });

  it("칸마다 한 조각, 정해진 순서", () => {
    expect(
      describeArgConstraints({
        exec: "x",
        subcommands: [],
        first_arg: ["show", "list"],
        max_args: 0,
        allow_flags: ["-a"],
        require_flags: ["--no-stream"],
        deny_flags: ["-f", "--follow"],
      }),
    ).toEqual([
      { kind: "first_arg", items: ["show", "list"] },
      { kind: "no_args", items: [] },
      { kind: "require", items: ["--no-stream"] },
      { kind: "allow", items: ["-a"] },
      { kind: "deny", items: ["-f", "--follow"] },
    ]);
    expect(describeArgConstraints({ exec: "x", subcommands: [], max_args: 2 })).toEqual([
      { kind: "max_args", items: ["2"] },
    ]);
  });
});

/**
 * 파이프 허용(10-22 옵트인 · `allow_pipes`) — 공유 표 `args_cases.json` 의 `pipes`(Rust `policy/tests.rs` 가 같은 표를 읽는다).
 * 끄면 예전과 같고, 켜면 단계마다 허용 · 다른 명령을 실행하는 단계는 늘 거절.
 */
describe("파이프 허용 (공유 표 args_cases.json · pipes)", () => {
  const ARGS_CASES = fileURLToPath(new URL("../../src-tauri/src/policy/args_cases.json", import.meta.url));
  const table = JSON.parse(readFileSync(ARGS_CASES, "utf8")) as {
    pipes: { allow: string[]; off: { pass: string[]; fail: string[] }; on: { pass: string[]; fail: string[] } };
  };
  const off = prefs({ allow_patterns: table.pipes.allow, allow_pipes: false });
  const on = prefs({ allow_patterns: table.pipes.allow, allow_pipes: true });

  it("끄면 예전 그대로 — 파이프는 사람 승인", () => {
    for (const cmd of table.pipes.off.pass) expect(commandPassesAutoPolicy(cmd, off), cmd).toBe(true);
    for (const cmd of table.pipes.off.fail) expect(commandPassesAutoPolicy(cmd, off), cmd).toBe(false);
    expect(shouldAutoApprove("uptime | cat", 1, off)).toBe(false);
  });

  it("켜면 단계마다 — 실행기 단계 · 리다이렉트 · ; · || 섞임은 늘 사람 승인", () => {
    for (const cmd of table.pipes.on.pass) expect(commandPassesAutoPolicy(cmd, on), cmd).toBe(true);
    for (const cmd of table.pipes.on.fail) expect(commandPassesAutoPolicy(cmd, on), cmd).toBe(false);
    expect(shouldAutoApprove("uptime | cat", 1, on)).toBe(true);
    const wide = prefs({ allow_patterns: [...table.pipes.allow, "xargs", "sh", "tee", "rm", "env"], allow_pipes: true });
    for (const cmd of ["cat x | sh", "ls | xargs rm", "ps | tee f", "ls | env cat", "ls | sort > f", "uptime || ls | cat"]) {
      expect(commandPassesAutoPolicy(cmd, wide), cmd).toBe(false);
    }
    expect(pipeStageRefused("find . -exec rm {} +")).toBe(true);
    expect(pipeStageRefused("sort -rh")).toBe(false);
  });
});

