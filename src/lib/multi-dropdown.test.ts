import { describe, expect, it } from "vitest";
import {
  multiDropdownLabel, normalizeMultiValues, toggleMultiValue, type MultiDropdownOption,
} from "$lib/multi-dropdown";

const options: readonly MultiDropdownOption[] = [
  { value: "api", label: "API" },
  { value: "web", label: "Web", hint: "prod-host" },
  { value: "docs", label: "Docs" },
  { value: "locked", label: "Locked", disabled: true },
];
const many = (count: number) => "프로젝트 " + count + "개";

describe("multiDropdownLabel — 손잡이 글자", () => {
  it("빈 선택은 placeholder, 하나는 라벨이다 (힌트는 손잡이에 붙지 않는다)", () => {
    expect(multiDropdownLabel(options, [], "프로젝트 고르기", many)).toBe("프로젝트 고르기");
    expect(multiDropdownLabel(options, ["web"], "프로젝트 고르기", many)).toBe("Web");
  });

  it("둘까지는 목록 순서로 라벨을 잇는다", () => {
    expect(multiDropdownLabel(options, ["web", "api"], "고르기", many)).toBe("API, Web");
  });

  it("셋부터는 호출부가 준 개수 문구 — 두 개와 세 개의 경계를 지킨다", () => {
    expect(multiDropdownLabel(options, ["docs", "web", "api"], "고르기", many)).toBe("프로젝트 3개");
    expect(multiDropdownLabel(options, ["api", "web", "docs", "locked"], "Pick", (n) => n + " projects")).toBe("4 projects");
  });

  it("중복·목록 밖 값은 개수를 부풀리지 않는다", () => {
    expect(multiDropdownLabel(options, ["api", "api", "missing"], "고르기", many)).toBe("API");
    expect(multiDropdownLabel([], ["missing"], "고르기", many)).toBe("고르기");
  });
});

describe("normalizeMultiValues — 값의 순서와 보존", () => {
  it("입력 배열을 바꾸지 않고 options 순서로 중복·없는 값을 걷는다", () => {
    const values = ["docs", "missing", "api", "docs", "web"];
    expect(normalizeMultiValues(options, values)).toEqual(["api", "web", "docs"]);
    expect(values).toEqual(["docs", "missing", "api", "docs", "web"]);
  });

  it("선택된 비활성 항목도 남긴다", () => {
    expect(normalizeMultiValues(options, ["locked", "web"])).toEqual(["web", "locked"]);
  });

  it("호출부가 남겨 둔 미등록 프로젝트 옵션은 보존하고 라벨을 표시한다", () => {
    const withMissing = [...options, { value: "gone", label: "등록되지 않은 프로젝트 (gone)" }];
    expect(normalizeMultiValues(withMissing, ["gone", "api"])).toEqual(["api", "gone"]);
    expect(multiDropdownLabel(withMissing, ["gone"], "고르기", many)).toBe("등록되지 않은 프로젝트 (gone)");
    expect(toggleMultiValue(withMissing, ["gone", "api"], "gone")).toEqual(["api"]);
  });

  it("옵션 순서가 바뀌면 그 순서를 따르고, 빈 목록이면 빈 값이다", () => {
    expect(normalizeMultiValues([...options].reverse(), ["api", "web"])).toEqual(["web", "api"]);
    expect(normalizeMultiValues([], ["api"])).toEqual([]);
  });
});

describe("toggleMultiValue — 다중 토글", () => {
  it("추가·해제해도 다른 선택을 보존하고 목록 순서로 돌려준다", () => {
    const added = toggleMultiValue(options, ["docs"], "api");
    expect(added).toEqual(["api", "docs"]);
    expect(toggleMultiValue(options, added, "docs")).toEqual(["api"]);
    expect(toggleMultiValue(options, ["web"], "web")).toEqual([]);
  });

  it("비활성 항목은 추가·해제하지 않고, 없는 항목도 넣지 않는다", () => {
    expect(toggleMultiValue(options, ["web"], "locked")).toEqual(["web"]);
    expect(toggleMultiValue(options, ["locked", "api"], "locked")).toEqual(["api", "locked"]);
    expect(toggleMultiValue(options, ["web"], "missing")).toEqual(["web"]);
  });

  it("연속 토글은 되돌아오며 입력 배열을 바꾸지 않는다", () => {
    const values = ["api", "docs"];
    const next = toggleMultiValue(options, values, "web");
    expect(toggleMultiValue(options, next, "web")).toEqual(values);
    expect(values).toEqual(["api", "docs"]);
  });

  it("문자열 유니온 타입의 값으로도 동작한다", () => {
    const narrow: readonly MultiDropdownOption<"api" | "web">[] = options.slice(0, 2) as MultiDropdownOption<"api" | "web">[];
    const result: ("api" | "web")[] = toggleMultiValue(narrow, ["web"], "api");
    expect(result).toEqual(["api", "web"]);
  });
});
