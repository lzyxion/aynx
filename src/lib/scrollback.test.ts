import { describe, expect, it } from "vitest";
import {
  joinScrollback,
  scrollbackFileName,
  scrollbackLines,
  type ScrollbackBuffer,
} from "$lib/scrollback";

/** `term.buffer.active` 흉내 — 줄 배열 하나면 계약을 전부 확인할 수 있다 */
const bufferOf = (lines: readonly string[]): ScrollbackBuffer => ({
  get length() {
    return lines.length;
  },
  getLine: (i) => (i < lines.length ? { translateToString: () => lines[i] } : undefined),
});

describe("scrollbackLines", () => {
  it("버퍼의 줄을 그대로 가져온다", () => {
    expect(scrollbackLines(bufferOf(["a", "b", "c"]))).toEqual(["a", "b", "c"]);
  });

  /**
   * xterm 버퍼는 화면 높이만큼 늘 채워져 있다 — 명령 두 줄을 친 타일도 뒤가 전부 빈 줄이다.
   * 그대로 저장하면 파일 끝에 빈 줄 수십 개가 붙는다.
   */
  it("꼬리의 빈 줄은 뗀다", () => {
    expect(scrollbackLines(bufferOf(["a", "", "b", "", "", ""]))).toEqual(["a", "", "b"]);
  });

  it("**가운데**의 빈 줄은 건드리지 않는다 (그건 실제 출력이다)", () => {
    expect(scrollbackLines(bufferOf(["a", "", "", "b"]))).toEqual(["a", "", "", "b"]);
  });

  it("전부 빈 줄이면 하나도 남지 않는다 (= 저장할 것이 없다)", () => {
    expect(scrollbackLines(bufferOf(["", "", ""]))).toEqual([]);
    expect(scrollbackLines(bufferOf([]))).toEqual([]);
  });

  it("줄을 못 읽으면 빈 줄로 채운다 (버퍼가 그 사이 줄었다)", () => {
    const shrinking: ScrollbackBuffer = { length: 3, getLine: (i) => (i === 0 ? { translateToString: () => "a" } : undefined) };
    expect(scrollbackLines(shrinking)).toEqual(["a"]);
  });
});

describe("joinScrollback", () => {
  it("CRLF 로 잇고 마지막 줄에도 줄바꿈이 붙는다", () => {
    expect(joinScrollback(["a", "b"])).toBe("a\r\nb\r\n");
  });

  it("줄이 없으면 빈 문자열이다 — 호출부가 이것으로 '저장할 것 없음' 을 가른다", () => {
    expect(joinScrollback([])).toBe("");
  });
});

describe("scrollbackFileName", () => {
  const at = new Date(2026, 8, 17, 9, 5); // 2026-09-17 09:05 (로컬)

  it("`<타일 이름>-<YYYYMMDD-HHMM>.txt` 다", () => {
    expect(scrollbackFileName("web-01", at)).toBe("web-01-20260917-0905.txt");
  });

  it("한글 이름은 그대로 둔다 (파일 이름은 사람이 읽는 값이다)", () => {
    expect(scrollbackFileName("내 서버", at)).toBe("내 서버-20260917-0905.txt");
  });

  it("윈도우가 금지하는 글자와 제어 문자는 `_` 로 바꾼다", () => {
    expect(scrollbackFileName('a\\b/c:d*e?f"g<h>i|j', at)).toBe("a_b_c_d_e_f_g_h_i_j-20260917-0905.txt");
    expect(scrollbackFileName("a\nb", at)).toBe("a_b-20260917-0905.txt");
  });

  it("끝의 점·공백은 뗀다 (윈도우가 조용히 잘라 낸다)", () => {
    expect(scrollbackFileName("web. ", at)).toBe("web-20260917-0905.txt");
  });

  it("이름이 통째로 사라지면 고정된 말로 물러선다", () => {
    expect(scrollbackFileName("   ", at)).toBe("terminal-20260917-0905.txt");
  });

  it("아주 긴 이름은 잘린다 (경로 상한)", () => {
    const stem = scrollbackFileName("가".repeat(200), at).split("-")[0];
    expect(Array.from(stem)).toHaveLength(64);
  });
});
