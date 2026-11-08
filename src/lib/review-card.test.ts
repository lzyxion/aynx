import { describe, expect, it } from "vitest";
import { CMD_PREVIEW_MAX_CHARS } from "$lib/command-preview";
import type { CommandLine, Operation } from "$lib/operations";
import {
  analysisChips,
  approvalRisk,
  approveStep,
  dbCardFacts,
  dbRisk,
  effectTone,
  hasFoldedDetail,
  hasUnboundedWrite,
  headlineOf,
  reasonShown,
  reviewCardModel,
  shownSep,
  splitLines,
  markSegments,
  lineMark,
  verdictOf,
} from "$lib/review-card";
import type { DbPlan } from "$lib/operations";

/**
 * 화면 아래 가운데 검토 대기 카드의 **내용 판정** (docs/log/2026-09-27-review-popup-card.md ·
 * 앞선 판 docs/log/2026-09-22-review-card.md).
 *
 * 가림막 갈래를 여기서 보는 이유: 헤드리스 하네스로 가림막을 세우려면 볼트 스텁까지
 * 통째로 끌고 와야 하는데, 정작 판정은 불리언 하나가 가르는 이 순수 함수다.
 */

const NOW = 1_700_000_000_000;

/** 대기 하나 — 시험에 쓰는 칸만 채우고 나머지는 계약의 기본값이다 */
function op(over: Partial<Operation> = {}): Operation {
  return {
    operationId: "op-1",
    command: "uptime",
    targets: ["s1"],
    cwd: null,
    validate: null,
    mode: "exec",
    strategy: "sequential",
    concurrency: 1,
    timeoutSeconds: 60,
    state: "awaitingApproval",
    createdAt: NOW,
    requestedAt: NOW,
    expiresAt: null,
    title: null,
    reason: null,
    idempotencyKey: null,
    ...over,
  };
}

describe("headlineOf", () => {
  it("제목이 있으면 그것이 한 줄 요약이다", () => {
    expect(headlineOf(op({ title: "nginx 재시작", command: "systemctl restart nginx" }))).toBe("nginx 재시작");
  });

  it("제목이 비었으면(널·공백) 명령문 **첫 줄** 발췌로 떨어진다", () => {
    expect(headlineOf(op({ title: "   ", command: "df -h\nfree -m\nuptime" }))).toBe("df -h…");
  });

  it("긴 한 줄은 관제판과 **같은 글자 상한**에서 잘린다 (전문은 절대 나오지 않는다)", () => {
    const long = "echo " + "x".repeat(CMD_PREVIEW_MAX_CHARS * 2);
    const h = headlineOf(op({ command: long }));
    // 잘린 자리에 말줄임표 한 글자가 붙는다 — 상한 + 1 이 최대 길이다.
    expect(h.length).toBe(CMD_PREVIEW_MAX_CHARS + 1);
    expect(h.endsWith("…")).toBe(true);
  });
});

describe("reviewCardModel", () => {
  it("대기가 없으면 카드 자체가 없다", () => {
    expect(reviewCardModel([], false, NOW)).toEqual({ kind: "hidden" });
    // 가림막이 걸려 있어도 셀 것이 없으면 마찬가지다.
    expect(reviewCardModel([], true, NOW)).toEqual({ kind: "hidden" });
  });

  it("가림막이 걸리면 **개수만** 말한다 (명령문도 제목도 싣지 않는다)", () => {
    const m = reviewCardModel([op({ title: "nginx 재시작" }), op({ operationId: "op-2" })], true, NOW);
    expect(m).toEqual({ kind: "veiled", count: 2 });
    // 고른 것이 있어도 마찬가지다 — 선택은 가림막을 뚫는 길이 아니다.
    expect(reviewCardModel([op(), op({ operationId: "op-2" })], true, NOW, undefined, "op-2")).toEqual({
      kind: "veiled",
      count: 2,
    });
  });

  it("기본은 맨 앞(가장 오래된) 하나다", () => {
    const m = reviewCardModel(
      [op({ operationId: "a" }), op({ operationId: "b" }), op({ operationId: "c" })],
      false,
      NOW,
    );
    if (m.kind !== "card") throw new Error("card 여야 한다");
    expect(m.op.operationId).toBe("a");
    expect(m.index).toBe(0);
    expect(m.total).toBe(3);
    expect(m.headId).toBe("a");
  });

  it("고른 id 가 있으면 그것을 보여 주고, 머리 id 는 따로 싣는다", () => {
    const m = reviewCardModel(
      [op({ operationId: "a" }), op({ operationId: "b" }), op({ operationId: "c" })],
      false,
      NOW,
      undefined,
      "c",
    );
    if (m.kind !== "card") throw new Error("card 여야 한다");
    expect(m.op.operationId).toBe("c");
    expect(m.index).toBe(2);
    expect(m.headId).toBe("a");
  });

  it("고른 것이 목록에서 사라지면 맨 앞으로 떨어진다 (다른 작업안이 그 자리에 들어앉지 않는다)", () => {
    // "b" 를 보고 있었는데 "b" 가 승인·만료됐다 — 자리 1 에는 이제 "c" 가 있지만 그것을 가리키면 안 된다.
    const m = reviewCardModel([op({ operationId: "a" }), op({ operationId: "c" })], false, NOW, undefined, "b");
    if (m.kind !== "card") throw new Error("card 여야 한다");
    expect(m.op.operationId).toBe("a");
    expect(m.index).toBe(0);
  });

  it("위험 신호는 관제판과 같은 판정이다", () => {
    const safe = reviewCardModel([op({ command: "uptime" })], false, NOW);
    if (safe.kind !== "card") throw new Error("card 여야 한다");
    expect(safe.risk).toBe("safe");

    const danger = reviewCardModel([op({ command: "rm -rf /tmp/x" })], false, NOW);
    if (danger.kind !== "card") throw new Error("card 여야 한다");
    expect(danger.risk).toBe("dangerous");
  });

  it("위험 신호는 **보여 주는** 작업안의 것이다", () => {
    const m = reviewCardModel(
      [op({ operationId: "a", command: "uptime" }), op({ operationId: "b", command: "rm -rf /x" })],
      false,
      NOW,
      undefined,
      "b",
    );
    if (m.kind !== "card") throw new Error("card 여야 한다");
    expect(m.risk).toBe("dangerous");
  });

  it("자동 승인 거부 사유가 있으면 보여 주는 작업안의 것을 싣는다", () => {
    const refusals = new Map([
      ["op-1", "자동 실행이 위임되지 않은 위임 대상이 있습니다: dev-01"],
      ["op-2", "둘째 사유"],
    ]);
    const m = reviewCardModel([op(), op({ operationId: "op-2" })], false, NOW, refusals);
    if (m.kind !== "card") throw new Error("card 여야 한다");
    expect(m.autoRefused).toBe("자동 실행이 위임되지 않은 위임 대상이 있습니다: dev-01");

    const second = reviewCardModel([op(), op({ operationId: "op-2" })], false, NOW, refusals, "op-2");
    if (second.kind !== "card") throw new Error("card 여야 한다");
    expect(second.autoRefused).toBe("둘째 사유");
  });

  it("사유가 없거나 표를 안 주면 null 이다", () => {
    const none = reviewCardModel([op()], false, NOW);
    if (none.kind !== "card") throw new Error("card 여야 한다");
    expect(none.autoRefused).toBe(null);

    // 표는 있는데 **다른** 작업안의 사유다 — 보여 주는 것의 것만 싣는다.
    const other = reviewCardModel([op()], false, NOW, new Map([["op-9", "남의 사유"]]));
    if (other.kind !== "card") throw new Error("card 여야 한다");
    expect(other.autoRefused).toBe(null);
  });

  it("가림막 아래에서는 사유를 **절대** 싣지 않는다 (호스트 이름이 박혀 있다)", () => {
    const refusals = new Map([["op-1", "자동 실행이 위임되지 않은 위임 대상이 있습니다: dev-01"]]);
    const m = reviewCardModel([op()], true, NOW, refusals);
    // `veiled` 갈래에는 그 칸 자체가 없다 — 개수 하나뿐이다.
    expect(m).toEqual({ kind: "veiled", count: 1 });
  });

  it("만료는 보여 주는 작업안의 것이다 — 없음은 null · 남았으면 분(올림) · 지났으면 0", () => {
    const none = reviewCardModel([op({ expiresAt: null })], false, NOW);
    if (none.kind !== "card") throw new Error("card 여야 한다");
    expect(none.expiryMinutes).toBe(null);

    // 6분 30초 남았다 → 올림해서 7분 (30초를 "0분" 이라 적으면 끝난 것처럼 읽힌다)
    const left = reviewCardModel([op({ expiresAt: NOW + 6.5 * 60_000 })], false, NOW);
    if (left.kind !== "card") throw new Error("card 여야 한다");
    expect(left.expiryMinutes).toBe(7);

    const past = reviewCardModel([op({ expiresAt: NOW - 1000 })], false, NOW);
    if (past.kind !== "card") throw new Error("card 여야 한다");
    expect(past.expiryMinutes).toBe(0);

    const picked = reviewCardModel(
      [op({ expiresAt: null }), op({ operationId: "op-2", expiresAt: NOW + 60_000 })],
      false,
      NOW,
      undefined,
      "op-2",
    );
    if (picked.kind !== "card") throw new Error("card 여야 한다");
    expect(picked.expiryMinutes).toBe(1);
  });
});

describe("DB 쓰기 작업안 카드(쿼리 타일 3b)", () => {
  const plan: DbPlan = {
    connId: "Ab3dEf9hJk2L",
    connName: "운영 DB",
    engine: "postgres",
    database: "app",
    throughSsh: true,
    statements: [
      { sql: "UPDATE t SET a = 1 WHERE id = 3", keyword: "UPDATE", counted: true, uncounted: false },
      { sql: "SELECT count(*) FROM t", keyword: "SELECT", counted: false, uncounted: false },
    ],
    maxAffected: 1,
    timeoutSeconds: 30,
  };

  it("연결 이름 · 엔진 · DB · 경유(화면의 연결 목록에서) · 문장 전문 · 상한 — 명령 상자 대신", () => {
    const m = reviewCardModel([op({ command: "UPDATE …", targets: ["db:Ab3dEf9hJk2L"], db: plan })], false, NOW, undefined, null, (id) =>
      id === "Ab3dEf9hJk2L" ? "web-01" : undefined,
    );
    if (m.kind !== "card") throw new Error("card 여야 한다");
    expect(m.db).toEqual({
      connName: "운영 DB",
      engine: "postgres",
      via: "web-01",
      database: "app",
      sql: "UPDATE t SET a = 1 WHERE id = 3;\nSELECT count(*) FROM t;",
      statementCount: 2,
      maxAffected: 1,
      uncounted: 0,
    });
    // SQL 에는 셸 위험 판정을 쓰지 않는다 — 세지 않는 문장이 없으면 한 번에 승인.
    expect(m.risk).toBe("safe");
  });

  it("영향 행을 세지 않는 문장(DDL · TRUNCATE · WITH)이 있으면 위험 — 상한이 막지 못한다(두 번 눌러 승인)", () => {
    const ddl: DbPlan = { ...plan, statements: [...plan.statements, { sql: "TRUNCATE t", keyword: "TRUNCATE", counted: false, uncounted: true }] };
    expect(dbRisk(plan)).toBe("safe");
    expect(dbRisk(ddl)).toBe("dangerous");
    const m = reviewCardModel([op({ db: ddl, targets: ["db:x"] })], false, NOW);
    if (m.kind !== "card") throw new Error("card 여야 한다");
    expect(m.db?.uncounted).toBe(1);
    expect(m.risk).toBe("dangerous");
  });

  it("경유 별칭은 작업안에 없다 — 목록에서 못 찾으면 SSH 경유는 '?' · 직접은 없음", () => {
    expect(dbCardFacts(plan, () => undefined).via).toBe("?");
    expect(dbCardFacts({ ...plan, throughSsh: false }, () => undefined).via).toBeNull();
    expect(dbCardFacts({ ...plan, database: "  " }, () => undefined).database).toBeNull();
  });

  it("셸 작업안은 db 칸이 없다(그대로 명령 상자)", () => {
    const m = reviewCardModel([op()], false, NOW);
    if (m.kind !== "card") throw new Error("card 여야 한다");
    expect(m.db).toBeNull();
  });

  it("가림막 아래에는 DB 칸도 없다 — 개수뿐", () => {
    expect(reviewCardModel([op({ db: plan })], true, NOW)).toEqual({ kind: "veiled", count: 1 });
  });
});

/**
 * 승인 요약(docs/log/2026-10-21-approval-summary.md) — 칩 줄은 Rust 의 분석 · `mismatch` 를 **그대로** 옮길 뿐이다(판정을 두 벌 두지 않는다).
 * 목업의 두 명령과 DB DELETE(WHERE 있음 · 없음).
 */
describe("analysisChips · 위험 신호(승인 요약)", () => {
  it("읽기 파이프 · 선언과 일치 — 초록 효과 칩 · 프로그램 사슬 · 위험 아님", () => {
    const o = op({
      command: "du -ah /var/log/nginx | sort -rh | head -n 10",
      summary: "nginx 로그 크기 상위 10개",
      effect: "read",
      mismatch: false,
      analysis: { effect: "read", programs: ["du", "sort", "head"], sudo: false },
    });
    // 프로그램 사슬 칩은 10-24 에 걷었다(명령을 되풀이할 뿐이었다)
    expect(analysisChips(o, null)).toEqual([{ kind: "effect", effect: "read", declared: "read", tone: "ok" }]);
    const m = reviewCardModel([o], false, NOW);
    expect(m.kind === "card" && m.risk).toBe("safe");
    expect(m.kind === "card" && m.mismatch).toBe(false);
  });

  it("선언과 다름(읽기라 했지만 원문에 삭제) · sudo — 실패색 칩 · 두 번 눌러 승인", () => {
    const o = op({
      command: 'sudo find /var/log -name "*.gz" -mtime +7 -delete',
      effect: "read",
      mismatch: true,
      analysis: { effect: "delete", cause: "find -delete", programs: ["find"], sudo: true },
    });
    const chips = analysisChips(o, "대상 호스트에 무인 실행이 위임되지 않았습니다");
    expect(chips[0]).toEqual({ kind: "mismatch", effect: "delete", cause: "find -delete", declared: "read", tone: "err" });
    expect(chips.map((c) => c.kind)).toEqual(["mismatch", "sudo", "refused"]);
    const m = reviewCardModel([o], false, NOW);
    expect(m.kind === "card" && m.risk).toBe("dangerous");
    expect(m.kind === "card" && m.mismatch).toBe(true);
  });

  it("DB DELETE — WHERE 있음은 보통 칩 · 없음은 실패색 칩 + 위험 · 상한 칩", () => {
    const plan: DbPlan = {
      connId: "c1",
      connName: "prod",
      engine: "postgres",
      throughSsh: false,
      statements: [{ sql: "DELETE FROM users WHERE id = 1", keyword: "DELETE", counted: true, uncounted: false }],
      maxAffected: 1,
      timeoutSeconds: 30,
    };
    const withWhere = op({
      db: plan,
      effect: "delete",
      mismatch: false,
      analysis: { effect: "delete", cause: "DELETE users", statements: [{ keyword: "DELETE", table: "users", whereClause: true, effect: "delete" }] },
    });
    expect(analysisChips(withWhere, null)).toEqual([
      { kind: "effect", effect: "delete", declared: "delete", tone: "plain" },
      { kind: "stmt", keyword: "DELETE", keywordTone: "err", table: "users", where: true, tone: "plain" },
      { kind: "limit", n: 1, tone: "plain" },
    ]);
    expect(hasUnboundedWrite(withWhere)).toBe(false);
    const m1 = reviewCardModel([withWhere], false, NOW);
    expect(m1.kind === "card" && m1.risk).toBe("safe");

    const noWhere = op({
      db: plan,
      effect: "delete",
      analysis: { effect: "delete", statements: [{ keyword: "DELETE", table: "users", whereClause: false, effect: "delete" }] },
    });
    expect(analysisChips(noWhere, null)[1]).toEqual({
      kind: "stmt",
      keyword: "DELETE",
      keywordTone: "err",
      table: "users",
      where: false,
      tone: "err",
    });
    const m2 = reviewCardModel([noWhere], false, NOW);
    expect(m2.kind === "card" && m2.risk).toBe("dangerous");
  });

  it("옛 작업안(설명 · 분석 없음)은 칩이 없다 — 자동 승인 거부 사유만 있으면 그것 하나", () => {
    expect(analysisChips(op(), null)).toEqual([]);
    expect(analysisChips(op(), "거부")).toEqual([{ kind: "refused", reason: "거부", tone: "plain" }]);
    const m = reviewCardModel([op()], false, NOW);
    expect(m.kind === "card" && m.chips).toEqual([]);
  });

  it("가림막 아래에는 칩도 설명도 없다 — 개수뿐", () => {
    const o = op({ summary: "비밀스러운 설명", effect: "read", analysis: { effect: "read" } });
    expect(reviewCardModel([o], true, NOW)).toEqual({ kind: "veiled", count: 1 });
  });
});

describe("approvalRisk — 검토 카드 · 작업안 카드의 같은 판정", () => {
  it("선언과 다름 · WHERE 없는 쓰기는 위험, 그 밖은 예전 판정 그대로", () => {
    expect(approvalRisk(op({ command: "uptime" }))).toBe("safe");
    expect(approvalRisk(op({ command: "rm -rf /tmp/x" }))).toBe("dangerous");
    expect(approvalRisk(op({ command: "uptime", mismatch: true }))).toBe("dangerous");
    expect(
      approvalRisk(op({ analysis: { effect: "write", statements: [{ keyword: "UPDATE", whereClause: false, effect: "write" }] } })),
    ).toBe("dangerous");
  });

  it("파일을 쓰지 않는 리다이렉트(2>&1 · /dev/null)는 위험으로 치지 않는다 · 파일로 가는 > 는 그대로 위험", () => {
    expect(approvalRisk(op({ command: "curl -sv https://x/ 2>&1 | grep HTTP" }))).toBe("safe");
    expect(approvalRisk(op({ command: "ls /nope 2>/dev/null; ls >&2; cat x &>/dev/null; echo a >&-" }))).toBe("safe");
    expect(approvalRisk(op({ command: "echo a > /etc/x" }))).toBe("dangerous");
    expect(approvalRisk(op({ command: "echo a >> log.txt 2>&1" }))).toBe("dangerous");
    expect(approvalRisk(op({ command: "echo a >/dev/nullx" }))).toBe("dangerous");
    expect(approvalRisk(op({ command: "rm -f x 2>/dev/null" }))).toBe("dangerous");
  });

  it("앱 분석이 읽기로 확정한 명령의 sudo 는 위험으로 치지 않는다 · 읽기가 아니거나 분석이 없으면 그대로 위험", () => {
    const read = { effect: "read" as const };
    expect(approvalRisk(op({ command: "sudo journalctl -u nginx -n 50", analysis: read }))).toBe("safe");
    expect(approvalRisk(op({ command: "sudo ss -tlnp 2>&1 | grep 443", analysis: read }))).toBe("safe");
    expect(approvalRisk(op({ command: "sudo journalctl -u nginx" }))).toBe("dangerous");
    expect(approvalRisk(op({ command: "sudo systemctl restart nginx", analysis: { effect: "write" } }))).toBe("dangerous");
    expect(approvalRisk(op({ command: "sudo bash -c x", analysis: { effect: "unknown" } }))).toBe("dangerous");
    // sudo 만 걷는다 — 다른 위험 낱말은 읽기여도 그대로
    expect(approvalRisk(op({ command: "sudo su - postgres -c psql", analysis: read }))).toBe("dangerous");
  });
});

/**
 * "승인은 명령 전문이 보이는 자리에서만"(10-22) — 잘린 채 펼치지 않은 명령의 첫 [승인]은 펼치기, 그다음이 승인(위험이면 확인 상태).
 */
describe("approveStep — 잘린 명령은 먼저 펼친다 · 두 번을 넘지 않는다", () => {
  it("잘림 + 안전 → reveal · 잘림 + 위험 → arm(펼치기 겸함) · 다 보임 + 안전 → approve · 다 보임 + 위험 → arm → approve", () => {
    expect(approveStep({ hidden: true, risky: false, armed: false })).toBe("reveal");
    expect(approveStep({ hidden: true, risky: true, armed: false })).toBe("arm");
    // 확인 상태에서 다시 접었다면 승인 전에 다시 펼친다
    expect(approveStep({ hidden: true, risky: true, armed: true })).toBe("reveal");
    expect(approveStep({ hidden: false, risky: false, armed: false })).toBe("approve");
    expect(approveStep({ hidden: false, risky: true, armed: false })).toBe("arm");
    expect(approveStep({ hidden: false, risky: true, armed: true })).toBe("approve");
  });
});

/** AI 가 적은 이유(10-22 사용자 결정) — 작은 카드에는 없고 펼친 카드에만, 이유가 있으면 명령이 짧아도 [전체 보기] 가 선다 */
describe("reasonShown · hasFoldedDetail — 이유는 펼친 카드에만", () => {
  it("작은 카드에는 없다 · 펼치면 있다 · 빈 이유는 없다", () => {
    const o = op({ reason: "  디스크 경보가 와서  " });
    expect(reasonShown(o, false)).toBeNull();
    expect(reasonShown(o, true)).toBe("디스크 경보가 와서");
    expect(reasonShown(op({ reason: "   " }), true)).toBeNull();
    expect(reasonShown(op(), true)).toBeNull();
    expect(hasFoldedDetail(o)).toBe(true);
    expect(hasFoldedDetail(op())).toBe(false);
  });
});

/**
 * 판결 띠(10-24 "A + 명령 나눠 보기") — 카드 맨 위 한 문장. 판정은 Rust 의 `mismatch` · 줄마다의 `over` 그대로 세기만 한다.
 * 차례: 분석 없음 → 어긋남 → WHERE 없는 쓰기 → 위험 → 일치.
 */
describe("verdictOf — 판결 띠", () => {
  /** 목업의 긴 명령(9줄 · 2 4 6 8 은 echo 머리 줄) — 9번째 줄만 `over` */
  const LINES: CommandLine[] = [
    { text: "date -u", sep: ";", effect: "read" },
    { text: 'echo "-- curl verbose"', sep: ";", effect: "read", quiet: true },
    { text: "curl -sv … | grep … | head -20", sep: ";", effect: "read" },
    { text: 'echo "-- no-verify"', sep: ";", effect: "read", quiet: true },
    { text: "curl -sk …", sep: ";", effect: "read" },
    { text: 'echo "-- SNI"', sep: ";", effect: "read", quiet: true },
    { text: "curl -sk --resolve …", sep: ";", effect: "read" },
    { text: 'echo "-- openssl"', sep: ";", effect: "read", quiet: true },
    { text: "echo | timeout 10 openssl s_client … | grep …", effect: "unknown", cause: "openssl", over: true },
  ];

  it("분석 없는 옛 작업안 — 위험이면 '주의' (실패색), 아니면 '검토 대기' (중성)", () => {
    expect(verdictOf(op(), "safe")).toEqual({ tone: "neutral", key: "pending", args: {} });
    expect(verdictOf(op({ command: "rm -rf /tmp/x" }), "dangerous")).toEqual({ tone: "err", key: "attention", args: {} });
  });

  it("어긋남 + 줄 둘 이상 — n줄 중 m줄 · 가장 센 줄의 효과 · 근거", () => {
    const o = op({ effect: "read", mismatch: true, analysis: { effect: "unknown", cause: "openssl", lines: LINES } });
    expect(verdictOf(o, approvalRisk(o))).toEqual({
      tone: "err",
      key: "mismatchLines",
      args: { declared: "read", found: "unknown", cause: "openssl", n: 9, m: 1 },
    });
    // 센 줄이 여럿이면 가장 센 것(삭제 > 판단 못 함 > 쓰기)을 말하고 m 은 전부 센다
    const two = LINES.map((l, i) => (i === 0 ? { ...l, effect: "delete" as const, cause: "rm", over: true } : l));
    const v = verdictOf(op({ effect: "read", mismatch: true, analysis: { effect: "delete", lines: two } }), "dangerous");
    expect(v.args).toEqual({ declared: "read", found: "delete", cause: "rm", n: 9, m: 2 });
  });

  it("어긋남 + 한 줄 명령 — 원문에 {found}({cause})", () => {
    const o = op({
      command: 'sudo find /var/log -name "*.gz" -mtime +7 -delete',
      effect: "read",
      mismatch: true,
      analysis: { effect: "delete", cause: "find -delete", sudo: true },
    });
    expect(verdictOf(o, "dangerous")).toEqual({
      tone: "err",
      key: "mismatch",
      args: { declared: "read", found: "delete", cause: "find -delete" },
    });
  });

  it("WHERE 없는 DB 쓰기 → unbounded · 그 밖의 위험 → danger(선언 있으면 '· 일치')", () => {
    const o = op({
      effect: "write",
      analysis: { effect: "write", statements: [{ keyword: "UPDATE", whereClause: false, effect: "write" }] },
    });
    expect(verdictOf(o, approvalRisk(o)).key).toBe("unbounded");
    const rm = op({ command: "rm -rf /tmp/x", effect: "delete", analysis: { effect: "delete", cause: "rm" } });
    expect(verdictOf(rm, approvalRisk(rm))).toEqual({ tone: "err", key: "dangerMatched", args: {} });
    const old = op({ command: "rm -rf /tmp/x", analysis: { effect: "delete", cause: "rm" } });
    expect(verdictOf(old, "dangerous").key).toBe("danger");
  });

  it("일치 — 읽기 초록 · 쓰기 중성 · 삭제 경고 · 판단 못 함은 AI 선언을 함께 · 선언 없으면 '· 일치' 없이", () => {
    const readLines = LINES.map((l) => ({ ...l, effect: "read" as const, over: false }));
    const read = op({ effect: "read", mismatch: false, analysis: { effect: "read", lines: readLines } });
    expect(verdictOf(read, approvalRisk(read))).toEqual({ tone: "ok", key: "effectMatched", args: { found: "read" } });
    expect(verdictOf(op({ effect: "write", analysis: { effect: "write" } }), "safe")).toEqual({
      tone: "neutral",
      key: "effectMatched",
      args: { found: "write" },
    });
    expect(verdictOf(op({ effect: "delete", analysis: { effect: "delete" } }), "safe").tone).toBe("warn");
    expect(verdictOf(op({ effect: "write", analysis: { effect: "unknown" } }), "safe")).toEqual({
      tone: "warn",
      key: "unknownMatched",
      args: { declared: "write" },
    });
    expect(verdictOf(op({ analysis: { effect: "read" } }), "safe")).toEqual({ tone: "ok", key: "effect", args: { found: "read" } });
  });

  it("모델이 띠를 싣는다", () => {
    const m = reviewCardModel([op({ effect: "read", analysis: { effect: "read" } })], false, NOW);
    expect(m.kind === "card" && m.verdict.key).toBe("effectMatched");
  });
});

describe("splitLines · shownSep — 명령 나눠 보기", () => {
  const two: CommandLine[] = [
    { text: "a", sep: "&&", effect: "read" },
    { text: "b", effect: "read" },
  ];
  it("셸 작업안 + Rust 줄이 하나라도 있으면 그 줄들 · DB · 읽기 한 줄 · 옛 작업안은 null", () => {
    expect(splitLines(op({ analysis: { effect: "read", lines: two } }))).toEqual(two);
    // Rust 가 실은 한 줄(읽기가 아닌 한 줄 명령 — 줄 안 표시까지)은 그대로
    const one: CommandLine[] = [{ text: "rm -f x", effect: "delete", cause: "rm", marks: [{ start: 0, end: 2, effect: "delete" }] }];
    expect(splitLines(op({ command: "rm -f x", analysis: { effect: "delete", cause: "rm", lines: one } }))).toEqual(one);
    expect(splitLines(op({ analysis: { effect: "read" } }))).toBeNull();
    expect(splitLines(op())).toBeNull();
    // 폴백 — `lines` 없는 옛 작업안이라도 읽기가 아니면 한 행으로 — 효과 · 근거 · over 는 작업안 전체 분석 그대로
    expect(splitLines(op({ command: " rm -f x ", mismatch: true, analysis: { effect: "delete", cause: "rm" } }))).toEqual([
      { text: "rm -f x", effect: "delete", cause: "rm", over: true },
    ]);
    expect(splitLines(op({ command: "systemctl restart cron", analysis: { effect: "write", cause: "systemctl restart" } }))).toEqual([
      { text: "systemctl restart cron", effect: "write", cause: "systemctl restart", over: false },
    ]);
    const db: DbPlan = {
      connId: "c",
      connName: "c",
      engine: "sqlite",
      throughSsh: false,
      statements: [],
      maxAffected: 1,
      timeoutSeconds: 1,
    };
    // DB 작업안도 Rust 가 실은 문장 줄이 있으면 그 줄들(10-24) — 없으면(옛 서버) SQL 강조 접기 상자 그대로(폴백 한 행도 없다)
    const stmts: CommandLine[] = [{ text: "DELETE FROM users", sep: ";", effect: "delete", cause: "DELETE users · WHERE 없음", danger: true }];
    expect(splitLines(op({ analysis: { effect: "delete", lines: stmts }, db }))).toEqual(stmts);
    expect(splitLines(op({ command: "DELETE FROM users;", analysis: { effect: "delete", cause: "DELETE users" }, db }))).toBeNull();
    // 읽기 한 줄 + sudo 표시 — Rust 가 실었으면 그대로(낱말만 칠한다)
    const sudo: CommandLine[] = [{ text: "sudo ls", effect: "read", marks: [{ start: 0, end: 4, effect: "read", kind: "sudo" }] }];
    expect(splitLines(op({ command: "sudo ls", analysis: { effect: "read", sudo: true, lines: sudo } }))).toEqual(sudo);
  });
  it("줄 표시 — 읽기 · echo 줄은 없음, 쓰기 · 판단 못 함 경고, 삭제 · AI 설명보다 센 줄 실패", () => {
    expect(lineMark({ effect: "read" })).toBeNull();
    expect(lineMark({ effect: "read", quiet: true })).toBeNull();
    expect(lineMark({ effect: "write" })).toBe("warn");
    expect(lineMark({ effect: "unknown" })).toBe("warn");
    expect(lineMark({ effect: "delete" })).toBe("err");
    expect(lineMark({ effect: "write", over: true })).toBe("err");
    // DB 의 위험한 줄(WHERE 없는 UPDATE 등) — 효과와 무관하게 실패색
    expect(lineMark({ effect: "write", danger: true })).toBe("err");
    expect(lineMark({ effect: "write", danger: false })).toBe("warn");
  });
  it("markSegments — 코드 포인트 자리로 자른다 · 이상한 자리는 버린다 · 글자는 잃지 않는다", () => {
    const join = (segs: { text: string }[]) => segs.map((x) => x.text).join("");
    const text = "sudo find /var/log -delete";
    expect(markSegments(text, [{ start: 5, end: 9, effect: "delete" }, { start: 19, end: 26, effect: "delete" }])).toEqual([
      { text: "sudo ", effect: null },
      { text: "find", effect: "delete" },
      { text: " /var/log ", effect: null },
      { text: "-delete", effect: "delete" },
    ]);
    // 한글 · 이모지 — Rust chars() 와 같은 자리(UTF-16 색인이 아니다)
    const ko = "echo '😀 한글' > /tmp/f";
    const segs = markSegments(ko, [{ start: 12, end: 13, effect: "write" }]);
    expect(segs.find((x) => x.effect)?.text).toBe(">");
    expect(join(segs)).toBe(ko);
    // sudo 낱말 — 갈래를 싣는다(화면은 효과와 무관하게 경고색)
    expect(markSegments("sudo ls", [{ start: 0, end: 4, effect: "read", kind: "sudo" }])).toEqual([
      { text: "sudo", effect: "read", kind: "sudo" },
      { text: " ls", effect: null },
    ]);
    // 표시 없음 · 빈 배열 → 원문 한 조각
    expect(markSegments("ls", undefined)).toEqual([{ text: "ls", effect: null }]);
    expect(markSegments("", [])).toEqual([{ text: "", effect: null }]);
    // 범위 밖 · 거꾸로 · 겹침 · 정수 아님은 버린다
    const bad = markSegments("rm -rf x", [
      { start: 0, end: 2, effect: "delete" },
      { start: 1, end: 4, effect: "write" },
      { start: 6, end: 5, effect: "write" },
      { start: 7, end: 99, effect: "write" },
      { start: 2.5, end: 3, effect: "write" },
    ]);
    expect(bad.filter((x) => x.effect).map((x) => x.text)).toEqual(["rm"]);
    expect(join(bad)).toBe("rm -rf x");
  });
  it("줄 끝 구분자는 && || & 만 보인다", () => {
    const seps: CommandLine["sep"][] = [";", "&&", "||", "&", "\n", undefined];
    expect(seps.map(shownSep)).toEqual([null, "&&", "||", "&", null, null]);
  });
  it("표지 점 색 — 읽기 흐림 · 쓰기 · 판단 못 함 경고 · 삭제 실패", () => {
    expect((["read", "write", "unknown", "delete"] as const).map(effectTone)).toEqual(["plain", "warn", "warn", "err"]);
  });
});

