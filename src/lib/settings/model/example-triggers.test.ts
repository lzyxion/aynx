import { describe, expect, it } from "vitest";
import { compileTriggers, expandTemplate, matchLine, safeUrl } from "$lib/triggers";
import type { Trigger } from "$lib/triggers";
import { TRIGGER_EXAMPLES, exampleTrigger, findExample, isExampleAdded } from "./example-triggers";
import { MAX_TRIGGERS } from "./options";

/** 넣었을 때의 모양(켜진 채로) — 패턴 검사는 이 목록으로 한다 */
const EXAMPLE_TRIGGERS: Trigger[] = TRIGGER_EXAMPLES.map(exampleTrigger);

/**
 * 설정 › 트리거 **추가 하위 화면**의 예시 카드들 (docs/log/2026-10-05-trigger-examples.md).
 *
 * 패턴마다 맞는 예·안 맞는 예를 붙들고, 링크 예는 실제 치환·안전 검사(`expandTemplate` →
 * `safeUrl`)를 통과한 주소가 기대한 경로인지 본다.
 */

function byPattern(pattern: string): Trigger {
  const t = EXAMPLE_TRIGGERS.find((x) => x.pattern === pattern);
  if (!t) throw new Error(`예시 없음: ${pattern}`);
  return t;
}

/** 그 예시 하나만(켠 채로) 컴파일해 줄에서 맞은 글자들 */
function hits(t: Trigger, line: string): string[] {
  const { compiled, errors } = compileTriggers([{ ...t, enabled: true }]);
  expect(errors).toEqual([]);
  return matchLine(line, compiled).map((m) => line.slice(m.start, m.end));
}

describe("EXAMPLE_TRIGGERS — 목록 모양", () => {
  it("고른 예시는 켜진 채로, 매번 새 객체로 들어간다", () => {
    expect(TRIGGER_EXAMPLES.length).toBeGreaterThanOrEqual(14);
    for (const ex of TRIGGER_EXAMPLES) {
      const t = exampleTrigger(ex);
      expect(t.enabled).toBe(true);
      expect(t).not.toBe(exampleTrigger(ex));
      expect(t.pattern).toBe(ex.trigger.pattern);
    }
  });

  it("id 가 겹치지 않고, 이름·설명 키는 예시마다 따로다", () => {
    const ids = TRIGGER_EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(TRIGGER_EXAMPLES.map((e) => e.name)).size).toBe(ids.length);
    expect(new Set(TRIGGER_EXAMPLES.map((e) => e.desc)).size).toBe(ids.length);
    for (const id of ids) expect(findExample(id)?.id).toBe(id);
    expect(findExample("nope")).toBeUndefined();
  });

  it("패턴이 겹치지 않고, 상한 안이고, 모두 컴파일된다", () => {
    const patterns = EXAMPLE_TRIGGERS.map((t) => t.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(patterns.length).toBeLessThan(MAX_TRIGGERS);
    const on = EXAMPLE_TRIGGERS.map((t) => ({ ...t, enabled: true }));
    const { compiled, errors } = compileTriggers(on);
    expect(errors).toEqual([]);
    expect(compiled).toHaveLength(EXAMPLE_TRIGGERS.length);
  });

  it("넓은 Jira 틀은 맨 끝 — CVE·ERR 예가 먼저 이긴다", () => {
    expect(EXAMPLE_TRIGGERS.at(-1)?.pattern).toBe(String.raw`\b([A-Z]+-\d+)\b`);
    const { compiled } = compileTriggers(EXAMPLE_TRIGGERS.map((t) => ({ ...t, enabled: true })));
    const line = "CVE-2024-3094 ERR-1234 PROJ-42";
    const ms = matchLine(line, compiled);
    expect(ms.map((m) => line.slice(m.start, m.end))).toEqual(["CVE-2024-3094", "ERR-1234", "PROJ-42"]);
    expect(ms[0].url).toContain("nvd.nist.gov");
    expect(ms[2].url).toContain("jira.example.com");
  });

  it("Jira 예의 툴팁은 링크가 고쳐 쓰는 틀임을 밝힌다", () => {
    expect(byPattern(String.raw`\b([A-Z]+-\d+)\b`).tooltip).toBe("Issue $1 — edit the link to point at your Jira");
  });
});

describe("예시 카드 — 이미 있음 표시 · 샘플 줄", () => {
  const fatal = findExample("fatal")!;
  const jira = findExample("jira")!;

  it("같은 패턴이 있으면 ✓ — 켜짐/꺼짐·색은 보지 않는다", () => {
    expect(isExampleAdded([], fatal)).toBe(false);
    const mine: Trigger[] = [{ pattern: fatal.trigger.pattern, fg: "#fff", enabled: false }];
    expect(isExampleAdded(mine, fatal)).toBe(true);
    expect(isExampleAdded(mine, jira)).toBe(false);
  });

  it("예시마다 샘플 줄이 있고, 그 예시가 샘플 줄에서 실제로 걸린다(시험 칸을 미리 채우는 줄)", () => {
    for (const ex of TRIGGER_EXAMPLES) {
      expect(ex.sample.trim(), ex.id).not.toBe("");
      expect(ex.sample, ex.id).not.toContain("\n");
      expect(hits(exampleTrigger(ex), ex.sample), ex.id).not.toEqual([]);
    }
  });

  it("툴팁 값은 영어다 — settings.toml 에 적히는 값이라 표시 언어에 매이지 않는다", () => {
    for (const ex of TRIGGER_EXAMPLES) {
      if (ex.trigger.tooltip) expect(/[ㄱ-힣]/.test(ex.trigger.tooltip), ex.id).toBe(false);
    }
  });
});

describe("EXAMPLE_TRIGGERS — 패턴별 맞는 예·안 맞는 예", () => {
  const cases: [string, string[], string[]][] = [
    [String.raw`\b(FATAL|PANIC|CRITICAL)\b`, ["FATAL: db down", "kernel PANIC", "[CRITICAL] x"], ["fatal error", "PANICKED", "NONCRITICAL"]],
    [String.raw`\bFAIL(ED|URE)?\b`, ["FAIL src/a.test.ts", "Build FAILED", "FAILURE: x"], ["failed", "FAILS", "XFAIL"]],
    [String.raw`\b(PASS(ED)?|SUCCESS(FUL)?)\b`, ["PASS src/a.test.ts", "PASSED", "BUILD SUCCESSFUL", "SUCCESS"], ["passed", "PASSWORD", "success"]],
    [String.raw`\b(DEPRECATED|[Dd]eprecated)\b`, ["DEPRECATED: use y", "warning: deprecated api", "Deprecated since 2.0"], ["DEPRECATE", "undeprecated", "DeprecatedFoo"]],
    ["npm ERR!", ["npm ERR! code ENOENT"], ["npm ERR code", "npm err! x", "npm WARN"]],
    [String.raw`Traceback \(most recent call last\):`, ["Traceback (most recent call last):"], ["Traceback (most recent call first):", "traceback (most recent call last):"]],
    [String.raw`\bHTTP/\d(?:\.\d)? (5\d\d)\b`, ["HTTP/1.1 503 Service Unavailable", "HTTP/2 500"], ["HTTP/1.1 404 Not Found", "HTTP/1.1 5000", "http/1.1 500"]],
    [String.raw`\bHTTP/\d(?:\.\d)? (4\d\d)\b`, ["HTTP/1.1 404 Not Found", "HTTP/2 429"], ["HTTP/1.1 500", "HTTP/1.1 4040", "HTTP/1.1 200 OK"]],
    [
      String.raw`\b(CrashLoopBackOff|ImagePullBackOff|ErrImagePull|OOMKilled|Evicted)\b`,
      ["web-0  0/1  CrashLoopBackOff  5", "Reason: OOMKilled", "ErrImagePull", "Evicted"],
      ["Running", "crashloopbackoff", "EvictedPods"],
    ],
    [String.raw`\b(E\d{4})\b`, ["error[E0308]: mismatched types"], ["E030", "E03081", "e0308", "XE0308"]],
    [String.raw`\bCVE-\d{4}-\d{4,}\b`, ["CVE-2024-3094", "fixes CVE-2021-44228."], ["CVE-2024-123", "cve-2024-3094", "CVE-24-1234"]],
    [String.raw`\b(ERR-\d{4})\b`, ["ERR-1234 timeout"], ["ERR-123", "ERR-12345", "XERR-1234"]],
    [String.raw`\b(?:\d{1,3}\.){3}\d{1,3}\b`, ["from 192.168.0.10 port 22", "10.0.0.1"], ["1.2.3", "v1.2", "192.168.0"]],
    [String.raw`\b([A-Z]+-\d+)\b`, ["PROJ-42", "fix ABC-123"], ["abc-123", "PROJ-", "-42"]],
  ];

  for (const [pattern, yes, no] of cases) {
    it(pattern, () => {
      const t = byPattern(pattern);
      for (const line of yes) expect(hits(t, line), line).not.toEqual([]);
      for (const line of no) expect(hits(t, line), line).toEqual([]);
    });
  }

  it("모든 예시에 위 표의 경우가 있다", () => {
    expect(new Set(cases.map((c) => c[0]))).toEqual(new Set(EXAMPLE_TRIGGERS.map((t) => t.pattern)));
  });
});

describe("EXAMPLE_TRIGGERS — 링크·툴팁 치환", () => {
  /** 줄의 첫 매치로 링크를 만든다 (터미널 링크 프로바이더와 같은 순서: 치환+인코딩 → 안전 검사) */
  function linkFor(pattern: string, line: string): string | null {
    const { compiled } = compileTriggers([{ ...byPattern(pattern), enabled: true }]);
    const [m] = matchLine(line, compiled);
    if (!m?.url || !m.groups) return null;
    return safeUrl(expandTemplate(m.url, m.groups, true));
  }
  function tipFor(pattern: string, line: string): string | null {
    const { compiled } = compileTriggers([{ ...byPattern(pattern), enabled: true }]);
    const [m] = matchLine(line, compiled);
    if (!m?.tooltip || !m.groups) return null;
    return expandTemplate(m.tooltip, m.groups, false);
  }

  it("Rust 오류 코드 → doc.rust-lang.org 의 그 코드 페이지", () => {
    expect(linkFor(String.raw`\b(E\d{4})\b`, "error[E0308]: mismatched types")).toBe(
      "https://doc.rust-lang.org/error_codes/E0308.html",
    );
    expect(tipFor(String.raw`\b(E\d{4})\b`, "error[E0308]")).toBe(
      "Rust error E0308 — Ctrl+click to open the explanation",
    );
  });

  it("CVE → $0 이 인코딩돼도 바뀌는 글자가 없어 NVD 경로가 그대로다", () => {
    expect(linkFor(String.raw`\bCVE-\d{4}-\d{4,}\b`, "fixes CVE-2021-44228.")).toBe(
      "https://nvd.nist.gov/vuln/detail/CVE-2021-44228",
    );
  });

  it("Jira 틀 → 캡처가 경로 끝에 들어간다", () => {
    expect(linkFor(String.raw`\b([A-Z]+-\d+)\b`, "fix PROJ-42")).toBe("https://jira.example.com/browse/PROJ-42");
  });

  it("HTTP 상태 툴팁은 상태 코드만 꺼낸다", () => {
    expect(tipFor(String.raw`\bHTTP/\d(?:\.\d)? (5\d\d)\b`, "HTTP/1.1 503 x")).toBe("Server error 503");
    expect(tipFor(String.raw`\bHTTP/\d(?:\.\d)? (4\d\d)\b`, "HTTP/2 404")).toBe("Client error 404");
  });
});
