// 자동 승인 **시험 칸**의 프런트 쪽 — Tauri `test_auto_approval` 를 부르고 그 이유(코드 + 인자)를
// 문구로 그린다 (src-tauri/src/policy/explain.rs · docs/log/2026-10-05-auto-approve-args.md "세분화").
//
// 판정은 하지 않는다 — Rust 의 실제 자동 승인 판정 경로를 그대로 돌린 결과를 받기만 한다(프런트 미러
// `policy.ts` 로 흉내 내면 화면이 말하는 것과 백엔드가 하는 것이 어긋날 자리가 생긴다). 명령은 실행되지
// 않고, 보내는 설정은 **화면의 초안**(저장 전)이다.
import { invoke } from "../../ipc";
import type { AutomationPrefs } from "./schema";

/** 이유 하나 — Rust `explain::Reason`. */
export interface AutoApprovalReason {
  code: string;
  args: Record<string, string>;
}

/** 시험 결과 — Rust `explain::AutoApprovalTest`. */
export interface AutoApprovalTestResult {
  /** 자동 승인 스위치 — 꺼져 있으면 판정과 무관하게 지금은 사람을 기다린다. */
  enabled: boolean;
  verdict: "auto" | "manual" | "excluded";
  /** 자동이면 구획마다 하나(무엇이 열었나), 아니면 하나(가장 가까운 이유). */
  reasons: AutoApprovalReason[];
}

/** 명령 하나를 초안 설정으로 판정한다 — 실행하지 않는다. */
export function testAutoApproval(command: string, automation: AutomationPrefs): Promise<AutoApprovalTestResult> {
  return invoke<AutoApprovalTestResult>("test_auto_approval", { command, automation });
}

/** 문구 함수 — `t` 와 같은 모양(테스트가 가짜를 꽂는다). */
type Tr = (key: string, args?: Record<string, string | number>) => string;

/**
 * 이유 하나를 문구로 — `bundleName` 이 묶음 id 를 화면 이름으로 바꾼다. 모르는 코드는 코드 그대로
 * (빈 칸보다 낫다 — 백엔드가 새 코드를 더했는데 사전이 아직 없을 때).
 */
export function reasonText(r: AutoApprovalReason, tr: Tr, bundleName: (id: string) => string): string {
  const a = { ...r.args };
  if (a.bundle !== undefined) a.bundle = bundleName(a.bundle);
  if (r.code === "constraint") {
    const detail = tr(`settings.automation.test.kind.${a.kind ?? "words"}`, a);
    return a.bundle !== undefined
      ? tr("settings.automation.test.reason.constraint.bundle", { ...a, detail })
      : tr("settings.automation.test.reason.constraint.rule", { ...a, detail });
  }
  const key = `settings.automation.test.reason.${r.code}`;
  const s = tr(key, a);
  return s === key ? r.code : s;
}
