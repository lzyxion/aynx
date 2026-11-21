import type { Key } from "$lib/i18n/keys";
import type { Trigger } from "$lib/triggers";
import { DEFAULT_TRIGGER_BG, EXAMPLE_TRIGGER_COLORS as C } from "./options";

type ExampleBody = Omit<Trigger, "enabled">;

export interface TriggerExample {
  /** 저장되지 않는다 */
  id: string;
  name: Key;
  desc: Key;
  trigger: ExampleBody;
  /** 시험 칸에 미리 채울 출력 한 줄 — 저장되지 않는다 */
  sample: string;
}

/**
 * 겹치면 목록에서 먼저 나온 트리거가 이긴다(`matchLine`) — 넓은 틀인 Jira 는 CVE · ERR 코드와도 맞아 맨 끝에 둔다.
 * 툴팁 문구는 사전으로 옮기지 않고 영어로 둔다 — `settings.toml` 에 적히는 값이라 표시 언어에 매이면 안 된다 (docs/log/2026-09-17-i18n.md).
 */
export const TRIGGER_EXAMPLES: readonly TriggerExample[] = [
  // 대소문자 구분 — 산문 속 "failed" 까지 칠하지 않는다
  {
    id: "fatal",
    name: "settings.triggers.examples.fatal.name",
    desc: "settings.triggers.examples.fatal.desc",
    trigger: { pattern: String.raw`\b(FATAL|PANIC|CRITICAL)\b`, bg: C.fatalBg },
    sample: "2026-10-05 12:00:01 FATAL: database connection lost",
  },
  {
    id: "fail",
    name: "settings.triggers.examples.fail.name",
    desc: "settings.triggers.examples.fail.desc",
    trigger: { pattern: String.raw`\bFAIL(ED|URE)?\b`, fg: C.failFg },
    sample: "FAIL src/lib/config.test.ts > parses empty file",
  },
  {
    id: "pass",
    name: "settings.triggers.examples.pass.name",
    desc: "settings.triggers.examples.pass.desc",
    trigger: { pattern: String.raw`\b(PASS(ED)?|SUCCESS(FUL)?)\b`, fg: C.passFg },
    sample: "PASS src/lib/config.test.ts (12 tests)",
  },
  {
    id: "deprecated",
    name: "settings.triggers.examples.deprecated.name",
    desc: "settings.triggers.examples.deprecated.desc",
    trigger: { pattern: String.raw`\b(DEPRECATED|[Dd]eprecated)\b`, fg: C.warnFg },
    sample: "warning: url.parse() is deprecated, use new URL() instead",
  },
  {
    id: "npm",
    name: "settings.triggers.examples.npm.name",
    desc: "settings.triggers.examples.npm.desc",
    trigger: { pattern: "npm ERR!", bg: C.errorBg },
    sample: "npm ERR! code ENOENT",
  },
  {
    id: "traceback",
    name: "settings.triggers.examples.traceback.name",
    desc: "settings.triggers.examples.traceback.desc",
    trigger: { pattern: String.raw`Traceback \(most recent call last\):`, bg: C.errorBg },
    sample: "Traceback (most recent call last):",
  },
  {
    id: "k8s",
    name: "settings.triggers.examples.k8s.name",
    desc: "settings.triggers.examples.k8s.desc",
    trigger: {
      pattern: String.raw`\b(CrashLoopBackOff|ImagePullBackOff|ErrImagePull|OOMKilled|Evicted)\b`,
      bg: C.errorBg,
    },
    sample: "web-7d9f5c-x2k4q   0/1   CrashLoopBackOff   5 (32s ago)   4m",
  },
  {
    id: "http5xx",
    name: "settings.triggers.examples.http5xx.name",
    desc: "settings.triggers.examples.http5xx.desc",
    trigger: { pattern: String.raw`\bHTTP/\d(?:\.\d)? (5\d\d)\b`, bg: C.errorBg, tooltip: "Server error $1" },
    sample: "HTTP/1.1 503 Service Unavailable",
  },
  {
    id: "http4xx",
    name: "settings.triggers.examples.http4xx.name",
    desc: "settings.triggers.examples.http4xx.desc",
    trigger: { pattern: String.raw`\bHTTP/\d(?:\.\d)? (4\d\d)\b`, bg: C.warnBg, tooltip: "Client error $1" },
    sample: "HTTP/1.1 404 Not Found",
  },
  {
    id: "rust",
    name: "settings.triggers.examples.rust.name",
    desc: "settings.triggers.examples.rust.desc",
    trigger: {
      pattern: String.raw`\b(E\d{4})\b`,
      url: "https://doc.rust-lang.org/error_codes/$1.html",
      tooltip: "Rust error $1 — Ctrl+click to open the explanation",
    },
    sample: "error[E0308]: mismatched types",
  },
  {
    id: "cve",
    name: "settings.triggers.examples.cve.name",
    desc: "settings.triggers.examples.cve.desc",
    trigger: {
      pattern: String.raw`\bCVE-\d{4}-\d{4,}\b`,
      url: "https://nvd.nist.gov/vuln/detail/$0",
      tooltip: "$0 — Ctrl+click to open on NVD",
    },
    sample: "xz-utils: backdoor fixed in 5.6.2 (CVE-2024-3094)",
  },
  {
    id: "errcode",
    name: "settings.triggers.examples.errcode.name",
    desc: "settings.triggers.examples.errcode.desc",
    trigger: { pattern: String.raw`\b(ERR-\d{4})\b`, tooltip: "Error code $1", bg: DEFAULT_TRIGGER_BG },
    sample: "request failed: ERR-1234 upstream timeout",
  },
  {
    id: "ipv4",
    name: "settings.triggers.examples.ipv4.name",
    desc: "settings.triggers.examples.ipv4.desc",
    trigger: { pattern: String.raw`\b(?:\d{1,3}\.){3}\d{1,3}\b`, fg: C.infoFg },
    sample: "Accepted publickey for deploy from 192.168.0.10 port 52144 ssh2",
  },
  // 넓은 틀이라 맨 끝
  {
    id: "jira",
    name: "settings.triggers.examples.jira.name",
    desc: "settings.triggers.examples.jira.desc",
    trigger: {
      pattern: String.raw`\b([A-Z]+-\d+)\b`,
      url: "https://jira.example.com/browse/$1",
      tooltip: "Issue $1 — edit the link to point at your Jira",
    },
    sample: "fix(api): handle empty request body (PROJ-42)",
  },
];

export function findExample(id: string): TriggerExample | undefined {
  return TRIGGER_EXAMPLES.find((e) => e.id === id);
}

export function exampleTrigger(ex: TriggerExample): Trigger {
  return { ...ex.trigger, enabled: true };
}

/** 패턴이 같으면 같은 것이다 — 손으로 넣었든 예시로 넣었든 */
export function isExampleAdded(list: readonly Trigger[], ex: TriggerExample): boolean {
  return list.some((t) => t.pattern === ex.trigger.pattern);
}
