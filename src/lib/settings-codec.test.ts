import { describe, expect, it } from "vitest";
import {
  DEPRECATED_ACTION_IDS,
  bareName,
  clampInt,
  cleanAllowRules,
  cleanBundleOff,
  sameBundleOff,
  cleanStringList,
  keybindingsToPayload,
  known,
  normalizeKeybindings,
  normalizeStringMap,
  normalizeTriggers,
  sameAllowRules,
  sameKeybindings,
  sameStringList,
  sameStringMap,
  sameTriggers,
  text,
  triggersToPayload,
  VAULT_AUTO_LOCK_MAX,
  vaultAutoLockMinutes,
} from "$lib/settings-codec";
import { ACTIONS, resolveBindings } from "$lib/keybindings";
import type { Trigger } from "$lib/triggers";

/** 테스트에서 트리거 한 줄을 짧게 적기 위한 도우미 (`enabled` 기본 켬) */
function trg(patch: Partial<Trigger> & { pattern: string }): Trigger {
  return { enabled: true, ...patch };
}

describe("text — 빈 값은 '안 정함'", () => {
  it("양 끝 공백을 뗀다", () => {
    expect(text("  #7aa2f7 ")).toBe("#7aa2f7");
  });

  it("빈 문자열·공백만 있는 값은 undefined", () => {
    expect(text("")).toBeUndefined();
    expect(text("   ")).toBeUndefined();
  });

  it("문자열이 아니면 undefined (숫자 0·false 도 마찬가지)", () => {
    expect(text(0)).toBeUndefined();
    expect(text(false)).toBeUndefined();
    expect(text(null)).toBeUndefined();
    expect(text(undefined)).toBeUndefined();
    expect(text({})).toBeUndefined();
  });
});

describe("bareName — 경로가 아니라 이름 한 조각만", () => {
  it("평범한 파일 이름은 통과한다", () => {
    expect(bareName(" wallpaper.jpg ")).toBe("wallpaper.jpg");
  });

  it("구분자가 있으면 버린다 (앱 폴더 밖을 가리키는 값을 막는 두 번째 그물)", () => {
    expect(bareName("../x.png")).toBeUndefined();
    expect(bareName("sub/x.png")).toBeUndefined();
    expect(bareName("C:\\x.png")).toBeUndefined();
  });

  it("`.` 과 `..` 자체도 버린다", () => {
    expect(bareName(".")).toBeUndefined();
    expect(bareName("..")).toBeUndefined();
  });

  it("점으로 시작하는 이름은 버리지 않는다 (`.hidden.png` 은 이름이다)", () => {
    expect(bareName(".hidden.png")).toBe(".hidden.png");
  });
});

describe("known — 표에 있는 키만", () => {
  const table = { cover: "채우기", contain: "맞추기" };

  it("표에 있으면 통과 (공백을 뗀 뒤에 본다)", () => {
    expect(known(" contain ", table)).toBe("contain");
  });

  it("모르는 키는 undefined = 기본값 추종", () => {
    expect(known("stretch", table)).toBeUndefined();
    expect(known("", table)).toBeUndefined();
    expect(known(42, table)).toBeUndefined();
  });

  it("Object.prototype 의 이름은 표에 있는 것이 아니다", () => {
    expect(known("toString", table)).toBeUndefined();
  });
});

// 상태바 자리(`[app] status_bar`)의 정규화는 `normalizeSettings` 안에서
// `known(app.status_bar, STATUS_BAR_POSITIONS)` 한 줄이다. 그 함수는 룬 모듈
// (`settings.svelte.ts`)이라 vitest 로 런타임 import 할 수 없으므로(vitest.config 머리말 ·
// dock.ts 머리말), 여기서는 **같은 표를 손으로 옮겨** 그 판정을 못 박는다: 아는 넷은
// 통과(공백 제거), 모르는 값·빈 값은 undefined = 기본(`left`) 추종. 파일 왕복(기본값은
// 안 적고 고른 값은 남는다)의 진짜 회귀 그물은 Rust 쪽 `status_bar_is_kept_verbatim…` 이다.
describe("status_bar — 아는 자리만 통과, 모르는 값은 기본(left) 추종", () => {
  // `settings.svelte.ts` 의 STATUS_BAR_POSITIONS 와 **같아야 한다** (옮겨 적은 사본).
  // 값은 2026-09-17 부터 화면 문구가 아니라 **문구 키**다 — `known` 은 값을 보지 않으므로
  // 이 판정에는 아무 영향이 없지만, 사본이면 사본답게 같은 글자를 적어 둔다.
  const positions = {
    left: "settings.option.status_bar.left",
    top: "settings.option.status_bar.top",
    bottom: "settings.option.status_bar.bottom",
    right: "settings.option.status_bar.right",
  };

  it("네 자리는 그대로 통과한다 (양 끝 공백은 뗀다)", () => {
    expect(known("bottom", positions)).toBe("bottom");
    expect(known(" top ", positions)).toBe("top");
    expect(known("left", positions)).toBe("left");
    expect(known("right", positions)).toBe("right");
  });

  it("모르는 값·빈 값은 undefined = 기본(left) 추종", () => {
    expect(known("middle", positions)).toBeUndefined();
    expect(known("", positions)).toBeUndefined();
    expect(known(42, positions)).toBeUndefined();
  });
});

describe("clampInt — 정수로 반올림해 범위로 자른다", () => {
  it("범위 밖은 끝으로 당긴다 (손으로 적은 0 도 하한으로 올라온다)", () => {
    expect(clampInt(0, 10, 100)).toBe(10);
    expect(clampInt(999, 10, 100)).toBe(100);
  });

  it("소수는 반올림한다", () => {
    expect(clampInt(42.4, 0, 100)).toBe(42);
    expect(clampInt(42.5, 0, 100)).toBe(43);
  });

  it("숫자가 아니거나 유한하지 않으면 '안 정함'", () => {
    expect(clampInt("50", 0, 100)).toBeUndefined();
    expect(clampInt(Number.NaN, 0, 100)).toBeUndefined();
    expect(clampInt(Number.POSITIVE_INFINITY, 0, 100)).toBeUndefined();
  });
});

describe("vaultAutoLockMinutes — `0` 은 '잠그지 않는다' 라는 답이다", () => {
  it("`0` 을 하한으로 올리지 않는다 (clampInt 와 갈리는 유일한 점)", () => {
    expect(vaultAutoLockMinutes(0)).toBe(0);
  });

  it("고른 값은 그대로 (소수는 반올림)", () => {
    expect(vaultAutoLockMinutes(15)).toBe(15);
    expect(vaultAutoLockMinutes(4.6)).toBe(5);
  });

  it("하루를 넘는 값은 하루로 자른다 (`settings.rs` 의 MAX_AUTO_LOCK_MINUTES)", () => {
    expect(vaultAutoLockMinutes(999999)).toBe(VAULT_AUTO_LOCK_MAX);
    expect(VAULT_AUTO_LOCK_MAX).toBe(1440);
  });

  it("음수·비숫자·비유한은 '안 정함' = 기본값(30분) 추종", () => {
    expect(vaultAutoLockMinutes(-1)).toBeUndefined();
    expect(vaultAutoLockMinutes("30")).toBeUndefined();
    expect(vaultAutoLockMinutes(Number.NaN)).toBeUndefined();
    expect(vaultAutoLockMinutes(null)).toBeUndefined();
  });
});

describe("normalizeStringMap — 문자열 맵만, 빈 것은 '없음'", () => {
  it("문자열이 아닌 값은 걷어 낸다", () => {
    expect(normalizeStringMap({ a: "1", b: 2, c: null, d: " 3 " })).toEqual({ a: "1", d: "3" });
  });

  it("남는 것이 없으면 빈 객체가 아니라 undefined (dirty 판정이 흔들리지 않게)", () => {
    expect(normalizeStringMap({})).toBeUndefined();
    expect(normalizeStringMap({ a: 1 })).toBeUndefined();
    expect(normalizeStringMap(null)).toBeUndefined();
    expect(normalizeStringMap("nope")).toBeUndefined();
  });
});

describe("normalizeKeybindings — 레지스트리에 있는 액션만", () => {
  it("아는 id 는 남고 모르는 id 는 버린다", () => {
    const out = normalizeKeybindings({ "new-shell": " Ctrl+KeyK ", "gone-in-old-version": "F5" });
    expect(out).toEqual({ "new-shell": "Ctrl+KeyK" });
  });

  it("빈 조합·문자열 아닌 값은 버린다", () => {
    expect(normalizeKeybindings({ "new-shell": "  ", "close-tile": 7 })).toEqual({});
  });

  it("객체가 아니면 빈 맵", () => {
    expect(normalizeKeybindings(null)).toEqual({});
    expect(normalizeKeybindings(["Ctrl+KeyK"])).toEqual({});
  });
});

describe("normalizeTriggers — 목록의 모양만 믿을 수 있게", () => {
  it("배열이 아니면 빈 목록", () => {
    expect(normalizeTriggers(null, 50)).toEqual([]);
    expect(normalizeTriggers({ pattern: "x" }, 50)).toEqual([]);
  });

  it("빈 패턴은 버리고, `enabled` 가 없으면 켜진 것으로 본다", () => {
    const out = normalizeTriggers([{ pattern: "  " }, { pattern: " ERROR " }], 50);
    expect(out).toEqual([
      { pattern: "ERROR", fg: undefined, bg: undefined, url: undefined, tooltip: undefined, enabled: true },
    ]);
  });

  it("문법이 잘못된 정규식도 남긴다 (설정 화면에서 고칠 수 있어야 한다)", () => {
    expect(normalizeTriggers([{ pattern: "(" }], 50)).toHaveLength(1);
  });

  it("상한을 넘으면 앞에서부터 자른다", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ pattern: `p${i}` }));
    expect(normalizeTriggers(many, 3).map((t) => t.pattern)).toEqual(["p0", "p1", "p2"]);
  });

  it("URL·툴팁은 양 끝 공백만 뗀다 (안쪽 공백은 사람이 읽는 문장이다)", () => {
    const [t] = normalizeTriggers(
      [{ pattern: "x", url: " https://a/$1 ", tooltip: "  오류 코드 $1  " }],
      50,
    );
    expect(t.url).toBe("https://a/$1");
    expect(t.tooltip).toBe("오류 코드 $1");
  });
});

describe("같은 값인가 — [저장] 버튼을 켜는 판정", () => {
  it("sameKeybindings 는 키 집합과 값을 모두 본다", () => {
    expect(sameKeybindings({ a: "1" }, { a: "1" })).toBe(true);
    expect(sameKeybindings({ a: "1" }, { a: "2" })).toBe(false);
    expect(sameKeybindings({ a: "1" }, { a: "1", b: "2" })).toBe(false);
  });

  it("sameStringMap 은 '없음' 과 빈 맵을 같게 본다 (동적 팔레트가 그 상태다)", () => {
    expect(sameStringMap(undefined, {})).toBe(true);
    expect(sameStringMap(null, undefined)).toBe(true);
    expect(sameStringMap({ a: "1" }, undefined)).toBe(false);
  });

  it("sameTriggers 는 빈 문자열과 '없음' 을 같게 본다 — 칸만 열었다 닫으면 미저장이 아니다", () => {
    const opened = trg({ pattern: "E", url: "" });
    const never = trg({ pattern: "E" });
    expect(sameTriggers([opened], [never])).toBe(true);
  });

  it("sameTriggers 는 순서까지 본다 (겹칠 때 이기는 쪽이 순서로 정해진다)", () => {
    const a = trg({ pattern: "A" });
    const b = trg({ pattern: "B" });
    expect(sameTriggers([a, b], [b, a])).toBe(false);
    expect(sameTriggers([a], [a, b])).toBe(false);
  });

  it("sameTriggers 는 켬/끔과 색을 본다", () => {
    expect(sameTriggers([trg({ pattern: "E" })], [trg({ pattern: "E", enabled: false })])).toBe(
      false,
    );
    expect(sameTriggers([trg({ pattern: "E", bg: "#111" })], [trg({ pattern: "E" })])).toBe(false);
  });
});

describe("저장용 모양 — 값이 없는 칸은 키 자체를 뺀다", () => {
  it("triggersToPayload 는 빈 칸·빈 패턴을 버리고 공백을 뗀다", () => {
    const out = triggersToPayload([
      trg({ pattern: " ERROR ", fg: "", bg: "#6b4a17", url: "  ", tooltip: " 설명 " }),
      trg({ pattern: "   " }),
    ]);
    expect(out).toEqual([{ pattern: "ERROR", enabled: true, bg: "#6b4a17", tooltip: "설명" }]);
    expect(out[0]).not.toHaveProperty("url");
    expect(out[0]).not.toHaveProperty("fg");
  });

  it("triggersToPayload 는 빈 목록도 그대로 돌려준다 (다 지운 목록이 부활하지 않게)", () => {
    expect(triggersToPayload([])).toEqual([]);
  });

  it("keybindingsToPayload 는 빈 조합을 뺀다", () => {
    expect(keybindingsToPayload({ a: " Ctrl+KeyK ", b: "   " })).toEqual({ a: "Ctrl+KeyK" });
  });
});

describe("cleanStringList — 자동 승인 allowlist 정리", () => {
  it("공백 제거·빈 값 제거·중복 제거하되 순서를 보존한다", () => {
    expect(cleanStringList(["  df  ", "uptime", "df", "", "   ", "ls -la"])).toEqual([
      "df",
      "uptime",
      "ls -la",
    ]);
  });

  it("배열이 아니면 빈 목록", () => {
    expect(cleanStringList(undefined)).toEqual([]);
    expect(cleanStringList("df")).toEqual([]);
    expect(cleanStringList(null)).toEqual([]);
  });

  it("숫자·객체 같은 비문자열 항목은 버린다", () => {
    expect(cleanStringList(["df", 3, { x: 1 }, "uptime"])).toEqual(["df", "uptime"]);
  });
});

describe("sameStringList — 순서까지 본다", () => {
  it("같은 순서·값이면 참", () => {
    expect(sameStringList(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameStringList([], [])).toBe(true);
  });

  it("길이·순서·값이 다르면 거짓", () => {
    expect(sameStringList(["a"], ["a", "b"])).toBe(false);
    expect(sameStringList(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameStringList(["a"], ["b"])).toBe(false);
  });
});

describe("cleanAllowRules (A4b) — 백엔드 sanitize 미러", () => {
  it("exec·서브커맨드 공백을 떼고, exec 빈 규칙·빈 서브커맨드를 버린다", () => {
    expect(
      cleanAllowRules([
        { exec: "  systemctl  ", subcommands: ["is-active", "", "  status  "] },
        { exec: "df" }, // subcommands 생략 = 빈 목록
        { exec: "   ", subcommands: ["x"] }, // exec 빈 규칙은 버려진다
      ]),
    ).toEqual([
      { exec: "systemctl", subcommands: ["is-active", "status"] },
      { exec: "df", subcommands: [] },
    ]);
  });

  it("인자 제약 칸을 버리지 않는다 — 빈 칸은 싣지 않고, 옛 모양은 그대로 왕복한다", () => {
    expect(
      cleanAllowRules([
        {
          exec: "journalctl",
          subcommands: [],
          deny_flags: [" -f ", "", "--vacuum-*"],
          allow_flags: [],
          require_flags: ["--no-pager"],
          first_arg: ["show"],
          max_args: 0,
        },
        { exec: "git", subcommands: ["status"], max_args: -1 },
        { exec: "date", subcommands: [], max_args: 1.5 },
      ]),
    ).toStrictEqual([
      {
        exec: "journalctl",
        subcommands: [],
        deny_flags: ["-f", "--vacuum-*"],
        require_flags: ["--no-pager"],
        first_arg: ["show"],
        max_args: 0,
      },
      { exec: "git", subcommands: ["status"] },
      { exec: "date", subcommands: [] },
    ]);
  });

  it("배열이 아니거나 항목이 이상하면 안전하게 버린다", () => {
    expect(cleanAllowRules(undefined)).toEqual([]);
    expect(cleanAllowRules("df")).toEqual([]);
    expect(cleanAllowRules([null, 3, { subcommands: ["x"] }])).toEqual([]);
  });
});

describe("sameAllowRules — 순서·exec·서브커맨드까지 본다", () => {
  it("같으면 참, 다르면 거짓", () => {
    const a = [{ exec: "systemctl", subcommands: ["status"] }];
    expect(sameAllowRules(a, [{ exec: "systemctl", subcommands: ["status"] }])).toBe(true);
    expect(sameAllowRules(a, [{ exec: "systemctl", subcommands: ["restart"] }])).toBe(false);
    expect(sameAllowRules(a, [{ exec: "df", subcommands: ["status"] }])).toBe(false);
    expect(sameAllowRules(a, [])).toBe(false);
    // 인자 제약도 본다 — 없음과 빈 목록은 같다(둘 다 제약 없음).
    const j = [{ exec: "journalctl", subcommands: [], deny_flags: ["-f"] }];
    expect(sameAllowRules(j, [{ exec: "journalctl", subcommands: [], deny_flags: ["-f"] }])).toBe(true);
    expect(sameAllowRules(j, [{ exec: "journalctl", subcommands: [] }])).toBe(false);
    expect(sameAllowRules([{ exec: "df", subcommands: [] }], [{ exec: "df", subcommands: [], deny_flags: [] }])).toBe(true);
    expect(sameAllowRules([{ exec: "df", subcommands: [], max_args: 0 }], [{ exec: "df", subcommands: [] }])).toBe(false);
  });
});

it("폐기 ID override는 설정 왕복에서 보존되지만 실행 바인딩은 만들지 않는다", () => {
  const old = { "open-layouts": "Alt+F10", "save-layout": "Ctrl+Shift+KeyS" };
  expect(DEPRECATED_ACTION_IDS).toEqual(["open-layouts", "save-layout"]);
  const normalized = normalizeKeybindings(old);
  expect(normalizeKeybindings(keybindingsToPayload(normalized))).toEqual(old);
  const bindings = resolveBindings(normalized);
  expect([...bindings.global.values(), ...bindings.terminal.values()]).not.toContain("open-layouts");
  expect([...bindings.global.values(), ...bindings.terminal.values()]).not.toContain("save-layout");
  expect(ACTIONS.map((action) => action.id)).not.toContain("open-layouts");
});

it("폐기 override와 충돌하는 기본키는 자동 실행하지 않고 명시적 새 override는 적용한다", () => {
  const action = ACTIONS.find((action) => action.id === "switch-workspace")!;
  const old = { "open-layouts": action.def! };
  expect(resolveBindings(old).global.has(action.def!)).toBe(false);
  expect(resolveBindings({ ...old, [action.id]: action.def! }).global.get(action.def!)).toBe(action.id);
});

describe("cleanBundleOff · sameBundleOff — 묶음 안 끈 명령 (백엔드 sanitize 미러)", () => {
  it("공백·빈 값·중복을 정리하고 빈 목록은 칸째 버린다 — 모르는 묶음·키는 남긴다", () => {
    expect(cleanBundleOff({ files: [" cat ", "", "cat", "zzz"], empty: [""], " future ": ["x"], bad: "cat" })).toEqual({
      files: ["cat", "zzz"],
      future: ["x"],
    });
    expect(cleanBundleOff(undefined)).toEqual({});
    expect(cleanBundleOff(["cat"])).toEqual({});
  });

  it("같음 — 묶음 순서는 안 보고 키 목록은 순서까지 본다, 빈 목록은 없는 것과 같다", () => {
    expect(sameBundleOff({ a: ["x"], b: ["y"] }, { b: ["y"], a: ["x"] })).toBe(true);
    expect(sameBundleOff({ a: ["x", "y"] }, { a: ["y", "x"] })).toBe(false);
    expect(sameBundleOff({ a: [] }, {})).toBe(true);
    expect(sameBundleOff({ a: ["x"] }, {})).toBe(false);
  });

  it("규칙의 sub_first 는 정리·비교에서 살아남는다", () => {
    expect(cleanAllowRules([{ exec: "git", subcommands: ["status"], sub_first: true }])).toEqual([
      { exec: "git", subcommands: ["status"], sub_first: true },
    ]);
    expect(cleanAllowRules([{ exec: "git", subcommands: [], sub_first: "yes" }])).toEqual([{ exec: "git", subcommands: [] }]);
  });
});
