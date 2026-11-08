import { describe, expect, it } from "vitest";
import type { Tr } from "$lib/finish-notify";
import { translate } from "$lib/i18n/dict";
import type { Operation } from "$lib/operations";
import { planNotification } from "$lib/review-notify";

/**
 * 검토 요청 OS 알림의 **판정** (docs/log/2026-09-22-review-notify.md).
 *
 * 실제 발사(`app/os-notify.ts`)도 권한도 여기 없다 — 이 파일이 고정하는 것은 "무엇이
 * 새것인가 · 쏠 것인가 · 뭐라고 적을 것인가" 셋뿐이다. 문구를 내는 함수는 `finish-notify`
 * 와 같은 방식으로 **인자로 들어온다**(사전의 순수한 속 `translate`).
 */

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

const NOW = 1_700_000_000_000;

/** 알림 제목 앞머리 — 화면 쪽은 `app/os-notify` 의 `APP` 을 넘긴다 */
const TITLE = "aynx";

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

/** 쏘는 판 — 켜져 있고 창은 뒤에 있고 첫 갱신은 이미 지났다 */
const LIVE = { enabled: true, focused: false, seeded: true, title: TITLE };

describe("planNotification — 무엇이 새것인가", () => {
  it("첫 갱신은 **씨앗만 뿌린다** — 부팅 때 이미 기다리던 것으로는 알리지 않는다", () => {
    const r = planNotification(
      new Set(),
      [op({ operationId: "a" }), op({ operationId: "b" })],
      { ...LIVE, seeded: false },
      ko,
    );
    expect(r.notice).toBe(null);
    // 그래도 집합은 채워진다 — 다음 갱신에서 이것들이 "새것" 이 되면 안 된다.
    expect([...r.nextSeen].sort()).toEqual(["a", "b"]);
  });

  it("이미 본 id 는 다시 쏘지 않는다 (갱신은 같은 목록을 통째로 다시 읽는다)", () => {
    const pending = [op({ operationId: "a" }), op({ operationId: "b" })];
    const r = planNotification(new Set(["a", "b"]), pending, LIVE, ko);
    expect(r.notice).toBe(null);
    expect([...r.nextSeen].sort()).toEqual(["a", "b"]);
  });

  it("떠난 id 는 집합에서 빠진다 — 며칠 켜 둬도 자라지 않는다", () => {
    // 승인·거절·만료로 a·b 가 목록을 떠나고 c 하나만 남았다.
    const r = planNotification(new Set(["a", "b"]), [op({ operationId: "c" })], LIVE, ko);
    expect([...r.nextSeen]).toEqual(["c"]);
    // 방금 알린 c 는 물론 그 안에 있다(다음 갱신에서 다시 쏘면 안 된다).
    expect(r.notice).not.toBe(null);
    expect(planNotification(r.nextSeen, [op({ operationId: "c" })], LIVE, ko).notice).toBe(null);
  });
});

describe("planNotification — 쏠 것인가", () => {
  it("켜져 있고 창이 뒤에 있고 새것이 하나 → **한 줄 요약 + 대상 수**", () => {
    const r = planNotification(
      new Set(),
      [op({ operationId: "a", title: "nginx 재시작", targets: ["s1", "s2"] })],
      LIVE,
      ko,
    );
    expect(r.notice).toEqual({ title: TITLE, body: "승인 대기: nginx 재시작 · 대상 2" });
  });

  it("제목이 없으면 명령문 **첫 줄 발췌**가 그 자리에 선다 (전문은 절대 안 나간다)", () => {
    const r = planNotification(
      new Set(),
      [op({ operationId: "a", title: null, command: "df -h\nfree -m\nuptime" })],
      LIVE,
      ko,
    );
    expect(r.notice?.body).toBe("승인 대기: df -h… · 대상 1");
  });

  it("한 갱신에 여러 건이 새로 오면 **알림은 한 장**이다 (개수만)", () => {
    const r = planNotification(
      new Set(["a"]),
      [op({ operationId: "a" }), op({ operationId: "b" }), op({ operationId: "c" })],
      LIVE,
      ko,
    );
    expect(r.notice).toEqual({ title: TITLE, body: "승인 대기 2건" });
    expect([...r.nextSeen].sort()).toEqual(["a", "b", "c"]);
  });

  it("창이 앞에 있으면 안 쏜다 — 그래도 **본 것으로 친다**", () => {
    const r = planNotification(new Set(), [op({ operationId: "a" })], { ...LIVE, focused: true }, ko);
    expect(r.notice).toBe(null);
    expect([...r.nextSeen]).toEqual(["a"]);
    // 창에서 눈을 떼는 순간 그동안 쌓인 대기가 한꺼번에 쏟아지면 안 된다.
    expect(planNotification(r.nextSeen, [op({ operationId: "a" })], LIVE, ko).notice).toBe(null);
  });

  it("설정을 꺼 두면 안 쏜다 — 이쪽도 **본 것으로 친다**", () => {
    const r = planNotification(
      new Set(),
      [op({ operationId: "a" })],
      { ...LIVE, enabled: false },
      ko,
    );
    expect(r.notice).toBe(null);
    expect([...r.nextSeen]).toEqual(["a"]);
    expect(planNotification(r.nextSeen, [op({ operationId: "a" })], LIVE, ko).notice).toBe(null);
  });

  it("대기가 비면 쏠 것도 기억할 것도 없다", () => {
    const r = planNotification(new Set(["a"]), [], LIVE, ko);
    expect(r.notice).toBe(null);
    expect(r.nextSeen.size).toBe(0);
  });

  it("배선이 정말 사전을 지난다 — 영어도 같은 두 갈래", () => {
    const one = planNotification(
      new Set(),
      [op({ operationId: "a", title: "Restart nginx", targets: ["s1", "s2", "s3"] })],
      LIVE,
      en,
    );
    expect(one.notice?.body).toBe("Awaiting approval: Restart nginx · 3 targets");

    const many = planNotification(
      new Set(),
      [op({ operationId: "a" }), op({ operationId: "b" })],
      LIVE,
      en,
    );
    expect(many.notice?.body).toBe("2 plans awaiting approval");
  });
});
