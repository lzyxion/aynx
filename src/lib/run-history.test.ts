import { describe, expect, it } from "vitest";
import type { Tr } from "$lib/finish-notify";
import { translate } from "$lib/i18n/dict";
import type { AuditRun, AuditTargetResult } from "$lib/operations";
import {
  copyStamp,
  DEFAULT_FILTER,
  excerptBlocks,
  filterRuns,
  groupByDay,
  hostOptions,
  hostsLine,
  periodSince,
  ratioPercents,
  runKind,
  runLabelOf,
  runName,
  runOutcome,
  runMarkdown,
  runResults,
  summarize,
  toTargetState,
} from "$lib/run-history";

/**
 * 작업안 실행 기록의 순수 규칙 (docs/log/2026-09-28-run-history.md) — 결과 문구가 알림과 같은가 ·
 * 하루 묶음 · 거르기 · 요약 띠의 수. 기대 문구는 목업 안 A 의 글자다.
 */

const ko: Tr = (key, params) => translate("ko", key, params);

const noLive = () => null;

/** 2026-09-28(일) 14:32 로컬 */
const NOW = new Date(2026, 8, 28, 15, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime();

function res(streamId: string, state: string, over: Partial<AuditTargetResult> = {}): AuditTargetResult {
  const started = state === "cancelled" ? null : 1000;
  return {
    streamId,
    state,
    exitCode: state === "succeeded" ? 0 : state === "failed" ? 1 : null,
    startedAt: started,
    endedAt: 2000,
    ...over,
  };
}

function run(over: Partial<AuditRun> = {}): AuditRun {
  return {
    operationId: "op-1",
    command: "df -h /",
    title: null,
    cwd: null,
    validate: null,
    targets: ["s1", "s2", "s3"],
    targetLabels: [
      { id: "s1", label: "web-01", code: "p1" },
      { id: "s2", label: "web-02", code: "p2" },
      { id: "s3", label: "web-03", code: "p3" },
    ],
    approvalMethod: "manual",
    approvedAt: at(28, 14, 32),
    finishedAt: at(28, 14, 33),
    state: "succeeded",
    results: [res("s1", "succeeded"), res("s2", "succeeded"), res("s3", "succeeded")],
    ...over,
  };
}

describe("결과 문구 — 결과 알림과 같은 함수", () => {
  it("성공 · 일부 실패 · 실패 이름", () => {
    expect(runOutcome(run(), noLive, ko)?.result).toBe("성공 3/3");
    const partial = run({
      title: "nginx 설정 재적용",
      state: "partial",
      results: [res("s1", "succeeded"), res("s2", "failed"), res("s3", "succeeded")],
    });
    const o = runOutcome(partial, noLive, ko);
    expect(o?.headline).toBe("nginx 설정 재적용");
    expect(o?.result).toBe("일부 실패 2/3");
    expect(o?.details).toEqual(["실패: web-02"]);
    expect(o?.tone).toBe("bad");
  });

  it("canary 실패로 멈춤 — 나머지는 시작 시각 없는 취소", () => {
    const r = run({
      state: "failed",
      results: [res("s1", "failed"), res("s2", "cancelled"), res("s3", "cancelled")],
    });
    const o = runOutcome(r, noLive, ko);
    expect(o?.result).toBe("canary 실패로 멈춤");
    expect(o?.details).toEqual(["web-01 exit 1", "나머지 2곳은 실행 안 함"]);
  });

  it("canary 검증 실패로 멈춤 — 검증 명령이 있고 canary 는 성공", () => {
    const r = run({
      validate: "systemctl is-active nginx",
      state: "partial",
      results: [res("s1", "succeeded"), res("s2", "cancelled"), res("s3", "cancelled")],
    });
    expect(runOutcome(r, noLive, ko)?.result).toBe("canary 검증 실패로 멈춤");
  });

  it("취소 · 끝난 줄 없음 · 결과 없는 끝", () => {
    const c = run({
      state: "cancelled",
      results: [res("s1", "cancelled"), res("s2", "cancelled"), res("s3", "cancelled")],
    });
    expect(runOutcome(c, noLive, ko)?.result).toBe("취소됨");
    expect(runOutcome(run({ state: null, results: [], finishedAt: null }), noLive, ko)).toBeNull();
    // 끝난 줄은 있는데 대상 결과가 비면 알림의 "대시보드에서" 물러선 문구를 싣지 않는다.
    const empty = runOutcome(run({ state: "failed", results: [] }), noLive, ko);
    expect(empty?.result).toBe("실패");
    expect(empty?.details).toEqual([]);
  });

  it("사람의 취소 — partial 이어도 `취소됨` · 결은 cancelled · 실패 포함으로 세지 않는다", () => {
    const r = run({
      validate: "systemctl is-active nginx",
      state: "partial",
      cancelledByUser: true,
      cancelledAt: at(28, 14, 33),
      results: [res("s1", "succeeded"), res("s2", "cancelled"), res("s3", "cancelled")],
    });
    const o = runOutcome(r, noLive, ko);
    expect([o?.result, o?.details, o?.tone]).toEqual(["취소됨", ["성공 1/3 뒤 멈춤"], "plain"]);
    expect(runKind(r)).toBe("cancelled");
    expect(summarize([r]).withFailure).toBe(0);
    expect(filterRuns([r], { ...DEFAULT_FILTER, result: "cancelled" }, noLive)).toHaveLength(1);
    expect(filterRuns([r], { ...DEFAULT_FILTER, result: "bad" }, noLive)).toHaveLength(0);
    // 끝난 줄이 없으면 여전히 "끝난 기록 없음"
    expect(runKind({ state: null, cancelledByUser: true })).toBe("open");
  });

  it("자동 표식은 승인 방식에서", () => {
    expect(runOutcome(run({ approvalMethod: "auto" }), noLive, ko)?.auto).toBe(true);
    expect(runOutcome(run({ approvalMethod: null }), noLive, ko)?.auto).toBe(false);
  });
});

describe("이름 · 결과 모양", () => {
  it("제목이 없으면 제목 자리를 비운다 — 명령은 첫 줄 한 번만", () => {
    expect(runName({ title: "nginx 재시작", command: "systemctl restart nginx\nsystemctl status nginx" })).toEqual({
      title: "nginx 재시작",
      command: "systemctl restart nginx",
    });
    expect(runName({ title: "  ", command: "df -h\nfree -m" })).toEqual({ title: null, command: "df -h" });
    expect(runName({ title: null, command: "uptime" })).toEqual({ title: null, command: "uptime" });
  });

  it("감사 스냅샷이 먼저, 그다음 지금 창, 그다음 위임 별칭", () => {
    const r = run({ targets: ["s1", "sX", "delegated:db-01"], targetLabels: [{ id: "s1", label: "web-01", code: "p1" }] });
    const labelOf = runLabelOf(r, (id) => (id === "s1" ? "지금 이름" : id === "sX" ? "live-x" : null));
    expect(labelOf("s1")).toBe("web-01");
    expect(labelOf("sX")).toBe("live-x");
    expect(hostOptions([r], () => null)).toEqual(["db-01", "sX", "web-01"]);
  });

  it("옛 줄(시각 없음) · 모르는 상태 문자열", () => {
    const r = run({ results: [{ streamId: "s1", state: "weird" }] });
    expect(toTargetState("weird")).toBe("unknown");
    expect(runResults(r).s1).toEqual({
      state: "unknown",
      exitCode: null,
      stdout: "",
      stderr: "",
      startedAt: null,
      endedAt: null,
      errorClass: null,
    });
  });

  it("대상 칸은 셋까지 잇고 넘치면 외 N", () => {
    expect(hostsLine(["web-01", "web-02", "db-01"], ko)).toBe("web-01 · web-02 · db-01");
    expect(hostsLine(["web-01", "a", "b", "c", "d"], ko)).toBe("web-01 외 4");
  });

  it("결 — 표식과 결과 거르개가 같은 값", () => {
    expect(runKind({ state: "succeeded" })).toBe("ok");
    expect(runKind({ state: "partial" })).toBe("bad");
    expect(runKind({ state: "failed" })).toBe("bad");
    expect(runKind({ state: "cancelled" })).toBe("cancelled");
    expect(runKind({ state: null })).toBe("open");
  });

  it("출력 발췌 — 대상 순서, stdout 먼저, 빈 것은 빠진다", () => {
    const r = run({
      results: [
        res("s1", "succeeded"),
        res("s2", "failed", { stdoutTail: "out", stderrTail: "nginx: [emerg]" }),
        res("s3", "succeeded", { stderrTail: "" }),
      ],
    });
    expect(excerptBlocks(r, noLive)).toEqual([
      { name: "web-02", stream: "stdout", text: "out" },
      { name: "web-02", stream: "stderr", text: "nginx: [emerg]" },
    ]);
    expect(excerptBlocks(run(), noLive)).toEqual([]);
  });
});

describe("하루 묶음", () => {
  it("오늘 · 어제 · 날짜 — 최신 날이 위, 묶음 안도 최신이 위", () => {
    const runs = [
      run({ operationId: "a", approvedAt: at(28, 9, 12) }),
      run({ operationId: "b", approvedAt: at(28, 14, 32) }),
      run({ operationId: "c", approvedAt: at(27, 22, 40) }),
      run({ operationId: "d", approvedAt: at(26, 0, 5) }),
      run({ operationId: "e", approvedAt: at(27, 0, 0) }),
    ];
    const g = groupByDay(runs, NOW);
    expect(g.map((x) => [x.key, x.relative, x.runs.map((r) => r.operationId)])).toEqual([
      ["2026-09-28", "today", ["b", "a"]],
      ["2026-09-27", "yesterday", ["c", "e"]],
      ["2026-09-26", null, ["d"]],
    ]);
    expect(g[2].date.getDate()).toBe(26);
  });

  it("월 경계의 어제", () => {
    const g = groupByDay([run({ approvedAt: new Date(2026, 8, 30, 23).getTime() })], new Date(2026, 9, 1, 8));
    expect(g[0].relative).toBe("yesterday");
  });

  it("기간 — 오늘을 포함한 달력 날짜 수(엿새 전 자정부터)", () => {
    expect(periodSince(7, NOW)).toBe(new Date(2026, 8, 22).getTime());
    expect(periodSince(1, NOW)).toBe(new Date(2026, 8, 28).getTime());
  });
});

describe("거르기", () => {
  const runs = [
    run({ operationId: "ok", title: "디스크 사용량 확인", command: "df -h /" }),
    run({
      operationId: "bad",
      title: "nginx 설정 재적용",
      command: "nginx -t && systemctl reload nginx",
      state: "partial",
      results: [res("s1", "succeeded"), res("s2", "failed"), res("s3", "succeeded")],
    }),
    run({
      operationId: "auto",
      command: "journalctl --vacuum-time=7d",
      approvalMethod: "auto",
      targets: ["s4"],
      targetLabels: [{ id: "s4", label: "db-01", code: "p4" }],
      results: [res("s4", "succeeded")],
    }),
    run({
      operationId: "can",
      command: "./deploy.sh rollback",
      state: "cancelled",
      results: [res("s1", "cancelled"), res("s2", "cancelled"), res("s3", "cancelled")],
    }),
    run({ operationId: "open", state: null, results: [], finishedAt: null }),
  ];
  const ids = (f: Partial<typeof DEFAULT_FILTER>) =>
    filterRuns(runs, { ...DEFAULT_FILTER, ...f }, noLive).map((r) => r.operationId);

  it("전체는 그대로", () => {
    expect(ids({})).toEqual(["ok", "bad", "auto", "can", "open"]);
  });
  it("결과", () => {
    expect(ids({ result: "ok" })).toEqual(["ok", "auto"]);
    expect(ids({ result: "bad" })).toEqual(["bad"]);
    expect(ids({ result: "cancelled" })).toEqual(["can"]);
  });
  it("승인 방식", () => {
    expect(ids({ approval: "auto" })).toEqual(["auto"]);
    expect(ids({ approval: "manual" })).toEqual(["ok", "bad", "can", "open"]);
  });
  it("호스트 — 그 이름의 대상이 하나라도 있으면", () => {
    expect(ids({ host: "db-01" })).toEqual(["auto"]);
    expect(ids({ host: "web-02" })).toEqual(["ok", "bad", "can", "open"]);
  });
  it("검색 — 제목과 명령, 대소문자 무시", () => {
    expect(ids({ query: "NGINX" })).toEqual(["bad"]);
    expect(ids({ query: "  디스크 " })).toEqual(["ok"]);
    expect(ids({ query: "vacuum" })).toEqual(["auto"]);
  });
  it("여럿을 겹치면 모두 만족해야", () => {
    expect(ids({ approval: "manual", result: "ok" })).toEqual(["ok"]);
  });
});

describe("요약 띠", () => {
  it("실행 · 실패 포함 · 대상 실행 · 수동/자동", () => {
    const runs = [
      run(),
      run({ state: "partial", results: [res("s1", "succeeded"), res("s2", "failed"), res("s3", "succeeded")] }),
      // canary 멈춤 — 나머지 둘은 시작 전 취소라 대상 실행으로 세지 않는다
      run({ state: "failed", results: [res("s1", "failed"), res("s2", "cancelled"), res("s3", "cancelled")] }),
      run({ approvalMethod: "auto", targets: ["s1"], results: [res("s1", "succeeded")] }),
      // 옛 줄 — 시각이 없어도 끝난 상태면 돈 것이다
      run({ approvalMethod: "auto", targets: ["s1"], results: [{ streamId: "s1", state: "succeeded", exitCode: 0 }] }),
      run({ state: null, results: [], finishedAt: null }),
    ];
    expect(summarize(runs)).toEqual({ runs: 6, withFailure: 2, targetRuns: 3 + 3 + 1 + 1 + 1, manual: 4, auto: 2 });
  });

  it("비율 막대 — 합이 100, 빈 목록은 0", () => {
    expect(ratioPercents({ manual: 4, auto: 7 })).toEqual({ manual: 36, auto: 64 });
    expect(ratioPercents({ manual: 0, auto: 0 })).toEqual({ manual: 0, auto: 0 });
  });
});

describe("기록 [복사] — 붙여넣을 Markdown", () => {
  const base = {
    title: "php-fpm 재시작",
    result: "실패 (1/2)",
    at: new Date(2026, 9, 27, 14, 20).getTime(),
    summary: "내려간 php-fpm 을 다시 띄웁니다.",
    command: "sudo systemctl restart php8.3-fpm",
    rows: [
      { name: "web-02", state: "실패", exit: 3 },
      { name: "web-01", state: "성공", exit: 0 },
    ],
    excerpts: [{ name: "web-02", stream: "stderr" as const, text: "Job for php8.3-fpm.service failed" }],
  };

  it("제목 — 결과 / 시각 · 설명 / 명령 / 대상 표 / 출력 발췌", () => {
    expect(runMarkdown(base, ko)).toBe(
      [
        "**php-fpm 재시작** — 실패 (1/2)",
        "",
        "시각: 2026-10-27 14:20  ",
        "설명: 내려간 php-fpm 을 다시 띄웁니다.",
        "",
        "```sh",
        "sudo systemctl restart php8.3-fpm",
        "```",
        "",
        "| 대상 | 결과 | 종료 코드 |",
        "|---|---|---|",
        "| web-02 | 실패 | 3 |",
        "| web-01 | 성공 | 0 |",
        "",
        "web-02 stderr:",
        "```",
        "Job for php8.3-fpm.service failed",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("설명 · 출력 · 대상이 없으면 그 부분만 빠진다", () => {
    const md = runMarkdown({ ...base, summary: null, excerpts: [], rows: [] }, ko);
    expect(md).toBe(["**php-fpm 재시작** — 실패 (1/2)", "", "시각: 2026-10-27 14:20", "", "```sh", "sudo systemctl restart php8.3-fpm", "```", ""].join("\n"));
  });

  it("명령 안의 백틱보다 긴 울타리 · 표 칸의 | 는 이스케이프", () => {
    const md = runMarkdown({ ...base, command: "echo ```x```", rows: [{ name: "a|b", state: "성공", exit: null }], excerpts: [] }, ko);
    expect(md).toContain("````sh\necho ```x```\n````");
    expect(md).toContain("| a\\|b | 성공 |  |");
  });

  it("시각은 로컬 YYYY-MM-DD HH:MM", () => {
    expect(copyStamp(new Date(2026, 0, 5, 7, 3).getTime())).toBe("2026-01-05 07:03");
  });
});
