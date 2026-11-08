// 설정 › 트리거 **추가 하위 화면**의 "예시에서 시작" 카드들 — 순수 (룬 저장소를 부르지 않아 테스트가 바로 읽는다).
// 카드를 고르면 규칙 칸이 그 예시로 채워지고(`trigger-form.ts` 의 `exampleToForm`) 시험 칸에 `sample` 이 들어간다.
// 화면은 `TriggerEditor.svelte`.
import type { Key } from "$lib/i18n/keys";
import type { Trigger } from "$lib/triggers";
import { DEFAULT_TRIGGER_BG, EXAMPLE_TRIGGER_COLORS as C } from "./options";

/** 저장되는 값 — `enabled` 는 넣는 순간 정한다(고른 것은 켜진 채로) */
type ExampleBody = Omit<Trigger, "enabled">;

/** 예시 카드 하나 */
export interface TriggerExample {
  /** 카드의 이름표 — 저장되지 않는다 */
  id: string;
  /** 화면 이름 (사전 키) */
  name: Key;
  /** 무엇을 하는지 한 줄 (사전 키) */
  desc: Key;
  /** 규칙 칸을 채울 트리거 */
  trigger: ExampleBody;
  /** 시험 칸에 미리 채울 출력 한 줄 — 이 예시가 실제로 걸리는 모양을 바로 보인다(저장되지 않는다) */
  sample: string;
}

/**
 * 설정 › 트리거 **추가 하위 화면**의 예시들 — 흔한 로그 낱말(치명·실패·성공·사용 중단)·도구별 머리(npm·Python·
 * Kubernetes·HTTP 상태)와 링크·툴팁 틀(Rust 오류 코드·CVE·Jira).
 *
 * **예시는 틀이다** (2026-10-05 — 고르는 팝업 → 하위 화면): 고르면 규칙 칸이 채워지고, 사람이 고치고 시험해 본 뒤
 * [추가] 를 눌러야 들어간다(켜진 채로, 목록 끝에). 같은 패턴이 이미 있어도 고를 수 있다 — 카드에 ✓ 만 단다.
 *
 * **순서** — 겹치면 목록에서 먼저 나온 트리거가 이긴다 (`matchLine`). 넓은 틀인 Jira(`[A-Z]+-\d+`)는
 * `CVE-2024-…`·`ERR-1234` 와도 맞으므로 카드 맨 끝에 둔다.
 *
 * `settings.rs` 의 `default_triggers()` 와는 다른 물건이다: 저쪽은 파일에 `triggers` 키가
 * 없을 때 **자동으로** 들어가는 내장 두 개(ERROR·WARN)고, 이것들은 사람이 골라야만 들어온다.
 *
 * **트리거 값(툴팁 문구)은 사전으로 옮기지 않고 영어로 둔다.** 그것은 화면 글자가 아니라 `settings.toml` 에
 * **적히는 값**이다 — 언어에 따라 다른 글자를 남기면 사용자 파일의 내용이 그날의 표시 언어에 매인다
 * (docs/log/2026-09-17-i18n.md). 사전에 사는 것은 카드의 이름·설명뿐이다. `sample` 도 로그 한 줄이라 그대로 둔다.
 */
export const TRIGGER_EXAMPLES: readonly TriggerExample[] = [
  // 로그 수준·결과 낱말 (대소문자 구분 — 산문 속 "failed" 까지 칠하지 않는다)
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
  // 도구별 오류 머리
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
  // HTTP 상태 줄 (`HTTP/1.1 503` · `HTTP/2 404`)
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
  // 링크·툴팁 예
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
  // 정보용 — 칠하기보다 눈에 걸리게만
  {
    id: "ipv4",
    name: "settings.triggers.examples.ipv4.name",
    desc: "settings.triggers.examples.ipv4.desc",
    trigger: { pattern: String.raw`\b(?:\d{1,3}\.){3}\d{1,3}\b`, fg: C.infoFg },
    sample: "Accepted publickey for deploy from 192.168.0.10 port 52144 ssh2",
  },
  // 넓은 틀이라 맨 끝 (위 주석). 주소는 사용자가 고쳐 쓰는 자리다.
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

/** 예시 하나 (`id` 로) */
export function findExample(id: string): TriggerExample | undefined {
  return TRIGGER_EXAMPLES.find((e) => e.id === id);
}

/** 예시의 트리거 — **켜진 채로**, 매번 새 객체 (폼을 채우는 데 쓴다 — `exampleToForm`) */
export function exampleTrigger(ex: TriggerExample): Trigger {
  return { ...ex.trigger, enabled: true };
}

/** 같은 패턴이 이미 목록에 있는가 (손으로 넣었든 예시로 넣었든 — 패턴이 같으면 같은 것이다). 카드의 ✓ 표시 */
export function isExampleAdded(list: readonly Trigger[], ex: TriggerExample): boolean {
  return list.some((t) => t.pattern === ex.trigger.pattern);
}
