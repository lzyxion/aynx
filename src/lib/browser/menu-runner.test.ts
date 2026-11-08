import { describe, expect, it } from "vitest";
import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";

/**
 * 통로의 계약은 **순서 하나**다 (`docs/conventions.md`): 스냅샷 → 닫기 → 실행.
 * 아래 테스트가 실제로 고정하는 것도 그 순서와, "닫힌 뒤에는 대상이 사라진다" 는 사정이다.
 */
describe("runOnMenu", () => {
  it("닫기 **전에** 대상을 뜬다 — 닫으면 사라지는 값이라도 살아남는다", () => {
    let menu: { entry: string } | null = { entry: "a.txt" };
    const seen: string[] = [];
    runOnMenu(
      () => menu?.entry,
      () => {
        menu = null;
      },
      (target) => {
        seen.push(target);
      },
    );
    expect(seen).toEqual(["a.txt"]);
    expect(menu).toBeNull();
  });

  it("실행은 **닫은 뒤**다 — 콜백이 볼 때 메뉴는 이미 없다", () => {
    let menu: { entry: string } | null = { entry: "a.txt" };
    let openAtRun: boolean | null = null;
    runOnMenu(
      () => menu?.entry,
      () => {
        menu = null;
      },
      () => {
        openAtRun = menu !== null;
      },
    );
    expect(openAtRun).toBe(false);
  });

  it("대상이 없으면 닫기만 하고 실행하지 않는다", () => {
    let closed = false;
    let ran = false;
    runOnMenu<string>(
      () => null,
      () => {
        closed = true;
      },
      () => {
        ran = true;
      },
    );
    expect(closed).toBe(true);
    expect(ran).toBe(false);
  });

  it("`undefined` 도 대상 없음이다 (`menu?.entry` 가 그렇게 온다)", () => {
    let ran = false;
    runOnMenu<string>(
      () => undefined,
      () => {},
      () => {
        ran = true;
      },
    );
    expect(ran).toBe(false);
  });

  it("빈 문자열·0 은 **엄연한 대상**이다 (falsy 로 걸러 내지 않는다)", () => {
    const seen: unknown[] = [];
    runOnMenu(
      () => "",
      () => {},
      (t) => {
        seen.push(t);
      },
    );
    runOnMenu(
      () => 0,
      () => {},
      (t) => {
        seen.push(t);
      },
    );
    expect(seen).toEqual(["", 0]);
  });

  it("비동기 콜백도 받는다 (기다리지 않는다 — 메뉴 항목은 결과를 안 본다)", async () => {
    let done = false;
    runOnMenu(
      () => "x",
      () => {},
      async () => {
        await Promise.resolve();
        done = true;
      },
    );
    expect(done).toBe(false); // 아직
    await Promise.resolve();
    expect(done).toBe(true);
  });
});

describe("runAfterClose", () => {
  it("대상이 없는 항목도 **닫고 나서** 실행한다", () => {
    const order: string[] = [];
    runAfterClose(
      () => {
        order.push("close");
      },
      () => {
        order.push("run");
      },
    );
    expect(order).toEqual(["close", "run"]);
  });
});
