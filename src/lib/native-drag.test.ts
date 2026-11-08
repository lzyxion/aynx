import { Channel, invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeDragBlocker, startNativeDrag, uiIconPaths } from "$lib/native-drag";
import type { NativeDragResult } from "$lib/native-drag";

/**
 * 웹뷰 밖으로 끌어내기 — **부르기 전에 거절하는** 판정과 명령 페이로드의 모양
 * (docs/log/2026-09-04-native-drag-out.md).
 *
 * [`nativeDragBlocker`] 는 취향 문제가 아니다: 플러그인의 윈도우 경로는 셸 항목을 만들지
 * 못하면 `unwrap()` 으로 **패닉**해 앱이 통째로 죽는다. 사후 처리가 불가능한 실패라
 * 이 함수가 유일한 방어선이고, 그래서 여기 케이스가 촘촘하다.
 *
 * 캔버스를 쓰는 [`nativeDragIcon`] 은 이 파일에 없다 — 러너 환경이 `node` 라 `document`
 * 자체가 없다 (아래 `it.todo`).
 */

/** 명령에 실린 인자 뭉치 — tauri 의 `InvokeArgs` 는 넓은 합집합이라 한 번만 좁힌다 */
function lastInvokeArgs(): Record<string, unknown> {
  const calls = vi.mocked(invoke).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1] as Record<string, unknown>;
}

/** `onEvent` 로 실려 간 채널 — 플러그인이 끝을 알리는 통로다 */
function sentChannel(): { onmessage: ((m: { result: NativeDragResult }) => void) | null } {
  return lastInvokeArgs().onEvent as {
    onmessage: ((m: { result: NativeDragResult }) => void) | null;
  };
}

// ---------------------------------------------------------------------------
// 1. nativeDragBlocker — 무엇을 막고 무엇을 통과시키는가
// ---------------------------------------------------------------------------

describe("nativeDragBlocker — 통과", () => {
  it("드라이브 절대 경로는 통과한다 (null)", () => {
    expect(nativeDragBlocker(["C:\\Users\\me\\a.txt"])).toBeNull();
  });

  it("소문자 드라이브·슬래시 경로도 통과한다", () => {
    expect(nativeDragBlocker(["c:/users/me/a.txt"])).toBeNull();
    expect(nativeDragBlocker(["z:\\a"])).toBeNull();
  });

  it("여럿이어도 전부 멀쩡하면 통과한다", () => {
    expect(nativeDragBlocker(["C:\\a\\1.txt", "D:/b/2.txt"])).toBeNull();
  });

  it("경로에 공백·한글·점이 있어도 막지 않는다", () => {
    expect(nativeDragBlocker(["C:\\내 문서\\보고서 v1.2.txt"])).toBeNull();
  });

  it("안전선(250자) 바로 아래는 통과한다", () => {
    const path = `C:\\${"a".repeat(250 - 3)}`;
    expect(path).toHaveLength(250);
    expect(nativeDragBlocker([path])).toBeNull();
  });
});

describe("nativeDragBlocker — 거절", () => {
  it("빈 목록은 끌 것이 없다", () => {
    expect(nativeDragBlocker([])?.key).toBe("files.drag.blocked.empty");
  });

  it("UNC 네트워크 경로는 막는다 (플러그인이 패닉한다 — 이슈 #72)", () => {
    const why = nativeDragBlocker(["\\\\server\\share\\a.txt"]);
    expect(why?.key).toBe("files.drag.blocked.unc");
  });

  it("슬래시로 쓴 네트워크 경로도 같은 사유로 막는다", () => {
    expect(nativeDragBlocker(["//server/share/a.txt"])?.key).toBe("files.drag.blocked.unc");
  });

  it("드라이브가 없는 경로는 막는다", () => {
    for (const path of ["docs/a.txt", "a.txt", "/usr/local/bin", "~\\a", "C:a.txt", "1:\\a"]) {
      expect(nativeDragBlocker([path])?.key, path).toBe("files.drag.blocked.relative");
    }
  });

  it("빈 문자열 하나도 드라이브 경로가 아니다", () => {
    expect(nativeDragBlocker([""])?.key).toBe("files.drag.blocked.relative");
  });

  it("MAX_PATH 안전선(250자)을 넘으면 막고, 그 숫자를 문구에 적는다", () => {
    const path = `C:\\${"a".repeat(250 - 2)}`;
    expect(path).toHaveLength(251);
    const why = nativeDragBlocker([path]);
    expect(why?.key).toBe("files.drag.blocked.long");
    // 숫자는 문구가 아니라 **인자**로 실린다 (사전이 `{limit}` 자리에 꽂는다)
    expect(why?.params).toEqual({ limit: 250 });
  });

  it("하나라도 걸리면 목록 전체를 막는다", () => {
    expect(nativeDragBlocker(["C:\\ok.txt", "\\\\server\\share\\x"])?.key).toBe("files.drag.blocked.unc");
  });

  it("사유는 앞에서부터 판정한 첫 항목의 것이다", () => {
    // 두 번째가 UNC 지만 첫 항목이 이미 상대 경로라 그쪽 문구가 나온다.
    expect(nativeDragBlocker(["rel/a", "\\\\server\\share\\x"])?.key).toBe(
      "files.drag.blocked.relative",
    );
  });

  it("모든 사유가 `files.drag.blocked.*` 키 하나로 온다 (문구는 사전의 몫)", () => {
    for (const paths of [["\\\\s\\x"], ["rel"], [`C:\\${"a".repeat(300)}`]]) {
      expect(nativeDragBlocker(paths)?.key).toMatch(/^files\.drag\.blocked\./);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. startNativeDrag — 페이로드 조립과 끝맺음
//
// 크레이트(`tauri-plugin-drag-2.1.1/src/commands.rs`)와 맞춘 모양이 계약이다:
// `item` 은 경로 배열 그대로, `image` 는 `data:image/png;base64,` 접두사,
// `mode` 는 최상위가 아니라 `options` 안, 인자 이름은 camelCase.
// ---------------------------------------------------------------------------

const ICON = "data:image/png;base64,iVBORw0KGgo=";

describe("startNativeDrag — 플러그인 호출 모양", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  it("명령 이름은 plugin:drag|start_drag 다", () => {
    startNativeDrag(["C:\\a.txt"], ICON, () => {});
    expect(vi.mocked(invoke).mock.calls[0][0]).toBe("plugin:drag|start_drag");
  });

  it("경로는 배열 그대로 실린다 (태그로 감싸지 않는다)", () => {
    startNativeDrag(["C:\\a.txt", "C:\\b.txt"], ICON, () => {});
    expect(lastInvokeArgs().item).toEqual(["C:\\a.txt", "C:\\b.txt"]);
  });

  it("건네받은 배열을 복사해 싣는다 (호출자가 나중에 고쳐도 안전하다)", () => {
    const paths = ["C:\\a.txt"];
    startNativeDrag(paths, ICON, () => {});
    const sent = lastInvokeArgs().item as string[];
    expect(sent).not.toBe(paths);
    paths.push("C:\\b.txt");
    expect(sent).toEqual(["C:\\a.txt"]);
  });

  it("mode 는 최상위가 아니라 options 안이고 값은 copy 다", () => {
    startNativeDrag(["C:\\a.txt"], ICON, () => {});
    const args = lastInvokeArgs();
    expect(args.options).toEqual({ mode: "copy" });
    expect(args.mode).toBeUndefined();
  });

  it("아이콘은 받은 그대로 image 로 간다", () => {
    startNativeDrag(["C:\\a.txt"], ICON, () => {});
    expect(lastInvokeArgs().image).toBe(ICON);
  });

  it("onEvent 는 채널이다 (camelCase — on_event 가 아니다)", () => {
    startNativeDrag(["C:\\a.txt"], ICON, () => {});
    const args = lastInvokeArgs();
    expect(args.onEvent).toBeInstanceOf(Channel);
    expect(args.on_event).toBeUndefined();
  });

  it("동기적으로 부른다 — dragstart 한가운데서 한 틱도 늦으면 안 된다", () => {
    startNativeDrag(["C:\\a.txt"], ICON, () => {});
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("인자가 네 칸뿐이다 (군더더기를 싣지 않는다)", () => {
    startNativeDrag(["C:\\a.txt"], ICON, () => {});
    expect(Object.keys(lastInvokeArgs()).sort()).toEqual(["image", "item", "onEvent", "options"]);
  });
});

describe("startNativeDrag — 끝맺음", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("Dropped 를 그대로 전한다", () => {
    const onEnd = vi.fn();
    startNativeDrag(["C:\\a.txt"], ICON, onEnd);
    sentChannel().onmessage?.({ result: "Dropped" });
    expect(onEnd).toHaveBeenCalledWith("Dropped");
  });

  it("Cancel 도 그대로 전한다", () => {
    const onEnd = vi.fn();
    startNativeDrag(["C:\\a.txt"], ICON, onEnd);
    sentChannel().onmessage?.({ result: "Cancel" });
    expect(onEnd).toHaveBeenCalledWith("Cancel");
  });

  it("모르는 값은 Cancel 로 접는다", () => {
    const onEnd = vi.fn();
    startNativeDrag(["C:\\a.txt"], ICON, onEnd);
    // 플러그인이 두 값 말고 다른 것을 보내도 화면이 어정쩡한 상태로 남지 않아야 한다.
    sentChannel().onmessage?.({ result: "뭔가" as NativeDragResult });
    expect(onEnd).toHaveBeenCalledWith("Cancel");
  });

  it("정리는 한 번뿐이다 (메시지가 여러 번 와도)", () => {
    const onEnd = vi.fn();
    startNativeDrag(["C:\\a.txt"], ICON, onEnd);
    const ch = sentChannel();
    ch.onmessage?.({ result: "Dropped" });
    ch.onmessage?.({ result: "Cancel" });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith("Dropped");
  });

  it("부르는 순간에는 아직 아무것도 끝나지 않았다", () => {
    const onEnd = vi.fn();
    startNativeDrag(["C:\\a.txt"], ICON, onEnd);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("호출이 거절되면 Cancel + onError 로 나간다 — 삼키지 않는다", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("권한 거절"));
    const onEnd = vi.fn();
    const onError = vi.fn();
    startNativeDrag(["C:\\a.txt"], ICON, onEnd, onError);
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledWith("Cancel"));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain("권한 거절");
    expect(console.error).toHaveBeenCalled();
  });

  it("onError 를 안 줘도 거절이 터지지 않는다", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("나쁨");
    const onEnd = vi.fn();
    startNativeDrag(["C:\\a.txt"], ICON, onEnd);
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledWith("Cancel"));
  });

  it("이미 끝난 뒤에 호출이 거절돼도 onEnd 는 다시 불리지 않는다", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("늦은 거절"));
    const onEnd = vi.fn();
    startNativeDrag(["C:\\a.txt"], ICON, onEnd);
    sentChannel().onmessage?.({ result: "Dropped" });
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith("Dropped");
  });

  it("던지지 않는다 — dragstart 한가운데서 예외가 튀면 브라우저가 반쯤 멈춘다", () => {
    vi.mocked(invoke).mockImplementationOnce(() => Promise.reject(new Error("아무거나")));
    expect(() => startNativeDrag(["C:\\a.txt"], ICON, () => {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. 캔버스가 필요한 자리 — 환경이 node 라 여기서는 못 돈다
// ---------------------------------------------------------------------------

describe("nativeDragIcon", () => {
  // `document.createElement("canvas")` · `Path2D` · `getComputedStyle` 이 전부 필요하다.
  // jsdom 을 깔아도 캔버스 2D 컨텍스트는 없어서(`getContext` 가 null) 실제로 그려지는 것을
  // 확인하려면 브라우저 러너가 있어야 한다.
  it.todo("data:image/png;base64, 로 시작하는 문자열을 만든다 (DOM 필요)");
  it.todo("캔버스를 못 쓰면 1×1 투명 PNG 로 물러난다 (DOM 필요)");
  it.todo("여럿이면 오른쪽 아래에 개수 배지를 얹는다 (DOM 필요)");
  it.todo("--bg-panel 처럼 var() 를 품은 합성 값은 대체색으로 물러난다 (DOM 필요)");
});

// ---------------------------------------------------------------------------
// 끌기 그림의 도형 — 목록 줄이 그리는 바로 그 `body` 에서 꺼낸다. 생성기가 `body` 모양을 바꾸면 여기서 먼저 깨진다 —
// 캔버스는 러너에서 못 그리므로(위 머리말) 빈 그림으로 조용히 나가는 것을 이 한 칸이 막는다.
// ---------------------------------------------------------------------------

describe("uiIconPaths — 캔버스에 넘길 path 데이터", () => {
  it("폴더는 꽉 찬 변형의 면 하나, 파일은 윤곽 그림의 면 하나", () => {
    const folder = uiIconPaths("folder", true);
    expect(folder).toHaveLength(1);
    expect(folder[0]).toMatch(/^M.*z$/);
    expect(folder[0]).not.toBe(uiIconPaths("folder")[0]);
    expect(uiIconPaths("file")).toHaveLength(1);
  });

  it("꽉 찬 변형이 없으면 윤곽 그림으로 물러난다", () => {
    expect(uiIconPaths("file", true)).toEqual(uiIconPaths("file"));
  });

  it("모르는 이름은 빈 배열 — 그림이 비어도 드래그는 산다", () => {
    expect(uiIconPaths("없는-이름")).toEqual([]);
  });
});
