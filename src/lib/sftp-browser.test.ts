import { afterEach, describe, expect, it, vi } from "vitest";
import {
  crumbsOf,
  errorOf,
  formatMode,
  formatMtime,
  formatSize,
  glyphOf,
  isDirLike,
  isHidden,
  isSessionGone,
  joinPath,
  parentOf,
  type SftpEntry,
} from "$lib/sftp-browser";

/**
 * SFTP 브라우저의 **순수 함수들** (docs/log/2026-09-03-sftp-browser-backend.md).
 *
 * 명령 일곱 개는 대상이 아니다 — `invoke` 스텁이 `undefined` 를 돌려주므로 부르면 뜻 없는
 * 실패가 된다. 여기서 도는 것은 경로 계산(POSIX)과 표시 형식, 그리고 오류 정규화뿐이다.
 *
 * 시간에 걸린 것은 둘로 나눠 고정한다: [`formatMtime`] 은 `now` 를 인자로 받으므로 대개
 * 그것으로 충분하고, 기본값(`new Date()`)이 도는 갈래만 `vi.setSystemTime` 으로 못박는다.
 * 만드는 시각은 **지역 시간 성분으로** 짓는다 (`new Date(2025, 8, 3, 14, 22)`) — 그래야
 * 어느 시간대에서 돌려도 기대값이 같다.
 */

/** 목록 한 줄 — 보는 필드만 덮어쓴다 */
function entry(patch: Partial<SftpEntry> = {}): SftpEntry {
  return {
    name: "a.txt",
    path: "/srv/a.txt",
    kind: "file",
    size: 0,
    mtime: null,
    mode: null,
    symlinkTarget: null,
    linkIsDir: false,
    hidden: null,
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// 경로 (POSIX)
// ---------------------------------------------------------------------------

describe("parentOf", () => {
  it("마지막 조각을 뗀다", () => {
    expect(parentOf("/a/b/c")).toBe("/a/b");
    expect(parentOf("/home/wl/문서")).toBe("/home/wl");
  });

  it("한 칸 아래의 부모는 루트다", () => {
    expect(parentOf("/a")).toBe("/");
  });

  it("루트의 부모는 **루트 자신**이다 — 더 갈 곳이 없다 (화면의 ↑ 비활성 판정)", () => {
    expect(parentOf("/")).toBe("/");
    expect(parentOf("//")).toBe("/");
    expect(parentOf("")).toBe("/");
  });

  it("꼬리 슬래시는 먼저 떨군다", () => {
    expect(parentOf("/a/b/")).toBe("/a");
    expect(parentOf("/a/b///")).toBe("/a");
    expect(parentOf("/a/")).toBe("/");
  });

  it("절대 경로가 아니면 루트로 물러난다 (백엔드가 상대 경로를 거절한다)", () => {
    expect(parentOf("relative")).toBe("/");
  });

  it("계속 올라가면 반드시 루트에서 멈춘다", () => {
    let at = "/a/b/c/d/e";
    for (let i = 0; i < 10; i += 1) at = parentOf(at);
    expect(at).toBe("/");
  });
});

describe("joinPath", () => {
  it("구분자 하나로 잇는다", () => {
    expect(joinPath("/a", "b")).toBe("/a/b");
  });

  it("루트에서도 `//` 가 생기지 않는다", () => {
    expect(joinPath("/", "b")).toBe("/b");
    expect(joinPath("", "b")).toBe("/b");
  });

  it("꼬리 슬래시가 있든 없든 결과가 같다", () => {
    expect(joinPath("/a/", "b")).toBe("/a/b");
    expect(joinPath("/a///", "b")).toBe("/a/b");
  });

  it("이름의 공백·한글은 손대지 않는다", () => {
    expect(joinPath("/srv", "내 문서")).toBe("/srv/내 문서");
  });

  it("이어 붙인 뒤 부모를 물으면 원래 폴더로 돌아온다", () => {
    expect(parentOf(joinPath("/a/b", "c"))).toBe("/a/b");
    expect(parentOf(joinPath("/", "c"))).toBe("/");
  });
});

describe("crumbsOf", () => {
  it("루트는 언제나 첫 조각이다", () => {
    expect(crumbsOf("/")).toEqual([{ label: "/", path: "/" }]);
    expect(crumbsOf("")).toEqual([{ label: "/", path: "/" }]);
  });

  it("조각마다 절대 경로를 함께 싣는다", () => {
    expect(crumbsOf("/a/b/c")).toEqual([
      { label: "/", path: "/" },
      { label: "a", path: "/a" },
      { label: "b", path: "/a/b" },
      { label: "c", path: "/a/b/c" },
    ]);
  });

  it("겹친 슬래시와 꼬리 슬래시는 조각을 만들지 않는다", () => {
    expect(crumbsOf("/a//b/")).toEqual(crumbsOf("/a/b"));
  });

  it("한글 조각도 그대로 선다", () => {
    expect(crumbsOf("/srv/내 문서").map((c) => c.label)).toEqual(["/", "srv", "내 문서"]);
  });

  it("마지막 조각의 경로는 그 경로 자신이다", () => {
    const crumbs = crumbsOf("/a/b/c");
    expect(crumbs[crumbs.length - 1].path).toBe("/a/b/c");
  });
});

// ---------------------------------------------------------------------------
// formatSize
// ---------------------------------------------------------------------------

describe("formatSize", () => {
  it("1024 미만은 바이트 그대로", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1)).toBe("1 B");
    expect(formatSize(999)).toBe("999 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("1024 부터 KB — 10 미만은 소수 한 자리", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1024 * 9)).toBe("9.0 KB");
  });

  it("10 이상은 반올림한 정수 — 자릿수를 맞춰 접는다", () => {
    expect(formatSize(1024 * 10)).toBe("10 KB");
    expect(formatSize(1024 * 15)).toBe("15 KB");
    expect(formatSize(1024 * 15.5)).toBe("16 KB");
    expect(formatSize(1024 * 1024 - 1)).toBe("1024 KB");
  });

  it("MB·GB·TB 로 올라간다", () => {
    expect(formatSize(1024 ** 2)).toBe("1.0 MB");
    expect(formatSize(1024 ** 2 * 2.5)).toBe("2.5 MB");
    expect(formatSize(1024 ** 3)).toBe("1.0 GB");
    expect(formatSize(1024 ** 3 * 42)).toBe("42 GB");
    expect(formatSize(1024 ** 4)).toBe("1.0 TB");
  });

  it("TB 가 마지막 단위라 그 위는 TB 로 쌓인다", () => {
    expect(formatSize(1024 ** 5)).toBe("1024 TB");
  });

  it("모르는 값(음수·NaN·무한)은 `—` — 지어내지 않는다", () => {
    expect(formatSize(-1)).toBe("—");
    expect(formatSize(Number.NaN)).toBe("—");
    expect(formatSize(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// formatMtime
// ---------------------------------------------------------------------------

/** 지역 시간 성분으로 지은 시각 → 백엔드가 주는 **초** */
function secondsOf(...args: [number, number, number, number?, number?]): number {
  const [y, m, d, h = 0, min = 0] = args;
  return new Date(y, m, d, h, min, 0, 0).getTime() / 1000;
}

describe("formatMtime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("올해 안이면 연도를 생략하고 분까지 (`09-03 14:22`)", () => {
    const now = new Date(2025, 11, 1, 0, 0);
    expect(formatMtime(secondsOf(2025, 8, 3, 14, 22), now)).toBe("09-03 14:22");
  });

  it("월·일·시·분을 두 자리로 채운다", () => {
    const now = new Date(2025, 11, 1, 0, 0);
    expect(formatMtime(secondsOf(2025, 0, 5, 4, 7), now)).toBe("01-05 04:07");
    expect(formatMtime(secondsOf(2025, 0, 1, 0, 0), now)).toBe("01-01 00:00");
  });

  it("해를 넘겼으면 날짜만 (`2024-11-02`)", () => {
    const now = new Date(2025, 5, 1, 12, 0);
    expect(formatMtime(secondsOf(2024, 10, 2, 5, 6), now)).toBe("2024-11-02");
    expect(formatMtime(secondsOf(2019, 11, 31, 23, 59), now)).toBe("2019-12-31");
  });

  it("같은 해의 12월 31일은 아직 올해 갈래다 (경계는 연도 하나뿐)", () => {
    const now = new Date(2025, 0, 1, 0, 0);
    expect(formatMtime(secondsOf(2025, 11, 31, 23, 59), now)).toBe("12-31 23:59");
  });

  it("미래(다음 해)도 연도 갈래로 간다", () => {
    const now = new Date(2025, 5, 1, 12, 0);
    expect(formatMtime(secondsOf(2026, 2, 4, 1, 2), now)).toBe("2026-03-04");
  });

  it("초 → 밀리초 곱을 빠뜨리지 않는다 — 1970 으로 무너지지 않는다", () => {
    const now = new Date(2025, 5, 1, 12, 0);
    expect(formatMtime(secondsOf(2025, 5, 1, 9, 30), now)).toBe("06-01 09:30");
  });

  it("에폭 0 은 1970 언저리의 날짜 한 줄이다 (시간대에 따라 하루가 갈리므로 모양만 본다)", () => {
    const now = new Date(2025, 5, 1, 12, 0);
    expect(formatMtime(0, now)).toMatch(/^19(69|70)-\d{2}-\d{2}$/);
  });

  it("모르는 값(널·NaN·무한·표현 못 하는 수)은 `—`", () => {
    const now = new Date(2025, 5, 1, 12, 0);
    expect(formatMtime(null, now)).toBe("—");
    expect(formatMtime(Number.NaN, now)).toBe("—");
    expect(formatMtime(Number.POSITIVE_INFINITY, now)).toBe("—");
    expect(formatMtime(1e15, now)).toBe("—");
  });

  it("`now` 를 안 주면 지금 시각을 쓴다 — 시스템 시각을 고정해 확인한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 1, 12, 0));
    expect(formatMtime(secondsOf(2025, 8, 3, 14, 22))).toBe("09-03 14:22");
    expect(formatMtime(secondsOf(2024, 8, 3, 14, 22))).toBe("2024-09-03");
  });

  it("시스템 시각이 다른 해로 넘어가면 같은 값이 다른 갈래로 읽힌다", () => {
    const mtime = secondsOf(2025, 8, 3, 14, 22);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 11, 31, 23, 59));
    expect(formatMtime(mtime)).toBe("09-03 14:22");
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0));
    expect(formatMtime(mtime)).toBe("2025-09-03");
  });
});

// ---------------------------------------------------------------------------
// formatMode
// ---------------------------------------------------------------------------

describe("formatMode", () => {
  it("권한 아홉 글자만 돌려준다 — 앞의 종류 글자(`d`·`l`)는 목록의 글리프가 말한다", () => {
    expect(formatMode(0o755)).toBe("rwxr-xr-x");
    expect(formatMode(0o755)).toHaveLength(9);
  });

  it("흔한 값들", () => {
    expect(formatMode(0o644)).toBe("rw-r--r--");
    expect(formatMode(0o600)).toBe("rw-------");
    expect(formatMode(0o777)).toBe("rwxrwxrwx");
    expect(formatMode(0o000)).toBe("---------");
    expect(formatMode(0o751)).toBe("rwxr-x--x");
  });

  it("setuid 는 소유자의 x 자리에 겹쳐 적는다 (`s` / 실행 없으면 `S`)", () => {
    expect(formatMode(0o4755)).toBe("rwsr-xr-x");
    expect(formatMode(0o4644)).toBe("rwSr--r--");
  });

  it("setgid 는 그룹의 x 자리에", () => {
    expect(formatMode(0o2755)).toBe("rwxr-sr-x");
    expect(formatMode(0o2644)).toBe("rw-r-Sr--");
  });

  it("sticky 는 기타의 x 자리에 (`t` / `T`) — `/tmp` 가 `rwxrwxrwt`", () => {
    expect(formatMode(0o1777)).toBe("rwxrwxrwt");
    expect(formatMode(0o1666)).toBe("rw-rw-rwT");
  });

  it("특수 비트 셋이 한꺼번에 서기도 한다", () => {
    expect(formatMode(0o7777)).toBe("rwsrwsrwt");
    expect(formatMode(0o7000)).toBe("--S--S--T");
  });

  it("파일 종류 비트가 섞여 와도 `& 0o7777` 로 떼어 낸다", () => {
    expect(formatMode(0o100644)).toBe("rw-r--r--"); // 일반 파일
    expect(formatMode(0o40755)).toBe("rwxr-xr-x"); // 디렉터리
    expect(formatMode(0o120777)).toBe("rwxrwxrwx"); // 심링크
  });

  it("모르는 값(널·NaN)은 `—`", () => {
    expect(formatMode(null)).toBe("—");
    expect(formatMode(Number.NaN)).toBe("—");
    expect(formatMode(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// 항목 판정
// ---------------------------------------------------------------------------

describe("isDirLike — 들어갈 수 있는가", () => {
  it("디렉터리는 들어간다", () => {
    expect(isDirLike(entry({ kind: "dir" }))).toBe(true);
  });

  it("디렉터리를 가리키는 심링크도 들어간다", () => {
    expect(isDirLike(entry({ kind: "symlink", linkIsDir: true }))).toBe(true);
  });

  it("파일을 가리키는 심링크는 파일처럼 다룬다 (`linkIsDir` 를 못 채운 자리 포함)", () => {
    expect(isDirLike(entry({ kind: "symlink", linkIsDir: false }))).toBe(false);
  });

  it("파일과 그 밖은 들어가지 않는다", () => {
    expect(isDirLike(entry({ kind: "file" }))).toBe(false);
    expect(isDirLike(entry({ kind: "other" }))).toBe(false);
  });

  it("`linkIsDir` 는 심링크에서만 뜻이 있다", () => {
    expect(isDirLike(entry({ kind: "file", linkIsDir: true }))).toBe(false);
  });
});

describe("glyphOf — 줄 앞에 그릴 글리프의 종류", () => {
  it("심링크는 링크 — 디렉터리를 가리키면 `dirlink` (들어가기와 같은 `linkIsDir` 근거)", () => {
    expect(glyphOf(entry({ kind: "symlink", linkIsDir: true }))).toBe("dirlink");
    expect(glyphOf(entry({ kind: "symlink", linkIsDir: false }))).toBe("link");
  });

  it("디렉터리는 폴더", () => {
    expect(glyphOf(entry({ kind: "dir" }))).toBe("dir");
  });

  it("나머지는 파일", () => {
    expect(glyphOf(entry({ kind: "file" }))).toBe("file");
    expect(glyphOf(entry({ kind: "other" }))).toBe("file");
  });
});

describe("isHidden — 닷파일 OR 윈도우 숨김 속성", () => {
  it("점으로 시작하면 숨김", () => {
    expect(isHidden(entry({ name: ".bashrc" }))).toBe(true);
    expect(isHidden(entry({ name: "." }))).toBe(true);
    expect(isHidden(entry({ name: ".." }))).toBe(true);
  });

  it("점이 가운데나 끝에 있는 것은 숨김이 아니다", () => {
    expect(isHidden(entry({ name: "a.txt" }))).toBe(false);
    expect(isHidden(entry({ name: "보고서.txt" }))).toBe(false);
  });

  it("윈도우 숨김 속성만으로도 숨김이다 — `NTUSER.DAT` 에는 점이 없다", () => {
    expect(isHidden(entry({ name: "NTUSER.DAT", hidden: true }))).toBe(true);
  });

  it("속성이 거짓이어도 닷파일이면 숨김이다 (OR 이다)", () => {
    expect(isHidden(entry({ name: ".bashrc", hidden: false }))).toBe(true);
  });

  it("원격(SFTP)은 속성이 언제나 `null` 이라 닷파일 규칙만 남는다", () => {
    expect(isHidden(entry({ name: "a.txt", hidden: null }))).toBe(false);
    expect(isHidden(entry({ name: ".ssh", hidden: null, kind: "dir" }))).toBe(true);
  });

  it("빈 이름은 숨김이 아니다", () => {
    expect(isHidden(entry({ name: "" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 오류 정규화
// ---------------------------------------------------------------------------

describe("errorOf", () => {
  // 폴백은 **문구 키**다 (2026-09-17). 기준 언어가 한국어이므로 테스트는 한국어 사전의
  // 값과 맞춰 본다 — 값이 바뀌면 여기서 걸린다.
  const KEY = "files.ops.fail.cancel";
  const FALLBACK = "취소하지 못했습니다";

  it("문자열 오류(백엔드가 준 문구)를 그대로 싣는다", () => {
    const e = errorOf("권한이 없습니다", KEY);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("권한이 없습니다");
  });

  it("이미 Error 면 그 문구를 쓴다", () => {
    expect(errorOf(new Error("이미 있습니다"), KEY).message).toBe("이미 있습니다");
  });

  it("정체를 모르면 폴백 키를 지금 언어로 푼다", () => {
    expect(errorOf(null, KEY).message).toBe(FALLBACK);
    expect(errorOf(undefined, KEY).message).toBe(FALLBACK);
    expect(errorOf({ code: 3 }, KEY).message).toBe(FALLBACK);
    expect(errorOf(42, KEY).message).toBe(FALLBACK);
  });

  it("폴백의 자리표시자는 인자로 채운다", () => {
    expect(errorOf(null, "files.ops.fail.list", { path: "/var/log" }).message).toBe(
      "/var/log 목록을 읽지 못했습니다",
    );
  });
});

describe("isSessionGone — 오류가 아니라 '연결 대기' 배너로 접는 갈래", () => {
  // 세 갈래가 **같은 이유 코드**를 단다: 세션 표에 없다 · 서버가 연결을 잃었다 ·
  // 프런트가 세션 없이 원격을 불렀다 (`$lib/error-reason`).
  it("세션 표에 없을 때 (한국어 본문)", () => {
    expect(
      isSessionGone("[session-gone] 세션을 찾을 수 없습니다 — 연결이 끊겼거나 이미 닫힌 세션입니다"),
    ).toBe(true);
  });

  it("세션 표에 없을 때 (영어 본문) — 같은 갈래다", () => {
    expect(
      isSessionGone(
        "[session-gone] Could not find the session — it was disconnected or already closed",
      ),
    ).toBe(true);
  });

  it("서버가 연결을 잃었을 때 — 문구가 감싸여 와도 알아본다", () => {
    expect(isSessionGone("[session-gone] /srv 목록을 읽지 못했습니다: 세션이 끊겼습니다")).toBe(true);
    expect(isSessionGone("[session-gone] Could not list /srv: The session was lost")).toBe(true);
  });

  it("그 밖의 실패는 그대로 오류다 — 권한 없음과 빈 폴더는 화면에서 달라야 한다", () => {
    expect(isSessionGone("권한이 거부되었습니다")).toBe(false);
    expect(isSessionGone("Permission denied")).toBe(false);
    expect(isSessionGone("")).toBe(false);
    // 옛 한국어 조각만으로는 걸리지 않는다 — 계약은 이제 코드다.
    expect(isSessionGone("세션을 찾을 수 없습니다")).toBe(false);
  });
});
