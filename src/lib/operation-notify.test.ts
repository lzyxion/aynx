import { describe, expect, it } from "vitest";
import type { Tr } from "$lib/finish-notify";
import { translate } from "$lib/i18n/dict";
import type { Operation, TargetResult } from "$lib/operations";
import { headlineOf } from "$lib/review-card";
import {
  EMPTY_TALLY,
  addToTally,
  failedNamesLine,
  isCanaryStop,
  isValidateStop,
  isFinishedRun,
  osNotice,
  outcomeOf,
  plainLine,
  runDurationMs,
  shouldToast,
  subLine,
  targetName,
  veiledLine,
} from "$lib/operation-notify";

/**
 * 작업안 실행 결과 알림의 **토막과 판정** (docs/log/2026-09-28-run-result-notify.md).
 *
 * 이벤트·알린 집합·발사(`app/operation-notify.svelte.ts`)는 여기 없다 — 이 파일이 고정하는 것은
 * "무엇이라고 적나 · 어디에 띄우나" 뿐이다. 기대 문구는 승인된 목업의 글자 그대로다.
 */

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

const T0 = 1_700_000_000_000;

function op(over: Partial<Operation> = {}): Operation {
  return {
    operationId: "op-1",
    command: "df -h",
    targets: ["s1", "s2", "s3"],
    cwd: null,
    validate: null,
    mode: "exec",
    strategy: "sequential",
    concurrency: 1,
    timeoutSeconds: 60,
    state: "succeeded",
    createdAt: T0,
    requestedAt: T0,
    expiresAt: null,
    title: "디스크 사용량 확인",
    reason: null,
    idempotencyKey: null,
    approvalMethod: "manual",
    ...over,
  };
}

function res(state: TargetResult["state"], over: Partial<TargetResult> = {}): TargetResult {
  return {
    state,
    exitCode: state === "succeeded" ? 0 : state === "failed" ? 1 : null,
    stdout: "",
    stderr: "",
    startedAt: state === "cancelled" ? null : T0,
    endedAt: T0 + 1000,
    errorClass: null,
    ...over,
  };
}

/** 이름표 — 목업의 호스트 이름 */
const NAMES: Record<string, string> = {
  s1: "web-01",
  s2: "web-02",
  s3: "web-03",
  s4: "db-01",
  s5: "db-02",
  s6: "cache-01",
  s7: "cache-02",
  s8: "lb-01",
};
const labelOf = (id: string) => NAMES[id] ?? null;

describe("isFinishedRun — 실행을 거친 종료 상태만", () => {
  it("성공·일부 실패·실패·취소만 알린다", () => {
    for (const s of ["succeeded", "partial", "failed", "cancelled"]) expect(isFinishedRun(s)).toBe(true);
  });
  it("거절·만료·진행 중은 알리지 않는다 — 실행된 적이 없거나 아직 안 끝났다", () => {
    for (const s of ["rejected", "expired", "approved", "running", "awaitingApproval", "draft"])
      expect(isFinishedRun(s)).toBe(false);
  });
});

describe("outcomeOf — 사람의 취소(`cancelledByUser`)가 모양보다 먼저", () => {
  const S4 = ["s1", "s2", "s3", "s4"];
  it("일부 성공 뒤 취소 — 집계는 partial 이어도 `취소됨 · 성공 1/4 뒤 멈춤`(info · 무채)", () => {
    const o = outcomeOf(
      "partial",
      op({ targets: S4, cancelledByUser: true }),
      { s1: res("succeeded"), s2: res("cancelled"), s3: res("cancelled"), s4: res("cancelled") },
      labelOf,
      ko,
    );
    expect([o.level, o.tone, subLine(o)]).toEqual(["info", "plain", "취소됨 · 성공 1/4 뒤 멈춤"]);
  });

  it("성공 없이 취소 — `취소됨`", () => {
    const o = outcomeOf(
      "cancelled",
      op({ cancelledByUser: true }),
      { s1: res("cancelled"), s2: res("cancelled"), s3: res("cancelled") },
      labelOf,
      ko,
    );
    expect(subLine(o)).toBe("취소됨");
  });

  it("취소 전에 실패한 대상은 이름이 남는다 · 상태 불명(취소가 끊은 것)은 실패로 세지 않는다", () => {
    const o = outcomeOf(
      "partial",
      op({ targets: S4, cancelledByUser: true }),
      { s1: res("succeeded"), s2: res("failed"), s3: res("unknown", { startedAt: T0 }), s4: res("cancelled") },
      labelOf,
      ko,
    );
    expect([o.level, subLine(o)]).toEqual(["info", "취소됨 · 성공 1/4 뒤 멈춤 · 실패: web-02"]);
  });

  it("검증 통과 직후의 취소는 `canary 검증 실패로 멈춤` 이 아니다", () => {
    const shape = { s1: res("succeeded"), s2: res("cancelled"), s3: res("cancelled") };
    const plan = op({ validate: "systemctl is-active nginx" });
    // 모양만으로는 검증 멈춤과 같다 — 사람이 누른 사실이 있으면 취소다.
    expect(outcomeOf("partial", plan, shape, labelOf, ko).result).toBe("canary 검증 실패로 멈춤");
    const o = outcomeOf("partial", { ...plan, cancelledByUser: true }, shape, labelOf, ko);
    expect(subLine(o)).toBe("취소됨 · 성공 1/3 뒤 멈춤");
  });

  it("canary 실패 뒤 취소도 취소로 말한다(실패 이름은 남는다)", () => {
    const o = outcomeOf(
      "failed",
      op({ cancelledByUser: true }),
      { s1: res("failed"), s2: res("cancelled"), s3: res("cancelled") },
      labelOf,
      ko,
    );
    expect(subLine(o)).toBe("취소됨 · 실패: web-01");
  });
});

describe("outcomeOf — 목업의 글자 그대로", () => {
  it("전부 성공: `성공 3/3 · 12.4초`", () => {
    const r = {
      s1: res("succeeded", { startedAt: T0, endedAt: T0 + 4000 }),
      s2: res("succeeded", { startedAt: T0 + 4100, endedAt: T0 + 9000 }),
      s3: res("succeeded", { startedAt: T0 + 4100, endedAt: T0 + 12_400 }),
    };
    const o = outcomeOf("succeeded", op(), r, labelOf, ko);
    expect(o.level).toBe("success");
    expect(o.tone).toBe("good");
    expect(o.headline).toBe("디스크 사용량 확인");
    expect(o.result).toBe("성공 3/3");
    expect(o.details).toEqual([]);
    expect(o.duration).toBe("12.4초");
    expect(subLine(o)).toBe("성공 3/3 · 12.4초");
    expect(o.auto).toBe(false);
    expect(o.resultsKnown).toBe(true);
  });

  it("일부 실패: 실패한 이름은 둘까지, 나머지는 `외 N` — `일부 실패 5/8 · 실패: web-02, db-01 외 1 · 41초`", () => {
    const targets = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
    const r: Record<string, TargetResult> = {};
    for (const id of targets) r[id] = res("succeeded", { startedAt: T0, endedAt: T0 + 20_000 });
    r.s2 = res("failed", { startedAt: T0, endedAt: T0 + 41_000 });
    r.s4 = res("timedOut", { startedAt: T0, endedAt: T0 + 30_000 });
    r.s7 = res("failed");
    const o = outcomeOf("partial", op({ targets, title: "패키지 목록 갱신" }), r, labelOf, ko);
    expect(o.level).toBe("error");
    expect(o.tone).toBe("bad");
    expect(o.result).toBe("일부 실패 5/8");
    expect(o.details).toEqual(["실패: web-02, db-01 외 1"]);
    expect(o.duration).toBe("41.0초");
    expect(plainLine(o)).toBe("패키지 목록 갱신 — 일부 실패 5/8 · 실패: web-02, db-01 외 1 · 41.0초");
  });

  it("전부 실패: `실패 0/3 · 실패: …`", () => {
    const r = { s1: res("succeeded", { state: "failed", exitCode: 2 }), s2: res("failed"), s3: res("failed") };
    // canary 갈래가 아니게 — 나머지도 실제로 돌았다(시작 시각이 있다)
    const o = outcomeOf("failed", op(), r, labelOf, ko);
    expect(o.result).toBe("실패 0/3");
    expect(o.details).toEqual(["실패: web-01, web-02 외 1"]);
  });

  it("canary 에서 멈춤: `canary 실패로 멈춤 · web-01 exit 1 · 나머지 2곳은 실행 안 함`", () => {
    const r = { s1: res("failed", { exitCode: 1 }), s2: res("cancelled"), s3: res("cancelled") };
    const o = outcomeOf("failed", op({ title: "임시 파일 정리" }), r, labelOf, ko);
    expect(o.level).toBe("error");
    expect(o.result).toBe("canary 실패로 멈춤");
    expect(subLine(o)).toBe("canary 실패로 멈춤 · web-01 exit 1 · 나머지 2곳은 실행 안 함");
    expect(o.duration).toBeNull();
  });

  it("canary 가 시간 초과면 exit 대신 `시간 초과`", () => {
    const r = { s1: res("timedOut"), s2: res("cancelled"), s3: res("cancelled") };
    const o = outcomeOf("failed", op(), r, labelOf, ko);
    expect(o.details[0]).toBe("web-01 시간 초과");
  });

  it("canary 가 상태 불명(`partial` 로 봉해진다)이어도 canary 멈춤으로 읽는다", () => {
    const r = { s1: res("unknown"), s2: res("cancelled"), s3: res("cancelled") };
    const o = outcomeOf("partial", op(), r, labelOf, ko);
    expect(o.result).toBe("canary 실패로 멈춤");
    expect(o.details).toEqual(["web-01", "나머지 2곳은 실행 안 함"]);
  });

  it("canary 검증에서 멈춤: `canary 검증 실패로 멈춤 · web-01 · 나머지 2곳은 실행 안 함`", () => {
    // 백엔드의 모양 그대로 — canary 는 성공, 나머지는 시작 전 취소(사유 문장), 집계는 partial
    const why = "canary 검증 실패로 취소됨 (검증 종료 코드 1)";
    const r = {
      s1: res("succeeded"),
      s2: res("cancelled", { errorClass: why }),
      s3: res("cancelled", { errorClass: why }),
    };
    const o = outcomeOf("partial", op({ title: "nginx 설정 재적용", validate: "systemctl is-active nginx" }), r, labelOf, ko);
    expect(o.level).toBe("error");
    expect(o.tone).toBe("bad");
    expect(subLine(o)).toBe("canary 검증 실패로 멈춤 · web-01 · 나머지 2곳은 실행 안 함");
    expect(o.duration).toBeNull();
    expect(subLine(outcomeOf("partial", op({ validate: "true" }), r, labelOf, en))).toBe(
      "Stopped — canary check failed · web-01 · the other 2 never ran",
    );
  });

  it("검증이 없는 작업안의 같은 모양은 검증 멈춤이 아니다 — 평범한 일부 실패로 읽는다", () => {
    const r = { s1: res("succeeded"), s2: res("cancelled"), s3: res("cancelled") };
    const o = outcomeOf("partial", op({ validate: null }), r, labelOf, ko);
    expect(o.result).toBe("일부 실패 1/3");
  });

  it("canary 명령 자체가 실패하면 검증이 있어도 예전 그대로 canary 멈춤", () => {
    const r = { s1: res("failed", { exitCode: 1 }), s2: res("cancelled"), s3: res("cancelled") };
    const o = outcomeOf("failed", op({ validate: "systemctl is-active nginx" }), r, labelOf, ko);
    expect(subLine(o)).toBe("canary 실패로 멈춤 · web-01 exit 1 · 나머지 2곳은 실행 안 함");
  });

  it("isValidateStop — 나머지 중 하나라도 시작했으면 아니다 · 대상 하나면 아니다", () => {
    const v = op({ validate: "true" });
    expect(isValidateStop(v, { s1: res("succeeded"), s2: res("cancelled"), s3: res("cancelled") })).toBe(true);
    expect(isValidateStop(v, { s1: res("succeeded"), s2: res("succeeded"), s3: res("cancelled") })).toBe(false);
    expect(isValidateStop(v, { s1: res("succeeded"), s2: res("cancelled", { startedAt: T0 }), s3: res("cancelled") })).toBe(false);
    expect(isValidateStop(op({ validate: "true", targets: ["s1"] }), { s1: res("succeeded") })).toBe(false);
    expect(isValidateStop(op({ validate: "  " }), { s1: res("succeeded"), s2: res("cancelled"), s3: res("cancelled") })).toBe(false);
  });

  it("대상이 하나면 canary 갈래가 아니다 — `실패 0/1 · 실패: web-01`", () => {
    const o = outcomeOf("failed", op({ targets: ["s1"] }), { s1: res("failed") }, labelOf, ko);
    expect(o.result).toBe("실패 0/1");
    expect(o.details).toEqual(["실패: web-01"]);
  });

  it("취소: 이미 돈 대상이 있으면 수를 밝힌다 — `취소됨 · 성공 1/4 뒤 멈춤`, 무채", () => {
    const targets = ["s1", "s2", "s3", "s4"];
    const r = { s1: res("succeeded"), s2: res("cancelled"), s3: res("cancelled"), s4: res("cancelled") };
    const o = outcomeOf("cancelled", op({ targets, title: "배포 롤백" }), r, labelOf, ko);
    expect(o.level).toBe("info");
    expect(o.tone).toBe("plain");
    expect(subLine(o)).toBe("취소됨 · 성공 1/4 뒤 멈춤");
  });

  it("취소: 성공이 없으면 `취소됨` 하나", () => {
    const r = { s1: res("cancelled"), s2: res("cancelled"), s3: res("cancelled") };
    expect(subLine(outcomeOf("cancelled", op(), r, labelOf, ko))).toBe("취소됨");
  });

  it("자동 승인이면 `auto` — 수동·옛 백엔드(칸 없음)는 아니다", () => {
    const r = { s1: res("succeeded"), s2: res("succeeded"), s3: res("succeeded") };
    expect(outcomeOf("succeeded", op({ approvalMethod: "auto" }), r, labelOf, ko).auto).toBe(true);
    expect(outcomeOf("succeeded", op({ approvalMethod: "manual" }), r, labelOf, ko).auto).toBe(false);
    expect(outcomeOf("succeeded", op({ approvalMethod: undefined }), r, labelOf, ko).auto).toBe(false);
  });

  it("모두 승인(10-23)으로 돈 실행은 `approveAll` — 자동 승인 위에서만", () => {
    const r = { s1: res("succeeded"), s2: res("succeeded"), s3: res("succeeded") };
    const all = outcomeOf("succeeded", op({ approvalMethod: "auto", approveAll: true }), r, labelOf, ko);
    expect(all.auto && all.approveAll).toBe(true);
    expect(outcomeOf("succeeded", op({ approvalMethod: "auto" }), r, labelOf, ko).approveAll).toBe(false);
    expect(outcomeOf("succeeded", op({ approvalMethod: "manual", approveAll: true }), r, labelOf, ko).approveAll).toBe(false);
  });

  it("결과를 못 읽었으면 상태만 — `실패 · 대상별 결과는 작업안에서`", () => {
    const o = outcomeOf("failed", op({ title: "nginx 설정 재적용" }), null, labelOf, ko);
    expect(o.resultsKnown).toBe(false);
    expect(o.level).toBe("error");
    expect(subLine(o)).toBe("실패 · 대상별 결과는 작업안에서");
    // 빈 맵도 같은 판 — `operation_results` 가 모르는 작업안이면 빈 맵을 준다
    expect(outcomeOf("succeeded", op(), {}, labelOf, ko).resultsKnown).toBe(false);
    expect(subLine(outcomeOf("partial", op(), {}, labelOf, ko))).toBe("일부 실패 · 대상별 결과는 작업안에서");
    expect(subLine(outcomeOf("cancelled", op(), null, labelOf, ko))).toBe("취소됨 · 대상별 결과는 작업안에서");
  });

  it("작업안을 못 찾으면 첫 줄은 `작업안`, 대상은 결과의 키에서 센다", () => {
    const o = outcomeOf("succeeded", null, { a: res("succeeded"), b: res("succeeded") }, labelOf, ko);
    expect(o.headline).toBe("작업안");
    expect(o.result).toBe("성공 2/2");
  });

  it("제목이 없으면 명령 첫 줄 — `headlineOf` 와 같은 글자", () => {
    const o = outcomeOf("succeeded", op({ title: null, command: "systemctl reload nginx\nsleep 1" }), null, labelOf, ko);
    const src = op({ title: null, command: "systemctl reload nginx\nsleep 1" });
    expect(o.headline).toBe(headlineOf(src));
    expect(o.headline.startsWith("systemctl reload nginx")).toBe(true);
    expect(o.headline).not.toContain("sleep");
  });

  it("영어 사전도 같은 모양", () => {
    const r = { s1: res("failed", { exitCode: 1 }), s2: res("cancelled"), s3: res("cancelled") };
    expect(subLine(outcomeOf("failed", op(), r, labelOf, en))).toBe(
      "Stopped — canary failed · web-01 exit 1 · the other 2 never ran",
    );
  });
});

describe("targetName · failedNamesLine · runDurationMs", () => {
  it("이름표 → 위임 별칭 → id 앞머리", () => {
    expect(targetName("s1", labelOf)).toBe("web-01");
    expect(targetName("delegated:dev-01", labelOf)).toBe("dev-01");
    expect(targetName("0123456789abcdef", labelOf)).toBe("01234567");
    expect(targetName("short", () => "  ")).toBe("short");
  });

  it("이름이 둘 이하면 `외` 가 없다", () => {
    expect(failedNamesLine([], ko)).toBeNull();
    expect(failedNamesLine(["a"], ko)).toBe("실패: a");
    expect(failedNamesLine(["a", "b"], ko)).toBe("실패: a, b");
    expect(failedNamesLine(["a", "b", "c", "d"], ko)).toBe("실패: a, b 외 2");
  });

  it("가장 이른 시작 ~ 가장 늦은 끝 · 시작이 하나도 없으면 null", () => {
    expect(
      runDurationMs({ a: res("succeeded", { startedAt: T0 + 50, endedAt: T0 + 500 }), b: res("cancelled") }),
    ).toBe(950);
    expect(runDurationMs({ a: res("cancelled"), b: res("cancelled") })).toBeNull();
    expect(runDurationMs({})).toBeNull();
  });

  it("isCanaryStop — 나머지 중 하나라도 실제로 돌았으면 canary 멈춤이 아니다", () => {
    const o = op();
    expect(isCanaryStop(o, { s1: res("failed"), s2: res("cancelled"), s3: res("failed") })).toBe(false);
    expect(isCanaryStop(o, { s1: res("succeeded"), s2: res("cancelled"), s3: res("cancelled") })).toBe(false);
    expect(isCanaryStop(o, { s1: res("failed"), s2: res("cancelled") })).toBe(false); // s3 결과 없음
    expect(isCanaryStop(o, { s1: res("failed"), s2: res("cancelled"), s3: res("cancelled") })).toBe(true);
  });
});

describe("가림막 아래 — 개수만", () => {
  it("한 건이면 `실패 1건`", () => {
    const t = addToTally(EMPTY_TALLY, "error");
    expect(veiledLine(t, ko)).toEqual({ level: "error", text: "실패 1건" });
  });
  it("여러 건은 결과별로 세고 무거운 것부터, 결은 가장 무거운 것", () => {
    let t = addToTally(EMPTY_TALLY, "success");
    t = addToTally(t, "success");
    t = addToTally(t, "info");
    expect(veiledLine(t, ko)).toEqual({ level: "info", text: "취소 1건 · 성공 2건" });
    t = addToTally(t, "error");
    expect(veiledLine(t, ko)).toEqual({ level: "error", text: "실패 1건 · 취소 1건 · 성공 2건" });
  });
  it("원본을 바꾸지 않는다", () => {
    addToTally(EMPTY_TALLY, "error");
    expect(EMPTY_TALLY).toEqual({ success: 0, error: 0, info: 0 });
  });
});

describe("어디에 띄우나", () => {
  it("토스트는 작업안 칸을 보고 있을 때만 건너뛴다 — 가림막 아래에서는 칸이 가려져 개수라도 띄운다", () => {
    expect(shouldToast({ operationsShown: false, veiled: false })).toBe(true);
    expect(shouldToast({ operationsShown: true, veiled: false })).toBe(false);
    expect(shouldToast({ operationsShown: true, veiled: true })).toBe(true);
    // 10-22 — 자동 승인된 실행은 작업안 칸이 보여도 토스트(검토 카드가 그리지 않았고 사람이 본 적이 없다)
    expect(shouldToast({ operationsShown: true, veiled: false, auto: true })).toBe(true);
    expect(shouldToast({ operationsShown: true, veiled: false, auto: false })).toBe(false);
  });

  const r = { s1: res("succeeded"), s2: res("failed"), s3: res("succeeded") };
  const o = outcomeOf("partial", op({ title: "nginx 설정 재적용" }), r, labelOf, ko);

  it("OS 알림: 창이 뒤에 있고 켜져 있을 때만 · 본문은 한 줄 요약과 결과 토막까지(호스트 이름 없음)", () => {
    expect(osNotice(o, { enabled: true, focused: false, veiled: false }, "", ko)).toEqual({
      title: "작업안 실행이 끝났습니다",
      body: "nginx 설정 재적용 — 일부 실패 2/3",
    });
    expect(osNotice(o, { enabled: true, focused: true, veiled: false }, "", ko)).toBeNull();
    expect(osNotice(o, { enabled: false, focused: false, veiled: false }, "", ko)).toBeNull();
  });

  it("OS 알림: 가림막 아래에서는 개수만", () => {
    const n = osNotice(o, { enabled: true, focused: false, veiled: true }, "실패 1건", ko);
    expect(n).toEqual({ title: "작업안 실행이 끝났습니다", body: "실패 1건" });
    expect(n?.body).not.toContain("nginx");
  });

  it("명령문 전문은 어디에도 없다 — 제목이 없으면 첫 줄 발췌뿐", () => {
    const long = op({ title: null, command: "echo secret-token-123 | tee /tmp/x\nrm -rf /tmp/x" });
    const x = outcomeOf("succeeded", long, null, labelOf, ko);
    const n = osNotice(x, { enabled: true, focused: false, veiled: false }, "", ko);
    expect(n?.body).not.toContain("rm -rf");
    expect(plainLine(x)).not.toContain("rm -rf");
  });
});
