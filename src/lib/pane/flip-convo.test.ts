import { describe, expect, it } from "vitest";
import { REMOTE_REFRESH_RETRY_MS, STOP_GAP_MS, convoNotYet, mayRefreshRemote, phoneOpensConvo, stopReady, stopShown } from "./flip-convo";

describe("stopShown — 중지 단추는 일하는 중에만", () => {
  it("running 이고 카드가 없으면 보인다", () => {
    expect(stopShown({ status: "running", cards: 0 })).toBe(true);
  });
  it("권한을 묻는 중 · 끝남 · 신호 없음이면 숨는다", () => {
    expect(stopShown({ status: "permission", cards: 0 })).toBe(false);
    expect(stopShown({ status: "finished", cards: 0 })).toBe(false);
    expect(stopShown({ status: null, cards: 0 })).toBe(false);
  });
  it("권한 카드가 서 있으면 숨는다(카드의 단추가 답이다)", () => {
    expect(stopShown({ status: "running", cards: 1 })).toBe(false);
  });
});

describe("stopReady — 연타 방지", () => {
  it("처음은 보낸다", () => {
    expect(stopReady(null, 5)).toBe(true);
  });
  it("틈 안의 다시 누름은 버리고 틈이 지나면 보낸다", () => {
    expect(stopReady(1000, 1000 + STOP_GAP_MS - 1)).toBe(false);
    expect(stopReady(1000, 1000 + STOP_GAP_MS)).toBe(true);
  });
});

describe("convoNotYet — 대화 파일이 아직 없음", () => {
  it("한 번도 못 받았고 턴이 끝나지 않았으면 아직 없음", () => {
    expect(convoNotYet({ loaded: false, turnEnded: false })).toBe(true);
  });
  it("한 번이라도 받았으면 오류", () => {
    expect(convoNotYet({ loaded: true, turnEnded: false })).toBe(false);
  });
  it("턴이 끝났는데도 못 받으면 오류", () => {
    expect(convoNotYet({ loaded: false, turnEnded: true })).toBe(false);
  });
  it("원격 세션이 사라진 것은 늘 오류", () => {
    expect(convoNotYet({ loaded: false, turnEnded: false, gone: true })).toBe(false);
  });
});

describe("mayRefreshRemote — 원격 목록 다시 읽기", () => {
  it("처음은 읽는다", () => {
    expect(mayRefreshRemote(undefined, false, 0)).toBe(true);
    expect(mayRefreshRemote(undefined, true, 0)).toBe(true);
  });
  it("아직 못 받은 대화는 틈마다 한 번", () => {
    expect(mayRefreshRemote(0, false, REMOTE_REFRESH_RETRY_MS - 1)).toBe(false);
    expect(mayRefreshRemote(0, false, REMOTE_REFRESH_RETRY_MS)).toBe(true);
  });
  it("받은 적 있는 대화는 다시 읽지 않는다", () => {
    expect(mayRefreshRemote(0, true, REMOTE_REFRESH_RETRY_MS * 10)).toBe(false);
  });
});

describe("phoneOpensConvo — 폰의 첫 화면", () => {
  const on = { layout: true, pref: "convo", flippable: true, shown: true, opened: false } as const;
  it("폰 배치 · 첫 화면 대화 · 넘길 수 있고 · 보이고 · 아직 안 열었으면 연다", () => {
    expect(phoneOpensConvo(on)).toBe(true);
  });
  it("넓은 창은 열지 않는다", () => {
    expect(phoneOpensConvo({ ...on, layout: false })).toBe(false);
  });
  it("옵션이 터미널이면 열지 않는다", () => {
    expect(phoneOpensConvo({ ...on, pref: "term" })).toBe(false);
  });
  it("AI 타일이 아니면 열지 않는다", () => {
    expect(phoneOpensConvo({ ...on, flippable: false })).toBe(false);
  });
  it("숨은 탭의 타일은 열지 않는다", () => {
    expect(phoneOpensConvo({ ...on, shown: false })).toBe(false);
  });
  it("이번 CLI 에서 이미 열었으면 다시 넘기지 않는다 — 사람이 터미널로 돌린 뒤", () => {
    expect(phoneOpensConvo({ ...on, opened: true })).toBe(false);
  });
});
