import { describe, expect, it } from "vitest";
import {
  MAX_ENTRIES,
  back,
  canBack,
  canForward,
  current,
  dropAt,
  emptyHistory,
  forward,
  navButtonOf,
  navKeyOf,
  push,
  type NavHistory,
} from "$lib/nav-history";

/**
 * 탐색 이력 (docs/log/2026-09-04-nav-history.md).
 *
 * 브라우저와 같은 **한 줄 + 커서**. 이 파일이 지키는 계약: 같은 자리를 연달아 밀면 무시 ·
 * 새로 가면 앞으로-이력을 버림 · [`MAX_ENTRIES`] 상한 · 바뀔 것이 없으면 **같은 객체**.
 */

/** `push` 를 차례로 먹여 이력을 만든다 */
function historyOf(...paths: string[]): NavHistory {
  return paths.reduce<NavHistory>((h, p) => push(h, p), emptyHistory());
}

describe("emptyHistory · current", () => {
  it("빈 이력의 커서는 -1 이고 지금 자리는 null 이다", () => {
    const h = emptyHistory();
    expect(h.entries).toEqual([]);
    expect(h.index).toBe(-1);
    expect(current(h)).toBeNull();
  });

  it("커서는 언제나 지금 보고 있는 자리를 가리킨다", () => {
    expect(current(historyOf("/a", "/b", "/c"))).toBe("/c");
  });
});

describe("push", () => {
  it("첫 자리를 밀면 커서가 0 이다", () => {
    const h = push(emptyHistory(), "/a");
    expect(h.entries).toEqual(["/a"]);
    expect(h.index).toBe(0);
  });

  it("차례로 밀면 줄이 자라고 커서가 끝을 따라간다", () => {
    const h = historyOf("/a", "/b", "/c");
    expect(h.entries).toEqual(["/a", "/b", "/c"]);
    expect(h.index).toBe(2);
  });

  it("같은 자리를 연달아 밀면 **같은 객체**를 돌려준다 (새로고침·재연결이 이력을 채우지 않게)", () => {
    const h = historyOf("/a", "/b");
    expect(push(h, "/b")).toBe(h);
  });

  it("한 칸 건너 같은 자리는 무시가 아니다 — 왕복도 이동이다", () => {
    const h = historyOf("/a", "/b", "/a");
    expect(h.entries).toEqual(["/a", "/b", "/a"]);
    expect(h.index).toBe(2);
  });

  it("뒤로 간 뒤 새로 가면 앞으로-이력을 버린다", () => {
    const h = historyOf("/a", "/b", "/c", "/d");
    const stepped = back(back(h)!.h)!.h; // 커서를 /b 로
    expect(current(stepped)).toBe("/b");
    const next = push(stepped, "/e");
    expect(next.entries).toEqual(["/a", "/b", "/e"]);
    expect(next.index).toBe(2);
    expect(canForward(next)).toBe(false);
  });

  it("빈 이력에서 뒤로가 없으므로 push 는 늘 맨 뒤에 붙는다", () => {
    const h = push(push(emptyHistory(), "/a"), "/b");
    expect(h.index).toBe(h.entries.length - 1);
  });

  it("MAX_ENTRIES 를 넘으면 앞에서부터 밀려나고 커서도 함께 당겨진다", () => {
    let h = emptyHistory();
    for (let i = 0; i < MAX_ENTRIES + 5; i++) h = push(h, `/p${i}`);
    expect(h.entries.length).toBe(MAX_ENTRIES);
    expect(h.index).toBe(MAX_ENTRIES - 1);
    expect(h.entries[0]).toBe("/p5"); // 앞의 다섯이 밀려났다
    expect(current(h)).toBe(`/p${MAX_ENTRIES + 4}`);
  });

  it("상한은 50 이다", () => {
    expect(MAX_ENTRIES).toBe(50);
  });
});

describe("canBack · canForward", () => {
  it("빈 이력에서는 양쪽 다 갈 곳이 없다", () => {
    const h = emptyHistory();
    expect(canBack(h)).toBe(false);
    expect(canForward(h)).toBe(false);
  });

  it("한 칸뿐이면 양쪽 다 갈 곳이 없다", () => {
    const h = historyOf("/a");
    expect(canBack(h)).toBe(false);
    expect(canForward(h)).toBe(false);
  });

  it("끝에 있으면 뒤로만, 처음에 있으면 앞으로만", () => {
    const h = historyOf("/a", "/b", "/c");
    expect(canBack(h)).toBe(true);
    expect(canForward(h)).toBe(false);
    const head = back(back(h)!.h)!.h;
    expect(canBack(head)).toBe(false);
    expect(canForward(head)).toBe(true);
  });
});

describe("back · forward", () => {
  it("뒤로는 커서만 옮긴 결과와 목적지를 함께 준다 — 줄은 그대로다", () => {
    const h = historyOf("/a", "/b", "/c");
    const step = back(h);
    expect(step).not.toBeNull();
    expect(step!.path).toBe("/b");
    expect(step!.h.index).toBe(1);
    expect(step!.h.entries).toEqual(["/a", "/b", "/c"]);
  });

  it("갈 곳이 없으면 null — 화면 쪽이 아무 일도 하지 않는다", () => {
    expect(back(emptyHistory())).toBeNull();
    expect(back(historyOf("/a"))).toBeNull();
    expect(forward(historyOf("/a", "/b"))).toBeNull();
    expect(forward(emptyHistory())).toBeNull();
  });

  it("앞으로는 뒤로를 되돌린다", () => {
    const h = historyOf("/a", "/b", "/c");
    const b = back(h)!;
    const f = forward(b.h)!;
    expect(f.path).toBe("/c");
    expect(f.h.index).toBe(2);
    expect(current(f.h)).toBe("/c");
  });

  it("뒤로를 여러 번 눌러도 한 번에 한 칸씩만 움직인다", () => {
    const h = historyOf("/a", "/b", "/c", "/d");
    const one = back(h)!;
    const two = back(one.h)!;
    expect(one.path).toBe("/c");
    expect(two.path).toBe("/b");
  });

  it("이동을 채택하지 않으면(실패했으면) 원래 이력이 그대로다", () => {
    const h = historyOf("/a", "/b", "/c");
    back(h); // 결과를 버린다
    expect(h.index).toBe(2);
    expect(current(h)).toBe("/c");
  });
});

describe("dropAt", () => {
  it("사라진 자리를 이력에서 떨어낸다", () => {
    const h = historyOf("/a", "/b", "/c");
    const next = dropAt(h, 1);
    expect(next.entries).toEqual(["/a", "/c"]);
  });

  it("커서보다 앞의 항목을 지우면 커서가 함께 당겨진다 — 보던 자리를 계속 가리킨다", () => {
    const h = historyOf("/a", "/b", "/c"); // 커서 2 (/c)
    const next = dropAt(h, 0);
    expect(next.entries).toEqual(["/b", "/c"]);
    expect(current(next)).toBe("/c");
  });

  it("커서 뒤의 항목을 지우면 커서는 그대로다", () => {
    const h = back(historyOf("/a", "/b", "/c"))!.h; // 커서 1 (/b)
    const next = dropAt(h, 2);
    expect(next.entries).toEqual(["/a", "/b"]);
    expect(current(next)).toBe("/b");
  });

  it("지금 보고 있는 자리를 지우면 커서가 줄 안으로 잘려 들어온다", () => {
    const h = historyOf("/a", "/b", "/c"); // 커서 2
    const next = dropAt(h, 2);
    expect(next.entries).toEqual(["/a", "/b"]);
    expect(next.index).toBe(1);
  });

  it("마지막 하나를 지우면 빈 이력이 된다", () => {
    const next = dropAt(historyOf("/a"), 0);
    expect(next.entries).toEqual([]);
    expect(next.index).toBe(-1);
    expect(current(next)).toBeNull();
  });

  it("범위 밖의 색인이면 **같은 객체**를 돌려준다", () => {
    const h = historyOf("/a", "/b");
    expect(dropAt(h, -1)).toBe(h);
    expect(dropAt(h, 2)).toBe(h);
    const empty = emptyHistory();
    expect(dropAt(empty, 0)).toBe(empty);
  });

  it("떨어낸 뒤에도 [뒤로] 는 다음 항목으로 간다 — 같은 오류가 되풀이되지 않는다", () => {
    const h = historyOf("/a", "/b", "/c"); // 커서 2
    const dead = back(h)!; // /b 로 가려다 실패했다고 치자 (색인 1)
    const pruned = dropAt(h, 1);
    expect(dead.path).toBe("/b");
    expect(pruned.entries).toEqual(["/a", "/c"]);
    expect(back(pruned)!.path).toBe("/a");
  });
});

describe("navButtonOf", () => {
  it("5-버튼 마우스의 엄지 버튼 둘만 방향이다", () => {
    expect(navButtonOf(3)).toBe("back");
    expect(navButtonOf(4)).toBe("forward");
  });

  it("주·휠·보조 버튼은 방향이 아니다", () => {
    expect(navButtonOf(0)).toBeNull();
    expect(navButtonOf(1)).toBeNull();
    expect(navButtonOf(2)).toBeNull();
    expect(navButtonOf(5)).toBeNull();
  });
});

describe("navKeyOf", () => {
  it("code 로만 와도 잡는다 (key 가 비는 장치)", () => {
    expect(navKeyOf({ code: "BrowserBack", key: "" })).toBe("back");
    expect(navKeyOf({ code: "BrowserForward", key: "" })).toBe("forward");
  });

  it("key 로만 와도 잡는다 (code 가 비는 장치)", () => {
    expect(navKeyOf({ code: "", key: "BrowserBack" })).toBe("back");
    expect(navKeyOf({ code: "", key: "BrowserForward" })).toBe("forward");
  });

  it("평범한 키는 내비게이션이 아니다", () => {
    expect(navKeyOf({ code: "Backspace", key: "Backspace" })).toBeNull();
    expect(navKeyOf({ code: "KeyB", key: "b" })).toBeNull();
    expect(navKeyOf({ code: "ArrowLeft", key: "ArrowLeft" })).toBeNull();
  });
});
