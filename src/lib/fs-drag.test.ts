import { describe, expect, it } from "vitest";
import {
  FS_DRAG_TYPE,
  decodeFsDrag,
  encodeFsDrag,
  fsDragActive,
  fsDragEmpty,
  setFsDragActive,
  shellQuote,
  shellQuoteAll,
  type FsDrag,
} from "$lib/fs-drag";

/**
 * 파일 드래그의 짐과 셸 인용 (docs/log/2026-09-04-fs-multiselect-clipboard.md).
 *
 * 이 파일이 지키는 계약 셋: **깨진 짐은 던지지 않고 빈 짐**(드롭 핸들러 한가운데서 예외가
 * 튀면 드래그가 반쯤 처리된 채 멈춘다) · **인용 방식은 경로의 모양이 정한다**(놓는 터미널의
 * 셸을 물어볼 수 없다) · **창을 넘은 드래그의 `activeDrag` 는 언제나 비어 있다**.
 */

describe("shellQuote — 안전한 글자뿐이면 그대로", () => {
  it("영숫자와 `_@%+=:,./-` 로만 된 POSIX 경로는 감싸지 않는다", () => {
    expect(shellQuote("/usr/bin/ls")).toBe("/usr/bin/ls");
    expect(shellQuote("/home/wl/.bashrc")).toBe("/home/wl/.bashrc");
    expect(shellQuote("a-b_c.d")).toBe("a-b_c.d");
    expect(shellQuote("/var/log/sys.log")).toBe("/var/log/sys.log");
  });

  it("허용 집합의 글자들(`@%+=:,`)도 그대로 통과한다", () => {
    expect(shellQuote("user@host:/tmp/a,b+c=d%e")).toBe("user@host:/tmp/a,b+c=d%e");
  });

  it("빈 경로는 빈 인용부호 — 인자 하나가 사라지지 않게", () => {
    expect(shellQuote("")).toBe("''");
  });
});

describe("shellQuote — POSIX 경로는 홑따옴표", () => {
  it("공백이 든 이름은 `'…'` 로 감싼다", () => {
    expect(shellQuote("/tmp/my file")).toBe("'/tmp/my file'");
  });

  it("한글 이름은 안전한 집합 밖이라 감싼다", () => {
    expect(shellQuote("/home/wl/문서")).toBe("'/home/wl/문서'");
    expect(shellQuote("/home/wl/내 문서/보고서.txt")).toBe("'/home/wl/내 문서/보고서.txt'");
  });

  it("홑따옴표는 셸 관례대로 `'\\''` 로 끊어 이어 붙인다", () => {
    // 결과 글자: ' / t m p / i t ' \ ' ' s '
    expect(shellQuote("/tmp/it's")).toBe("'/tmp/it'\\''s'");
  });

  it("홑따옴표가 여럿이면 전부 끊는다 (첫 번째만이 아니다)", () => {
    expect(shellQuote("a'b'c d")).toBe("'a'\\''b'\\''c d'");
  });

  it("큰따옴표는 홑따옴표 안에서 리터럴이라 손대지 않는다", () => {
    expect(shellQuote('/tmp/a"b')).toBe("'/tmp/a\"b'");
  });

  it("셸 메타문자($ ` ; | & * 등)는 홑따옴표 안에 그대로 남는다", () => {
    expect(shellQuote("/tmp/$HOME;rm -rf *")).toBe("'/tmp/$HOME;rm -rf *'");
    expect(shellQuote("/tmp/a`b`c")).toBe("'/tmp/a`b`c'");
    expect(shellQuote("/tmp/(a)[b]{c}")).toBe("'/tmp/(a)[b]{c}'");
  });
});

describe("shellQuote — 윈도우 경로는 큰따옴표", () => {
  it("백슬래시가 들어 있으면 `\"…\"` 로 감싼다 (cmd·PowerShell·bash 셋 다 리터럴로 읽는다)", () => {
    expect(shellQuote("C:\\Users\\wl")).toBe('"C:\\Users\\wl"');
  });

  it("공백이 든 윈도우 경로도 같은 규칙 — 홑따옴표가 아니다", () => {
    expect(shellQuote("C:\\Program Files\\aynx.exe")).toBe('"C:\\Program Files\\aynx.exe"');
  });

  it("한글이 든 윈도우 경로도 백슬래시 규칙이 이긴다", () => {
    expect(shellQuote("C:\\사용자\\내 문서")).toBe('"C:\\사용자\\내 문서"');
  });

  it("`\\U` 같은 조합을 이스케이프하지 않는다 — 큰따옴표 안에서 그대로 남는다", () => {
    expect(shellQuote("C:\\Users\\Uni")).toBe('"C:\\Users\\Uni"');
    expect(shellQuote("C:\\Users\\wl")).toContain("\\Users\\wl");
  });

  it("UNC 경로도 백슬래시 갈래다", () => {
    expect(shellQuote("\\\\srv\\share\\a b")).toBe('"\\\\srv\\share\\a b"');
  });

  it("백슬래시가 하나라도 있으면 POSIX 갈래로 가지 않는다 (홑따옴표 든 이름이라도)", () => {
    // `"` 는 윈도우 파일명에 못 쓰는 글자라 이스케이프가 없다는 전제 그대로다.
    expect(shellQuote("C:\\it's\\a")).toBe("\"C:\\it's\\a\"");
  });

  it("드라이브 문자만 있고 백슬래시가 없으면 안전한 집합이라 그대로 (`:` 가 허용 글자다)", () => {
    expect(shellQuote("C:")).toBe("C:");
  });
});

describe("shellQuoteAll", () => {
  it("경로들을 공백 하나로 이어 붙인다", () => {
    expect(shellQuoteAll(["/a", "/b c", "C:\\d"])).toBe("/a '/b c' \"C:\\d\"");
  });

  it("빈 목록은 빈 줄", () => {
    expect(shellQuoteAll([])).toBe("");
  });

  it("하나뿐이면 shellQuote 와 같다", () => {
    expect(shellQuoteAll(["/tmp/내 문서"])).toBe(shellQuote("/tmp/내 문서"));
  });

  it("빈 문자열이 섞여도 자리가 사라지지 않는다", () => {
    expect(shellQuoteAll(["/a", "", "/b"])).toBe("/a '' /b");
  });
});

describe("FS_DRAG_TYPE", () => {
  it("앱 안에서만 뜻이 있는 종류 문자열", () => {
    expect(FS_DRAG_TYPE).toBe("application/x-aynx-files");
  });
});

describe("encodeFsDrag / decodeFsDrag — 왕복", () => {
  it("실은 값이 그대로 돌아온다", () => {
    const drag: FsDrag = { backendKey: "ssh:12", paths: ["/a/b", "/a/c"] };
    expect(decodeFsDrag(encodeFsDrag(drag))).toEqual(drag);
  });

  it("공백·한글·백슬래시가 든 경로도 왕복한다", () => {
    const drag: FsDrag = {
      backendKey: "local",
      paths: ["C:\\내 문서\\보고서 (1).txt", "C:\\a\"b", "/tmp/it's"],
    };
    expect(decodeFsDrag(encodeFsDrag(drag))).toEqual(drag);
  });

  it("빈 짐도 왕복한다", () => {
    const drag: FsDrag = { backendKey: "", paths: [] };
    expect(decodeFsDrag(encodeFsDrag(drag))).toEqual(drag);
  });
});

describe("decodeFsDrag — 깨진 입력에서 던지지 않는다", () => {
  const EMPTY: FsDrag = { backendKey: "", paths: [] };

  it("빈 문자열은 빈 짐", () => {
    expect(decodeFsDrag("")).toEqual(EMPTY);
  });

  it("JSON 이 아니면 빈 짐", () => {
    expect(decodeFsDrag("not json")).toEqual(EMPTY);
    expect(decodeFsDrag("{")).toEqual(EMPTY);
    expect(decodeFsDrag("C:\\Users\\wl")).toEqual(EMPTY);
  });

  it("객체가 아닌 JSON(널·수·문자열·불리언)은 빈 짐", () => {
    expect(decodeFsDrag("null")).toEqual(EMPTY);
    expect(decodeFsDrag("42")).toEqual(EMPTY);
    expect(decodeFsDrag('"hello"')).toEqual(EMPTY);
    expect(decodeFsDrag("true")).toEqual(EMPTY);
  });

  it("모양이 어긋난 객체(키 없음·타입 다름)는 빈 짐", () => {
    expect(decodeFsDrag("{}")).toEqual(EMPTY);
    expect(decodeFsDrag('{"backendKey":"local"}')).toEqual(EMPTY);
    expect(decodeFsDrag('{"paths":["/a"]}')).toEqual(EMPTY);
    expect(decodeFsDrag('{"backendKey":12,"paths":["/a"]}')).toEqual(EMPTY);
    expect(decodeFsDrag('{"backendKey":"local","paths":"/a"}')).toEqual(EMPTY);
    expect(decodeFsDrag("[1,2,3]")).toEqual(EMPTY);
  });

  it("paths 안의 문자열 아닌 것은 걸러 내고 나머지는 살린다", () => {
    expect(decodeFsDrag('{"backendKey":"local","paths":["/a",1,null,{"x":1},"/b"]}')).toEqual({
      backendKey: "local",
      paths: ["/a", "/b"],
    });
  });

  it("여분의 필드는 무시한다 (옛 버전이나 남의 창에서 온 짐)", () => {
    expect(decodeFsDrag('{"backendKey":"ssh:3","paths":["/a"],"extra":true}')).toEqual({
      backendKey: "ssh:3",
      paths: ["/a"],
    });
  });

  it("어떤 쓰레기를 넣어도 예외가 나지 않는다", () => {
    const junk = ["", "  ", "undefined", "NaN", "{,}", '{"a":', "\u0000", "[[[[", '{"paths":{}}'];
    for (const raw of junk) {
      expect(() => decodeFsDrag(raw)).not.toThrow();
      expect(fsDragEmpty(decodeFsDrag(raw))).toBe(true);
    }
  });
});

describe("fsDragEmpty", () => {
  it("백엔드 키가 비었으면 빈 짐", () => {
    expect(fsDragEmpty({ backendKey: "", paths: ["/a"] })).toBe(true);
  });

  it("경로가 하나도 없으면 빈 짐", () => {
    expect(fsDragEmpty({ backendKey: "local", paths: [] })).toBe(true);
  });

  it("둘 다 있으면 빈 짐이 아니다", () => {
    expect(fsDragEmpty({ backendKey: "local", paths: ["/a"] })).toBe(false);
  });
});

describe("setFsDragActive / fsDragActive — 이 창에서 시작한 드래그", () => {
  it("처음에는 없다 (남의 창에서 온 드래그와 같은 상태)", () => {
    setFsDragActive(null);
    expect(fsDragActive()).toBeNull();
  });

  it("실어 둔 짐이 그대로 나온다", () => {
    const drag: FsDrag = { backendKey: "ssh:2", paths: ["/srv/a"] };
    setFsDragActive(drag);
    expect(fsDragActive()).toEqual(drag);
    setFsDragActive(null);
    expect(fsDragActive()).toBeNull();
  });

  it("나중에 실은 것이 앞의 것을 대신한다", () => {
    setFsDragActive({ backendKey: "local", paths: ["C:\\a"] });
    setFsDragActive({ backendKey: "ssh:9", paths: ["/b"] });
    expect(fsDragActive()?.backendKey).toBe("ssh:9");
    setFsDragActive(null);
  });
});
