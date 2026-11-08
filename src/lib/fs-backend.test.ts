import { describe, expect, it } from "vitest";
import {
  LOCAL_KEY,
  backendFromKey,
  baseNameOf,
  localBackend,
  nameError,
  remoteBackend,
  winCrumbsOf,
  winJoinPath,
  winNormalize,
  winParentOf,
  type Crumb,
  type FsBackend,
} from "$lib/fs-backend";

/**
 * 윈도우 경로 문법과 백엔드 어댑터 (docs/log/2026-09-03-local-fs-tile.md).
 *
 * 여기서 도는 것은 **네트워크를 타지 않는 것들뿐**이다: 경로 계산 넷(`winNormalize` ·
 * `winParentOf` · `winJoinPath` · `winCrumbsOf`)과 `baseNameOf`, 그리고 `invoke` 를 부르지
 * 않는 팩토리·키 파싱. 명령 래퍼(`list`·`stat`…)는 대상이 아니다 — 스텁이 `undefined` 를
 * 돌려주므로 부르면 뜻 없는 실패가 된다.
 *
 * 이 파일이 지키는 계약 셋: **드라이브 뿌리와 UNC 공유 뿌리의 위는 `""`(내 PC)** ·
 * **`""` 는 더 갈 곳 없는 꼭대기** · **빵부스러기는 언제나 내 PC 부터**.
 */

// ---------------------------------------------------------------------------
// winNormalize
// ---------------------------------------------------------------------------

describe("winNormalize", () => {
  it("슬래시를 백슬래시로 접고 꼬리 구분자를 떤다", () => {
    expect(winNormalize("C:/Users/wl/")).toBe("C:\\Users\\wl");
    expect(winNormalize("C:\\Users\\wl\\")).toBe("C:\\Users\\wl");
  });

  it("겹친 구분자는 하나로 접는다", () => {
    expect(winNormalize("C:\\a\\\\b")).toBe("C:\\a\\b");
    expect(winNormalize("C://a///b")).toBe("C:\\a\\b");
  });

  it("드라이브 문자만 오면 그 뿌리다", () => {
    expect(winNormalize("C:")).toBe("C:\\");
    expect(winNormalize("d:")).toBe("d:\\");
  });

  it("뿌리의 꼬리 구분자는 남긴다", () => {
    expect(winNormalize("C:\\")).toBe("C:\\");
    expect(winNormalize("C:/")).toBe("C:\\");
  });

  it("UNC 의 앞 두 구분자는 되살린다", () => {
    expect(winNormalize("//srv/share/x")).toBe("\\\\srv\\share\\x");
    expect(winNormalize("\\\\srv\\share\\x")).toBe("\\\\srv\\share\\x");
  });

  it("UNC 공유 뿌리의 꼬리 구분자는 떤다 (드라이브 뿌리와 다른 자리다)", () => {
    expect(winNormalize("\\\\srv\\share\\")).toBe("\\\\srv\\share");
  });

  it("빈 경로는 그대로 — 합성 루트(내 PC)다", () => {
    expect(winNormalize("")).toBe("");
    expect(winNormalize("   ")).toBe("");
  });

  it("앞뒤 공백을 떤다", () => {
    expect(winNormalize("  C:\\a  ")).toBe("C:\\a");
  });

  it("한글·공백이 든 이름은 손대지 않는다", () => {
    expect(winNormalize("C:/사용자/내 문서/")).toBe("C:\\사용자\\내 문서");
  });

  it("이미 정규화된 값을 다시 넣어도 같다 (멱등)", () => {
    for (const p of ["", "C:\\", "C:\\a\\b", "\\\\srv\\share", "\\\\srv\\share\\x"]) {
      expect(winNormalize(winNormalize(p))).toBe(winNormalize(p));
    }
  });
});

// ---------------------------------------------------------------------------
// winParentOf
// ---------------------------------------------------------------------------

describe("winParentOf", () => {
  it("보통 경로는 마지막 조각을 뗀다", () => {
    expect(winParentOf("C:\\Users\\wl\\Documents")).toBe("C:\\Users\\wl");
    expect(winParentOf("C:\\Users\\wl")).toBe("C:\\Users");
  });

  it("드라이브 바로 아래의 부모는 드라이브 뿌리다 (`C:` 가 아니라 `C:\\`)", () => {
    expect(winParentOf("C:\\Users")).toBe("C:\\");
  });

  it("드라이브 뿌리의 위는 내 PC(`\"\"`) — 거기가 꼭대기다", () => {
    expect(winParentOf("C:\\")).toBe("");
    expect(winParentOf("C:")).toBe("");
    expect(winParentOf("D:/")).toBe("");
  });

  it("내 PC 의 부모는 자기 자신이다 (더 갈 곳이 없다)", () => {
    expect(winParentOf("")).toBe("");
  });

  it("꼬리 구분자는 먼저 떨군다 — `C:\\a\\b\\` 의 부모는 `C:\\a`", () => {
    expect(winParentOf("C:\\a\\b\\")).toBe("C:\\a");
    expect(winParentOf("C:/a/b/")).toBe("C:\\a");
  });

  it("UNC 공유 뿌리의 위도 내 PC 다 (공유 목록을 읽을 명령이 없다)", () => {
    expect(winParentOf("\\\\srv\\share")).toBe("");
    expect(winParentOf("\\\\srv\\share\\")).toBe("");
  });

  it("UNC 안쪽은 평소대로 한 조각씩 오른다", () => {
    expect(winParentOf("\\\\srv\\share\\a\\b")).toBe("\\\\srv\\share\\a");
    expect(winParentOf("\\\\srv\\share\\a")).toBe("\\\\srv\\share");
  });

  it("한글 이름도 그대로 오른다", () => {
    expect(winParentOf("C:\\사용자\\내 문서")).toBe("C:\\사용자");
  });

  it("계속 올라가면 반드시 내 PC 에서 멈춘다 (↑ 가 무한히 도는 자리가 없다)", () => {
    const samples = [
      "C:\\Users\\wl\\Documents\\a.txt",
      "C:\\",
      "\\\\srv\\share\\a\\b",
      "\\\\srv\\share",
      "\\\\srv",
      "C:/사용자/내 문서/",
      "",
    ];
    for (const start of samples) {
      let at = winParentOf(start);
      let steps = 0;
      while (at !== "" && steps < 20) {
        at = winParentOf(at);
        steps += 1;
      }
      expect(at).toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// winJoinPath
// ---------------------------------------------------------------------------

describe("winJoinPath", () => {
  it("구분자 하나로 잇는다", () => {
    expect(winJoinPath("C:\\Users", "wl")).toBe("C:\\Users\\wl");
  });

  it("드라이브 뿌리에서는 `\\\\` 가 겹치지 않는다", () => {
    expect(winJoinPath("C:\\", "Users")).toBe("C:\\Users");
    expect(winJoinPath("C:", "Users")).toBe("C:\\Users");
  });

  it("꼬리 구분자가 있든 없든 결과가 같다", () => {
    expect(winJoinPath("C:\\Users\\", "wl")).toBe("C:\\Users\\wl");
    expect(winJoinPath("C:/Users/", "wl")).toBe("C:\\Users\\wl");
  });

  it("UNC 공유 뿌리에 붙인다", () => {
    expect(winJoinPath("\\\\srv\\share", "x")).toBe("\\\\srv\\share\\x");
    expect(winJoinPath("\\\\srv\\share\\", "x")).toBe("\\\\srv\\share\\x");
  });

  it("내 PC(`\"\"`)에 붙이면 그 이름이 곧 경로다 — 드라이브를 골라 들어가는 자리", () => {
    expect(winJoinPath("", "C:\\")).toBe("C:\\");
    expect(winJoinPath("", "C:")).toBe("C:\\");
  });

  it("이름의 공백·한글은 손대지 않는다", () => {
    expect(winJoinPath("C:\\a", "내 문서")).toBe("C:\\a\\내 문서");
  });

  it("이어 붙인 뒤 부모를 물으면 원래 폴더로 돌아온다", () => {
    for (const dir of ["C:\\", "C:\\Users", "\\\\srv\\share"]) {
      expect(winParentOf(winJoinPath(dir, "x"))).toBe(winNormalize(dir));
    }
  });
});

// ---------------------------------------------------------------------------
// winCrumbsOf
// ---------------------------------------------------------------------------

/** 라벨만 펴서 비교한다 — 경로는 따로 본다 */
function labels(crumbs: readonly Crumb[]): string[] {
  return crumbs.map((c) => c.label);
}

/**
 * 뿌리 조각 — 말이 아니라 **문구 키**를 든다 (`label` 은 비어 있다).
 *
 * `fs-backend` 는 룬을 들일 수 없는 순수 모듈이라 "내 PC" 를 지어낼 수 없고, 그 말을
 * 그리는 것은 `LocationBar.svelte` 의 몫이다.
 */
const ROOT: Crumb = { label: "", path: "", labelKey: "files.browser.mypc" };

describe("winCrumbsOf", () => {
  it("내 PC 는 언제나 첫 조각이고 경로는 빈 문자열이다", () => {
    expect(winCrumbsOf("")).toEqual([ROOT]);
  });

  it("드라이브 뿌리는 두 조각 — 내 PC › C:", () => {
    expect(winCrumbsOf("C:\\")).toEqual([
      ROOT,
      { label: "C:", path: "C:\\" },
    ]);
  });

  it("보통 경로는 조각마다 절대 경로를 함께 싣는다", () => {
    expect(winCrumbsOf("C:\\Users\\you")).toEqual([
      ROOT,
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "you", path: "C:\\Users\\you" },
    ]);
  });

  it("드라이브 라벨에는 꼬리 구분자가 없지만 그 경로에는 있다", () => {
    const [, drive] = winCrumbsOf("C:\\Users");
    expect(drive.label).toBe("C:");
    expect(drive.path).toBe("C:\\");
  });

  it("UNC 는 공유 전체가 한 조각이다", () => {
    expect(winCrumbsOf("\\\\srv\\share\\x\\y")).toEqual([
      ROOT,
      { label: "\\\\srv\\share", path: "\\\\srv\\share" },
      { label: "x", path: "\\\\srv\\share\\x" },
      { label: "y", path: "\\\\srv\\share\\x\\y" },
    ]);
  });

  it("UNC 공유 뿌리 자체는 두 조각", () => {
    expect(labels(winCrumbsOf("\\\\srv\\share"))).toEqual(["", "\\\\srv\\share"]);
  });

  it("꼬리 구분자와 슬래시 표기가 결과를 바꾸지 않는다", () => {
    expect(winCrumbsOf("C:/Users/wl/")).toEqual(winCrumbsOf("C:\\Users\\wl"));
  });

  it("모양을 못 알아보는 상대 경로는 뿌리만 (백엔드가 이미 거절한다)", () => {
    expect(winCrumbsOf("Users\\wl")).toEqual([ROOT]);
    expect(winCrumbsOf("..\\a")).toEqual([ROOT]);
  });

  it("마지막 조각의 경로는 정규화된 그 경로 자신이다", () => {
    for (const p of ["C:\\Users\\wl", "C:/Users/wl/", "\\\\srv\\share\\x", "C:\\"]) {
      const crumbs = winCrumbsOf(p);
      expect(crumbs[crumbs.length - 1].path).toBe(winNormalize(p));
    }
  });

  it("한글 조각도 그대로 선다", () => {
    expect(labels(winCrumbsOf("C:\\사용자\\내 문서"))).toEqual([
      "",
      "C:",
      "사용자",
      "내 문서",
    ]);
  });
});

// ---------------------------------------------------------------------------
// baseNameOf
// ---------------------------------------------------------------------------

describe("baseNameOf", () => {
  it("구분자 둘(`/` · `\\`)을 함께 본다 — 어느 백엔드의 경로든 통한다", () => {
    expect(baseNameOf("C:\\a\\b.txt")).toBe("b.txt");
    expect(baseNameOf("/home/wl/b.txt")).toBe("b.txt");
    expect(baseNameOf("C:/a/b.txt")).toBe("b.txt");
  });

  it("꼬리 구분자는 먼저 떼어 낸다", () => {
    expect(baseNameOf("C:\\a\\")).toBe("a");
    expect(baseNameOf("/home/wl/")).toBe("wl");
    expect(baseNameOf("/home/wl///")).toBe("wl");
  });

  it("드라이브 뿌리는 드라이브 문자만 남는다", () => {
    expect(baseNameOf("C:\\")).toBe("C:");
  });

  it("POSIX 루트에는 이름이 없다", () => {
    expect(baseNameOf("/")).toBe("");
    expect(baseNameOf("")).toBe("");
  });

  it("구분자가 없으면 통째로 이름이다", () => {
    expect(baseNameOf("보고서.txt")).toBe("보고서.txt");
  });

  it("공백·한글 이름을 그대로 돌려준다", () => {
    expect(baseNameOf("C:\\사용자\\내 문서")).toBe("내 문서");
    expect(baseNameOf("/srv/내 문서/보고서 (1).txt")).toBe("보고서 (1).txt");
  });
});

// ---------------------------------------------------------------------------
// 팩토리와 키 — `invoke` 를 부르지 않는 부분만
// ---------------------------------------------------------------------------

describe("localBackend", () => {
  it("언제나 같은 객체다 — 상태가 없으므로 새로 만들 이유가 없다", () => {
    expect(localBackend()).toBe(localBackend());
  });

  it("키는 `LOCAL_KEY` 이고 창을 넘어도 같은 뜻이다", () => {
    expect(localBackend().key).toBe(LOCAL_KEY);
    expect(LOCAL_KEY).toBe("local");
  });

  it("윈도우 문법과 로컬 능력 플래그를 단다", () => {
    const local = localBackend();
    expect(local.sep).toBe("\\");
    expect(local.online).toBe(true);
    expect(local.canUpload).toBe(true);
    expect(local.canDownload).toBe(false);
    expect(local.canEdit).toBe(false);
    expect(local.canOpenExternal).toBe(true);
    expect(local.canReveal).toBe(true);
    expect(local.canView).toBe(true);
    expect(local.canWrite).toBe(true);
  });

  it("경로 함수 셋이 윈도우 판이다", () => {
    const local = localBackend();
    expect(local.parentOf("C:\\a\\b")).toBe("C:\\a");
    expect(local.joinPath("C:\\", "a")).toBe("C:\\a");
    expect(local.crumbsOf("")[0].labelKey).toBe("files.browser.mypc");
  });

  it("합성 루트는 빈 경로 하나뿐이다", () => {
    const local = localBackend();
    expect(local.isSyntheticRoot("")).toBe(true);
    expect(local.isSyntheticRoot("   ")).toBe(true);
    expect(local.isSyntheticRoot("C:\\")).toBe(false);
  });

  it("플래그가 참인 메서드는 실제로 있다 (짝이 맞아야 한다)", () => {
    const local = localBackend();
    expect(typeof local.openExternal).toBe("function");
    expect(typeof local.reveal).toBe("function");
    expect(typeof local.uploadBytes).toBe("function");
    expect(typeof local.readText).toBe("function");
    expect(typeof local.writeText).toBe("function");
    expect(local.download).toBeUndefined();
    expect(local.edit).toBeUndefined();
  });
});

describe("remoteBackend", () => {
  it("세션 id 하나당 객체 하나 — 캐시가 신원을 고정한다", () => {
    expect(remoteBackend(12)).toBe(remoteBackend(12));
    expect(remoteBackend(12)).not.toBe(remoteBackend(13));
  });

  it("키에 세션 번호가 실린다 — 재연결하면 이 값이 바뀐다", () => {
    expect(remoteBackend(12).key).toBe("ssh:12");
    expect(remoteBackend(0).key).toBe("ssh:0");
  });

  it("세션이 없으면 오프라인 싱글턴이다", () => {
    const offline = remoteBackend(null);
    expect(offline).toBe(remoteBackend(null));
    expect(offline.key).toBe("ssh:none");
    expect(offline.online).toBe(false);
  });

  it("세션 없는 원격의 저장은 `[session-gone]` 으로 **거절된 약속**이다 (동기로 던지지 않는다)", async () => {
    const offline = remoteBackend(null);
    expect(offline.canWrite).toBe(true); // 능력은 그대로 — 지금 부를 수 있는지는 online 이 말한다
    let pending: Promise<unknown> | undefined;
    expect(() => {
      pending = offline.writeText?.("/srv/a.conf", "x", null);
    }).not.toThrow();
    await expect(pending).rejects.toThrow("[session-gone]");
  });

  it("POSIX 문법과 원격 능력 플래그를 단다", () => {
    const remote = remoteBackend(7);
    expect(remote.sep).toBe("/");
    expect(remote.online).toBe(true);
    expect(remote.canUpload).toBe(true);
    expect(remote.canDownload).toBe(true);
    expect(remote.canEdit).toBe(true);
    expect(remote.canOpenExternal).toBe(false);
    expect(remote.canReveal).toBe(false);
    expect(remote.canView).toBe(true);
    expect(remote.canWrite).toBe(true);
  });

  it("경로 함수 셋이 POSIX 판이다", () => {
    const remote = remoteBackend(7);
    expect(remote.parentOf("/a/b")).toBe("/a");
    expect(remote.joinPath("/a", "b")).toBe("/a/b");
    expect(remote.crumbsOf("/a")).toEqual([
      { label: "/", path: "/" },
      { label: "a", path: "/a" },
    ]);
  });

  it("합성 루트가 없고 뿌리 목록도 없다 — 원격의 꼭대기는 `/` 다", () => {
    const remote = remoteBackend(7);
    expect(remote.isSyntheticRoot("")).toBe(false);
    expect(remote.isSyntheticRoot("/")).toBe(false);
    expect(remote.roots()).toBeNull();
  });

  it("플래그가 참인 메서드는 실제로 있다 (짝이 맞아야 한다)", () => {
    const remote: FsBackend = remoteBackend(7);
    expect(typeof remote.download).toBe("function");
    expect(typeof remote.edit).toBe("function");
    expect(typeof remote.uploadPaths).toBe("function");
    expect(typeof remote.downloadPaths).toBe("function");
    expect(typeof remote.copyFromRemote).toBe("function");
    expect(typeof remote.moveFromRemote).toBe("function");
    expect(typeof remote.readText).toBe("function");
    expect(typeof remote.writeText).toBe("function");
    expect(remote.openExternal).toBeUndefined();
    expect(remote.reveal).toBeUndefined();
    expect(remote.uploadBytes).toBeUndefined();
  });
});

describe("backendFromKey — 드래그·클립보드가 짐의 키로 원본을 되찾는다", () => {
  it("로컬 키는 로컬 백엔드 그 객체다", () => {
    expect(backendFromKey(LOCAL_KEY)).toBe(localBackend());
  });

  it("`ssh:N` 은 그 세션의 백엔드다 — 캐시된 같은 객체", () => {
    expect(backendFromKey("ssh:12")).toBe(remoteBackend(12));
  });

  it("모르는 모양이면 `null` — 받는 쪽은 안내 한 줄로 물러난다", () => {
    expect(backendFromKey("")).toBeNull();
    expect(backendFromKey("ssh:")).toBeNull();
    expect(backendFromKey("ssh:none")).toBeNull();
    expect(backendFromKey("ssh:12x")).toBeNull();
    expect(backendFromKey("ssh:-1")).toBeNull();
    expect(backendFromKey("Local")).toBeNull();
    expect(backendFromKey("C:\\a")).toBeNull();
  });

  it("키 → 백엔드 → 키 가 제자리로 돌아온다", () => {
    for (const key of [LOCAL_KEY, "ssh:1", "ssh:42"]) {
      expect(backendFromKey(key)?.key).toBe(key);
    }
  });
});

describe("nameError — 이름 한 조각에 쓸 수 없는 글자", () => {
  it("유닉스는 `/` 하나만 막는다", () => {
    expect(nameError("보통 이름", "/")).toBeNull();
    expect(nameError("a:b*c?", "/")).toBeNull(); // 유닉스에서는 전부 멀쩡한 파일명이다
    expect(nameError("a/b", "/")).toBe("files.ops.name.posix");
  });

  it("윈도우는 아홉 글자를 막는다 — `:` 와 `\\` 가 특히 위험하다", () => {
    // 이 둘이 통과하면 "이름 바꾸기" 가 조용히 "다른 자리로 옮기기" 가 된다
    for (const bad of ["a:b", "a\\b", "a/b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b"]) {
      expect(nameError(bad, "\\")).not.toBeNull();
    }
  });

  it("윈도우에서도 평범한 이름은 통과한다", () => {
    expect(nameError("보고서 v2.txt", "\\")).toBeNull();
  });

  it("빈 이름은 여기서 걸리지 않는다 — 그 판정은 호출부의 몫이다", () => {
    expect(nameError("", "/")).toBeNull();
    expect(nameError("", "\\")).toBeNull();
  });
});
