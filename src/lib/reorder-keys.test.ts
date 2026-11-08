import { describe, expect, it } from "vitest";
import { moveTarget } from "$lib/reorder-keys";
import { favoriteKey, reorderFavorites, type Favorite } from "$lib/favorites";
import { reorder, STATUS_ITEMS } from "$lib/status-items";

/**
 * 키보드로 한 칸 옮기는 규칙 (docs/log/2026-09-17-keyboard-reorder.md).
 *
 * 지키려는 것은 셋이다:
 *  · **둘러 가지 않는다** — 양 끝에서 더 가면 아무 일도 아니다(그리고 그것이 곧 메뉴 항목의
 *    비활성 판정이다).
 *  · **`Home`/`End` 도 같은 함수**다 — `delta` 가 목록 길이면 양 끝에 선다.
 *  · **드래그와 같은 결과**다 — 여기서 낸 `to` 를 기존 `reorder*` 에 그대로 넣으면 사람이
 *    끌어다 놓았을 때와 같은 목록이 나온다 (두 길이 갈리면 안 된다).
 */

const keys = ["a", "b", "c", "d"];

/** `moveTarget` 이 낸 자리를 실제로 적용한 목록 (계약 확인용 — `reorder*` 와 같은 뜻) */
function applied(list: readonly string[], key: string, delta: number): readonly string[] {
  const target = moveTarget(list, key, delta);
  if (!target) return list;
  const rest = list.filter((k) => k !== key);
  const at = target.to === null ? rest.length : rest.indexOf(target.to);
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}

describe("moveTarget — 한 칸 옮길 자리", () => {
  it("오른쪽 한 칸은 **다음다음 키 앞**이다", () => {
    expect(moveTarget(keys, "a", 1)).toEqual({ to: "c" });
    expect(applied(keys, "a", 1)).toEqual(["b", "a", "c", "d"]);
  });

  it("왼쪽 한 칸은 **앞 키 앞**이다", () => {
    expect(moveTarget(keys, "c", -1)).toEqual({ to: "b" });
    expect(applied(keys, "c", -1)).toEqual(["a", "c", "b", "d"]);
  });

  it("마지막 바로 앞에서 오른쪽으로 가면 맨 뒤(`null`)다", () => {
    expect(moveTarget(keys, "c", 1)).toEqual({ to: null });
    expect(applied(keys, "c", 1)).toEqual(["a", "b", "d", "c"]);
  });

  it("양 끝에서는 `null` — 둘러 가지 않는다 (메뉴 항목의 비활성 판정)", () => {
    expect(moveTarget(keys, "a", -1)).toBeNull();
    expect(moveTarget(keys, "d", 1)).toBeNull();
  });

  it("모르는 키·`delta` 0·NaN 은 `null`", () => {
    expect(moveTarget(keys, "z", 1)).toBeNull();
    expect(moveTarget(keys, "a", 0)).toBeNull();
    expect(moveTarget(keys, "a", Number.NaN)).toBeNull();
  });

  it("칸이 둘이면 서로 자리를 바꾼다", () => {
    expect(moveTarget(["a", "b"], "a", 1)).toEqual({ to: null });
    expect(applied(["a", "b"], "a", 1)).toEqual(["b", "a"]);
    expect(moveTarget(["a", "b"], "b", -1)).toEqual({ to: "a" });
    expect(applied(["a", "b"], "b", -1)).toEqual(["b", "a"]);
  });

  it("칸이 하나거나 없으면 옮길 자리가 없다", () => {
    expect(moveTarget(["a"], "a", 1)).toBeNull();
    expect(moveTarget(["a"], "a", -1)).toBeNull();
    expect(moveTarget([], "a", 1)).toBeNull();
  });

  it("`Home`/`End` — `delta` 가 목록 길이면 양 끝에 선다 (잘린다)", () => {
    expect(moveTarget(keys, "c", -keys.length)).toEqual({ to: "a" });
    expect(applied(keys, "c", -keys.length)).toEqual(["c", "a", "b", "d"]);
    expect(moveTarget(keys, "b", keys.length)).toEqual({ to: null });
    expect(applied(keys, "b", keys.length)).toEqual(["a", "c", "d", "b"]);
  });

  it("이미 그 끝에 있으면 `Home`/`End` 도 `null`", () => {
    expect(moveTarget(keys, "a", -keys.length)).toBeNull();
    expect(moveTarget(keys, "d", keys.length)).toBeNull();
  });
});

describe("드래그와 같은 결과를 낸다", () => {
  const favs: readonly Favorite[] = [
    { kind: "host", alias: "a" },
    { kind: "host", alias: "b" },
    { kind: "project", id: "L1" },
  ];

  it("즐겨찾기 — `reorderFavorites` 에 그대로 넣을 수 있는 키다", () => {
    const list = favs.map(favoriteKey);
    const target = moveTarget(list, "host:a", 1);
    expect(target).toEqual({ to: "project:L1" });
    expect(reorderFavorites(favs, "host:a", target?.to ?? null).map(favoriteKey)).toEqual([
      "host:b",
      "host:a",
      "project:L1",
    ]);
  });

  // 상태바 표는 2026-10-18 부터 비었다(독 입구 칸까지 걷음) — 순서 규칙은 표본 목록으로 본다
  const bar = ["a", "b", "c", "d"].map((id) => ({ id, kind: "toggle" as const, action: "open-hosts-dock", icon: "dock", labelKey: "app.statusbar.item.open-dock" as const }));

  it("상태바 — `reorder` 에 그대로 넣을 수 있는 id 다", () => {
    const ids = bar.map((i) => i.id);
    const target = moveTarget(ids, ids[0], 1);
    expect(target).toEqual({ to: ids[2] });
    expect(reorder(bar, ids[0], target?.to ?? null).map((i) => i.id)).toEqual([
      ids[1],
      ids[0],
      ...ids.slice(2),
    ]);
  });

  it("상태바 — 맨 뒤 칸은 더 갈 곳이 없다 · 빈 지금 표에서는 옮길 칸이 없다", () => {
    const ids = bar.map((i) => i.id);
    expect(moveTarget(ids, ids[ids.length - 1], 1)).toBeNull();
    expect(moveTarget(STATUS_ITEMS.map((i) => i.id), "open-dock", 1)).toBeNull();
  });
});
