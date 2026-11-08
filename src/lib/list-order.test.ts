import { describe, expect, it } from "vitest";
import { compareNames, compareRecent } from "./list-order";

describe("독 목록의 순서 비교 (호스트 · 프로젝트 · DB 칸이 같이 쓴다)", () => {
  it("이름순 — 대소문자 무시 · 숫자 자연순 · 한글 가나다", () => {
    const names = ["web-10", "Zeta", "web-2", "alpha", "Beta"];
    expect([...names].sort(compareNames)).toEqual(["alpha", "Beta", "web-2", "web-10", "Zeta"]);
    // 한글끼리는 가나다 — 한글과 라틴 사이 차례는 실행 환경 로캘이 정한다(ko 면 한글 먼저)라 여기서 굳히지 않는다
    expect(["운영", "개발", "보관"].sort(compareNames)).toEqual(["개발", "보관", "운영"]);
  });

  it("대소문자만 다른 두 이름도 늘 같은 차례로 선다 (입력 순서와 무관)", () => {
    expect(["web", "Web"].sort(compareNames)).toEqual(["Web", "web"].sort(compareNames));
    expect(compareNames("a", "a")).toBe(0);
  });

  it("최근순 — 늦은 것 먼저 · 시각 없는 것 뒤 · 같으면 0(이름으로 가를 몫)", () => {
    expect([null, 1, 3, null, 2].sort(compareRecent)).toEqual([3, 2, 1, null, null]);
    expect(compareRecent(null, null)).toBe(0);
    expect(compareRecent(5, 5)).toBe(0);
  });
});
