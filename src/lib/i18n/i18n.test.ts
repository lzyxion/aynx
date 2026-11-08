import { describe, expect, it } from "vitest";
import { ko } from "$lib/i18n/ko/index";
import { en } from "$lib/i18n/en/index";
import {
  LOCALES,
  mirrorLocale,
  optionEntries,
  resolveLocale,
  translate,
  translateNow,
} from "$lib/i18n/dict";
import { ACTIONS } from "$lib/keybindings";
import type { Key } from "$lib/i18n/keys";

/**
 * 사전 두 벌이 **같은 모양**인지, 규칙 셋(폴백 · 자리 치환 · OS 언어 판정)이 그대로인지.
 *
 * 타입이 이미 한 겹 막고 있지만(`en/settings.ts` 는 `Record<keyof typeof koSettings, string>`),
 * 여기서 한 번 더 보는 것은 **값**이다 — 타입은 영어 칸에 한국어를 적어 둔 것을 잡지 못한다.
 */

/** 네임스페이스 이름 목록 — 단계마다 는다 */
const NAMESPACES = Object.keys(ko) as (keyof typeof ko)[];

/** 한글 음절 한 글자라도 있는가 (영어 사전에 남은 원문을 찾는 그물) */
const HANGUL = /[가-힣]/;

/** `{이름}` 자리 — `{{이름}}`(스니펫 문법)은 세지 않는다 (`dict.ts` 의 치환 규칙과 같다) */
function placeholders(value: string): string[] {
  return [...value.matchAll(/(?<!\{)\{([A-Za-z][A-Za-z0-9_]*)\}(?!\})/g)].map((m) => m[1]).sort();
}

describe("사전", () => {
  it.each(NAMESPACES)("%s — ko 와 en 의 키 집합이 같다", (ns) => {
    expect(Object.keys(en[ns]).sort()).toEqual(Object.keys(ko[ns]).sort());
  });

  it.each(NAMESPACES)("%s — 빈 문구가 없다", (ns) => {
    for (const [key, value] of Object.entries(ko[ns])) expect(value.trim(), `ko ${key}`).not.toBe("");
    for (const [key, value] of Object.entries(en[ns])) expect(value.trim(), `en ${key}`).not.toBe("");
  });

  it.each(NAMESPACES)("%s — 영어 사전에 한글이 남아 있지 않다", (ns) => {
    for (const [key, value] of Object.entries(en[ns])) {
      expect(HANGUL.test(value), `en ${ns}.${key} = ${value}`).toBe(false);
    }
  });

  it.each(NAMESPACES)("%s — 두 언어의 `{자리}` 집합이 같다", (ns) => {
    const koTable = ko[ns] as Record<string, string>;
    const enTable = en[ns] as Record<string, string>;
    for (const key of Object.keys(koTable)) {
      expect(placeholders(enTable[key]), `${ns}.${key}`).toEqual(placeholders(koTable[key]));
    }
  });

  // `KeybindingsSection` 이 id 로 문구를 찾으므로(`settings.keybinding.<id>`), 액션이
  // 하나 늘면 그 자리에서 키가 빈다 — 화면에 키 문자열이 그대로 뜨기 전에 여기서 잡는다.
  // `workspace-1`…`-9` 는 코드가 만들어 내는 아홉 줄이라 번호를 인자로 받는 키 하나를 쓴다.
  it("단축키 액션마다 이름 칸이 있다", () => {
    const keys = new Set(Object.keys(ko.settings));
    for (const action of ACTIONS) {
      const want = /^workspace-[1-9]$/.test(action.id)
        ? "keybinding.workspace"
        : `keybinding.${action.id}`;
      expect(keys.has(want), `${action.id} → settings.${want}`).toBe(true);
    }
  });
});

describe("resolveLocale", () => {
  it("고른 값이 있으면 그대로 쓴다", () => {
    expect(resolveLocale("ko", "en-US")).toBe("ko");
    expect(resolveLocale("en", "ko-KR")).toBe("en");
  });

  it("안 정했으면 OS 를 따른다", () => {
    expect(resolveLocale(null, "ko-KR")).toBe("ko");
    expect(resolveLocale(undefined, "ko")).toBe("ko");
    expect(resolveLocale(null, "KO-kr")).toBe("ko"); // 대소문자 무관
    expect(resolveLocale(null, "en-US")).toBe("en");
    expect(resolveLocale(null, "ja-JP")).toBe("en");
    expect(resolveLocale(null, "")).toBe("en");
  });

  it("모르는 값은 '안 정함' 과 같다 (`[app]` 의 다른 키와 같은 규칙)", () => {
    expect(resolveLocale("sepia", "ko-KR")).toBe("ko");
    expect(resolveLocale("fr", "en-GB")).toBe("en");
  });

  it("후보 목록은 둘뿐이다", () => {
    expect([...LOCALES]).toEqual(["ko", "en"]);
  });
});

describe("translate", () => {
  it("고른 언어의 문구를 낸다", () => {
    expect(translate("ko", "settings.actions.save")).toBe("저장");
    expect(translate("en", "settings.actions.save")).toBe("Save");
  });

  it("모르는 키는 키 그대로 (화면에서 보이라고)", () => {
    expect(translate("en", "settings.nope" as Key)).toBe("settings.nope");
    expect(translate("en", "nodot" as Key)).toBe("nodot");
  });

  it("`{자리}` 를 채운다", () => {
    expect(translate("en", "settings.row.note", { label: "Bell" })).toBe("About Bell");
    expect(translate("ko", "settings.row.note", { label: "벨" })).toBe("벨 설명 자세히");
  });

  it("빠진 인자는 `{이름}` 글자 그대로 남는다", () => {
    expect(translate("en", "settings.row.note", {})).toBe("About {label}");
  });

  it("`{{이름}}`(스니펫 자리표시자)은 건드리지 않는다", () => {
    // 치환 규칙 자체를 본다 — 사전에 그런 문구가 있는지와 무관하게 고정해 둔다.
    const sample = "run {{name}} now, {who}";
    const replaced = sample.replace(
      /(?<!\{)\{([A-Za-z][A-Za-z0-9_]*)\}(?!\})/g,
      (whole, n: string) => (n === "who" ? "me" : whole),
    );
    expect(replaced).toBe("run {{name}} now, me");
  });
});

describe("optionEntries", () => {
  it("표를 `{#each}` 가 도는 쌍 목록으로 만든다 (순서 그대로)", () => {
    const table = {
      dark: "settings.option.mode.dark",
      light: "settings.option.mode.light",
    } as const satisfies Record<string, Key>;
    expect(optionEntries(table)).toEqual([
      ["dark", "settings.option.mode.dark"],
      ["light", "settings.option.mode.light"],
    ]);
  });
});

describe("translateNow — 룬을 못 쓰는 순수 모듈의 창구", () => {
  it("거울을 민 언어로 문구를 만든다 (`setLocale` 이 미는 그 값이다)", () => {
    mirrorLocale("en");
    expect(translateNow("files.ops.session.gone")).toBe(
      "Could not find the session — the terminal is not connected",
    );
    mirrorLocale("ko");
    expect(translateNow("files.ops.session.gone")).toBe(
      "세션을 찾을 수 없습니다 — 터미널이 연결되어 있지 않습니다",
    );
  });

  it("기본값은 한국어다 — 아무도 밀지 않았을 때 (부팅 첫 프레임)", () => {
    mirrorLocale("ko");
    expect(translateNow("settings.actions.save")).toBe("저장");
  });
});
