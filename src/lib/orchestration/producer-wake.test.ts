// 오케스트레이션 2단계 단계 4 — 앱이 깨움의 화면 층(aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md 3-6 · 5-2 · M21 · O6).
import { describe, expect, it } from "vitest";
import { albumBusy, albumEnded, isWakeWhat, producerActivity, WAKE_WHATS, wakeBanner, wakeChips, wakeMarks } from "./model/producer";
import { NOTICE_KEY, noticeText } from "./model/events";
import { isProducerEvent } from "./producer-api";
import { ko } from "$lib/i18n/ko/index";

const hex = (c: string) => c.repeat(32);
const T1 = `task-${hex("1")}`;
const T2 = `task-${hex("2")}`;
const A1 = `att-${hex("a")}`;

describe("깨움 알약 — id → 트랙 번호(서버 문장은 쓰지 않는다)", () => {
  const d = { tasks: [{ id: T1 }, { id: T2 }], attempts: [{ id: A1, taskId: T2 }] };
  it("Task 는 순서 번호 · Attempt 는 그 Task 의 번호 · 앨범 단위는 빈 글자", () => {
    const chips = wakeChips(
      [
        { what: "reported-success", taskId: T2, attemptId: A1 },
        { what: "blocked", taskId: null, attemptId: A1 },
        { what: "integrated", taskId: T1, attemptId: null },
        { what: "person-resumed", taskId: null, attemptId: null },
      ],
      d,
    );
    expect(chips).toEqual([
      { no: "#2", what: "reported-success" },
      { no: "#2", what: "blocked" },
      { no: "#1", what: "integrated" },
      { no: "", what: "person-resumed" },
    ]);
  });
  it("상세를 못 읽었으면 짧은 id", () => {
    expect(wakeChips([{ what: "integrated", taskId: T1, attemptId: null }], null)).toEqual([{ no: "11111111", what: "integrated" }]);
    expect(wakeChips([{ what: "blocked", taskId: null, attemptId: A1 }], null)).toEqual([{ no: "aaaaaaaa", what: "blocked" }]);
  });
  it("서버 열거 낱말마다 화면 문구가 있다 · 모르는 낱말은 그대로", () => {
    for (const w of WAKE_WHATS) expect((ko.orch as Record<string, string>)[`producer.wake.what.${w}`], w).toBeTruthy();
    expect(isWakeWhat("rm -rf")).toBe(false);
  });
});

describe("M21 — 기록 출처(앨범의 예약 기록과 한 번씩 · 표시용)", () => {
  const rec = (wakeId: string, sha: string, at: number, chat = "pc-a") => ({ wakeId, chat, sha, fromSeq: 4, toSeq: 9, at });
  const user = (sha: string | null, at: number | null) => ({ role: "user", at, wake: sha ? { sha } : null });
  it("진짜 깨움은 알약 · 사람이 같은 문장을 그대로 쳐도 그 기록은 이미 앞의 깨움이 가져갔다 → 앱 기록 없음", () => {
    const marks = wakeMarks([user("s1", 1000), { role: "assistant", at: 1100 }, user("s1", 5000), user(null, 6000)], [rec("w1", "s1", 990)], "pc-a");
    expect(marks[0]).toEqual({ kind: "wake", record: { wakeId: "w1", fromSeq: 4, toSeq: 9 } });
    expect(marks[1]).toBeNull();
    expect(marks[2]).toEqual({ kind: "unrecorded" });
    expect(marks[3]).toBeNull();
  });
  it("다른 채팅의 기록 · 예약보다 앞선 말 · 기록 없는 꼴은 깨움이 아니다", () => {
    expect(wakeMarks([user("s1", 1000)], [rec("w1", "s1", 990, "pc-b")], "pc-a")).toEqual([{ kind: "unrecorded" }]);
    expect(wakeMarks([user("s1", 100)], [rec("w1", "s1", 10_000)], "pc-a")).toEqual([{ kind: "unrecorded" }]);
    expect(wakeMarks([user("s1", 1000)], [], "pc-a")).toEqual([{ kind: "unrecorded" }]);
  });
  it("재시도(같은 문장 · 기록 둘)는 둘 다 알약", () => {
    const marks = wakeMarks([user("s1", 1000), user("s1", 30_000)], [rec("w1", "s1", 990), rec("w2", "s1", 29_000)], "pc-a");
    expect(marks.map((m) => m?.kind)).toEqual(["wake", "wake"]);
  });
});

describe("깨움 꺼짐 띠 · 사건", () => {
  it("도는 앨범에서 꺼졌을 때만 · 까닭과 셈을 싣는다", () => {
    const w = { off: "segment-max", segment: 30, cap: 30, total: 41, max: 200, live: null };
    expect(wakeBanner(w, "running")).toEqual({ why: "segment-max", segment: 30, cap: 30, total: 41, max: 200 });
    expect(wakeBanner({ ...w, off: null }, "running")).toBeNull();
    expect(wakeBanner(w, "paused")).toBeNull();
    expect(wakeBanner(null, "running")).toBeNull();
    for (const why of ["segment-max", "off", "run-max", "unresponsive", "failed"]) {
      expect((ko.orch as Record<string, string>)[`producer.wake.off.${why}`], why).toBeTruthy();
    }
  });
  it("`woken` 사건은 봉투를 지난다", () => {
    const ev = { chat: "pc-a", epoch: 3, seq: 7, ev: { t: "woken", wake: { wakeId: "w", runId: "r", gen: 1, fromSeq: 0, toSeq: 4, items: [], more: 0, resync: false } } };
    expect(isProducerEvent(ev, "pc-a")).toBe(true);
  });
});

describe("실기 b 고침", () => {
  const O = ko.orch as Record<string, string>;
  const K = (k: string) => O[k.replace(/^orch\./, "")] ?? `?${k}`;
  const tr = (k: string, v?: Record<string, string | number>) => {
    let out = K(k);
    for (const [n, x] of Object.entries(v ?? {})) out = out.replace(`{${n}}`, String(x));
    return out;
  };
  it("A — 깨움 알림 넷은 제 문구 키가 있고(“사람이 볼 일” 아님) · wake-limit 은 까닭별", () => {
    for (const k of ["wake-limit", "wake-ignored", "wake-failed", "wake-turn-timeout"]) {
      expect(NOTICE_KEY[k]).toBe(`orch.notice.${k}`);
      expect(K(NOTICE_KEY[k])).not.toMatch(/^\?/);
    }
    const n = { kind: "wake-limit", runName: "앨범", taskTitle: null, attemptId: null };
    expect(noticeText({ ...n, detail: "segment-max" }, tr as never)).toBe(`앨범 · 앨범 — ${K("orch.notice.wake-limit.segment-max")}`);
    expect(noticeText({ ...n, detail: "run-max" }, tr as never)).toContain("200");
    expect(noticeText({ ...n, detail: "?" }, tr as never)).toBe(`앨범 · 앨범 — ${K("orch.notice.wake-limit")}`);
    expect(noticeText({ ...n, kind: "wake-ignored" }, tr as never)).not.toContain(K("orch.notice.other"));
  });
  it("E — 끝난 앨범 = 서버 이어받기 판정 why ended", () => {
    expect(albumEnded({ adoptable: { why: "ended" } })).toBe(true);
    expect(albumEnded({ adoptable: { why: "paused-by-person" } })).toBe(false);
    expect(albumEnded({ adoptable: { why: "running" } })).toBe(false);
    expect(albumEnded(null)).toBe(false);
  });
  it("G — 도는 앨범이라도 도는 아티스트 · 판정 · 통합이 없으면 쉼(말하면 이어 감)", () => {
    const base = { readOnly: false, life: "live" as const, gone: false, status: "ready", sending: false, pending: 0 };
    const idleSum = { running: { write: 0, judge: 0 }, taskStates: { accepted: 2 } };
    expect(albumBusy(idleSum)).toBe(false);
    expect(albumBusy({ running: { write: 0, judge: 0 }, taskStates: { integrating: 1 } })).toBe(true);
    expect(albumBusy({ running: { write: 1, judge: 0 } })).toBe(true);
    expect(producerActivity({ ...base, album: { state: "running", busy: false } })).toBe("rest");
    expect(producerActivity({ ...base, album: { state: "running", busy: true } })).toBe("waiting");
    expect(producerActivity({ ...base, album: { state: "running" } })).toBe("waiting");
    expect(K("orch.producer.act.rest")).toContain("말하면");
  });
});
