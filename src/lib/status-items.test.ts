import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATUS_ORDER,
  RETIRED_STATUS_IDS,
  STATUS_ITEMS,
  applyOrder,
  parseStatusOrder,
  reorder,
  serializeStatusOrder,
  mergeCombos,
  shortcutTitle,
  type StatusItem,
} from "$lib/status-items";
import { ACTIONS } from "$lib/keybindings";
import { UI_ICONS } from "$lib/ui-icons.generated";
import { translate } from "$lib/i18n/dict";

/**
 * 상태바 선두단의 규칙 (docs/log/2026-09-15-start-page-favorites.md ·
 * docs/log/2026-09-15-lucide-ui-icons.md · 2026-10-18 통합 독 — 메뉴 칸이 전부 독으로 들어갔고, 실기 뒤 독 입구 칸까지 걷어 표가 비었다).
 *
 * 여기서 지키려는 것은 넷이다:
 *  · **액션 id 는 레지스트리에 있는 글자**여야 한다 — 오타 한 자면 눌러도 아무 일이 없는
 *    버튼이 되는데, 화면에는 멀쩡한 글리프가 그대로 서 있어 사람 눈으로는 잡히지 않는다.
 *  · **아이콘 이름은 생성 목록에 있는 글자**여야 한다 — 오타면 `UiIcon` 이 아무것도 그리지
 *    않아 **빈 버튼**이 선다. 같은 종류의, 눈으로는 안 잡히는 오타다.
 *  · **저장값이 어긋나도 띠는 성립한다** — 합쳐진 id 는 물려받은 칸으로 접고, 모르는 id(걷힌 칸 포함)는
 *    조용히 버리고, 빠진 id 는 뒤에 붙인다 (docs/log/2026-09-25-unified-dock.md).
 *  · **툴팁은 조합이 없어도 성립한다** — 사용자가 단축키를 풀면 빈 괄호가 남으면 안 된다.
 *
 * 순서 규칙(`applyOrder` · `reorder`)의 몸통은 칸 수와 상관없는 일반 규칙이라 **표본 목록**으로 시험한다(지금 표는 비었다).
 */

/** 표본 칸 하나의 모양 — 옛 독 칸(id 만 바꿔 쓴다) */
const SHAPE: StatusItem = {
  id: "open-dock",
  kind: "toggle",
  action: "open-hosts-dock",
  tipActions: ["open-hosts-dock", "open-projects-dock"],
  icon: "dock",
  labelKey: "app.statusbar.item.open-dock",
};
/** 순서 규칙을 보는 표본 — `open-dock` 은 합쳐진 옛 id(호스트 · 프로젝트 · 레이아웃)가 접히는 자리라 그 글자로 둔다 */
const SAMPLE: readonly StatusItem[] = ["alpha", "open-dock", "beta", "gamma"].map((id) => ({ ...SHAPE, id }));
const ids = (list: readonly { id: string }[]) => list.map((i) => i.id);

describe("STATUS_ITEMS", () => {
  it("비어 있다 — 메뉴 칸은 독 안이고 독 입구 칸도 걷었다 (2026-10-18 실기)", () => {
    expect(STATUS_ITEMS).toEqual([]);
    expect(DEFAULT_STATUS_ORDER).toEqual([]);
    expect(RETIRED_STATUS_IDS).toContain("open-dock");
  });

  it("걷힌 칸의 동작은 단축키 · 팔레트에 그대로 산다 — 레지스트리에서 id 가 빠지지 않았다", () => {
    const known = new Set(ACTIONS.map((a) => a.id));
    // 칸 id 와 액션 id 가 같던 것들(세션 칸은 `open-console` · 오케스트레이션은 팔레트 전용이라 빼고 본다) + 독의 칸 키 셋
    for (const id of ["new-shell", "open-localfs", "command-palette", "folder-conversations", "open-plans", "open-settings", "open-console", "open-hosts-dock", "open-projects-dock", "open-db-dock"]) {
      expect(known.has(id)).toBe(true);
    }
  });

  it("표본 칸의 모양도 성립한다 — 액션은 레지스트리 · 그림은 생성 목록(Material Symbols) · 이름은 두 사전", () => {
    const known = new Set(ACTIONS.map((a) => a.id));
    expect(known.has(SHAPE.action)).toBe(true);
    for (const a of SHAPE.tipActions ?? []) expect(known.has(a)).toBe(true);
    expect(UI_ICONS[SHAPE.icon].source.startsWith("material-symbols:")).toBe(true);
    expect(translate("ko", SHAPE.labelKey)).not.toBe(SHAPE.labelKey);
    expect(translate("en", SHAPE.labelKey)).not.toBe(SHAPE.labelKey);
  });
});

describe("applyOrder — 지금 표", () => {
  it("저장값이 없으면 기본 목록 그대로다", () => {
    expect(applyOrder([])).toBe(STATUS_ITEMS);
    expect(applyOrder(null)).toBe(STATUS_ITEMS);
    expect(applyOrder(undefined)).toBe(STATUS_ITEMS);
  });

  it("통합 독 전 · 독 입구가 있던 때 저장해 둔 순서 — 걷힌 칸은 전부 조용히 버린다(빈자리도, 되살아난 칸도 없다)", () => {
    const saved = [
      "orchestration-start",
      "open-plans",
      "open-sessions",
      "folder-conversations",
      "command-palette",
      "open-localfs",
      "open-dock",
      "new-shell",
    ];
    expect(applyOrder(saved)).toEqual([]);
    expect(applyOrder(RETIRED_STATUS_IDS)).toEqual([]);
    expect(applyOrder(["open-dock"])).toEqual([]);
  });

  it("더 옛 저장값(대시보드 칸 · 호스트 · 프로젝트 · 레이아웃 칸 · 설정 칸)도 아무 칸도 세우지 않는다", () => {
    expect(applyOrder(["open-console", "open-layouts", "open-settings", "open-hosts", "open-projects"])).toEqual([]);
  });
});

describe("applyOrder — 순서 규칙 (표본 목록)", () => {
  it("저장된 순서를 따른다", () => {
    const want = ["gamma", "beta", "open-dock", "alpha"];
    expect(ids(applyOrder(want, SAMPLE))).toEqual(want);
  });

  it("모르는 id 는 버린다 — 없어진 칸이 빈자리를 만들지 않는다", () => {
    expect(ids(applyOrder(["beta", "open-doorway", "alpha"], SAMPLE))).toEqual(["beta", "alpha", "open-dock", "gamma"]);
  });

  it("합치기 전 저장값 — 옛 세 칸은 독 칸 하나로, **첫째가 있던 자리**에 접힌다", () => {
    const saved = ["gamma", "open-layouts", "beta", "open-projects", "open-hosts", "alpha"];
    expect(ids(applyOrder(saved, SAMPLE))).toEqual(["gamma", "open-dock", "beta", "alpha"]);
  });

  it("빠진 id 는 기본 순서 그대로 뒤에 붙인다 — 새 칸이 안 보이면 안 된다", () => {
    expect(ids(applyOrder(["gamma"], SAMPLE))).toEqual(["gamma", "alpha", "open-dock", "beta"]);
  });

  it("중복 id 는 앞의 것이 이긴다", () => {
    const out = applyOrder(["open-dock", "open-dock", "open-hosts", "alpha"], SAMPLE);
    expect(out.filter((i) => i.id === "open-dock")).toHaveLength(1);
    expect(out).toHaveLength(SAMPLE.length);
  });
});

describe("reorder", () => {
  it("가리킨 칸 **앞**으로 옮긴다", () => {
    expect(ids(reorder(SAMPLE, "gamma", "open-dock"))).toEqual(["alpha", "gamma", "open-dock", "beta"]);
  });

  it("`null` 이면 맨 뒤로 (띠의 빈 자리에 놓기)", () => {
    expect(ids(reorder(SAMPLE, "alpha", null))).toEqual(["open-dock", "beta", "gamma", "alpha"]);
  });

  it("앞에서 뒤로 옮겨도 자리가 밀리지 않는다", () => {
    expect(ids(reorder(SAMPLE, "alpha", "gamma"))).toEqual(["open-dock", "beta", "alpha", "gamma"]);
  });

  it("달라지지 않으면 같은 배열 그대로다 (공연한 다시 그리기 없음)", () => {
    expect(reorder(SAMPLE, "alpha", "alpha")).toBe(SAMPLE);
    expect(reorder(SAMPLE, "alpha", "open-dock")).toBe(SAMPLE); // 이미 그 앞이다
    expect(reorder(SAMPLE, "gamma", null)).toBe(SAMPLE); // 이미 맨 뒤다
    expect(reorder(SAMPLE, "없는칸", "open-dock")).toBe(SAMPLE);
    expect(reorder(SAMPLE, "alpha", "없는칸")).toBe(SAMPLE);
    // 빈 지금 표에서는 어떤 옮기기도 같은 배열이다
    expect(reorder(STATUS_ITEMS, "open-dock", null)).toBe(STATUS_ITEMS);
  });
});

describe("parseStatusOrder / serializeStatusOrder", () => {
  it("왕복한다", () => {
    const ids = ["open-hosts", "new-shell"];
    expect(parseStatusOrder(serializeStatusOrder(ids))).toEqual(ids);
  });

  it("모양이 어긋난 값은 빈 목록 — throw 하지 않는다", () => {
    expect(parseStatusOrder(null)).toEqual([]);
    expect(parseStatusOrder("")).toEqual([]);
    expect(parseStatusOrder("{{{")).toEqual([]);
    expect(parseStatusOrder('{"a":1}')).toEqual([]);
    expect(parseStatusOrder('[1,2,{"id":"x"}]')).toEqual([]);
  });

  it("빈 글자·중복은 걸러 낸다", () => {
    expect(parseStatusOrder('["new-shell","","new-shell"," open-hosts "]')).toEqual([
      "new-shell",
      "open-hosts",
    ]);
  });
});

describe("shortcutTitle", () => {
  it("조합이 있으면 이름 뒤 괄호에 붙인다", () => {
    expect(shortcutTitle("새 터미널", "Ctrl+Shift+N")).toBe("새 터미널 (Ctrl+Shift+N)");
    expect(shortcutTitle("호스트", "Ctrl+Shift+H")).toBe("호스트 (Ctrl+Shift+H)");
  });

  it("조합이 없으면 이름만 — 빈 괄호를 남기지 않는다", () => {
    expect(shortcutTitle("새 터미널", null)).toBe("새 터미널");
    expect(shortcutTitle("새 터미널", "")).toBe("새 터미널");
    expect(shortcutTitle("새 터미널", undefined)).toBe("새 터미널");
  });
});

describe("mergeCombos — 여러 키의 문을 툴팁 한 자리로", () => {
  it("수식 키가 같으면 끝 키만 / 로 잇는다 (들어온 순서)", () => {
    expect(mergeCombos(["Ctrl+Shift+H", "Ctrl+Shift+J", "Ctrl+Shift+K"])).toBe("Ctrl+Shift+H/J/K");
    expect(mergeCombos(["Ctrl+Shift+K", "Ctrl+Shift+H"])).toBe("Ctrl+Shift+K/H");
    expect(shortcutTitle("독", mergeCombos(["Ctrl+Shift+H", "Ctrl+Shift+J", "Ctrl+Shift+K"]))).toBe(
      "독 (Ctrl+Shift+H/J/K)",
    );
  });

  it("하나면 그대로 · 없으면 null", () => {
    expect(mergeCombos(["Ctrl+Shift+H"])).toBe("Ctrl+Shift+H");
    expect(mergeCombos([])).toBeNull();
    expect(mergeCombos([""])).toBeNull();
  });

  it("수식 키가 다른 것은 따로 서고 공백 한 칸으로 잇는다", () => {
    expect(mergeCombos(["Ctrl+Shift+H", "Alt+J", "Ctrl+Shift+K"])).toBe("Ctrl+Shift+H/K Alt+J");
    expect(mergeCombos(["Ctrl+H", "Ctrl+Shift+J"])).toBe("Ctrl+H Ctrl+Shift+J");
  });

  it("수식 키 없는 키 · / 나 공백이 든 끝 키는 접지 않는다", () => {
    expect(mergeCombos(["F1", "F2"])).toBe("F1 F2");
    expect(mergeCombos(["Ctrl+/", "Ctrl+K"])).toBe("Ctrl+/ Ctrl+K");
    expect(mergeCombos(["Ctrl+K", "Ctrl+/"])).toBe("Ctrl+K Ctrl+/");
    expect(mergeCombos(["Ctrl++", "Ctrl+K"])).toBe("Ctrl++/K");
  });
});
