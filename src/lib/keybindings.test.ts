import { describe, expect, it } from "vitest";
import { translate } from "$lib/i18n/dict";
import {
  ACTIONS,
  actionLabel,
  actionsByScope,
  bypassesEditGuard,
  comboFromEvent,
  conflicts,
  conflictsWith,
  sharesKeys,
  displayCombo,
  effectiveCombo,
  isBrowserChromeCombo,
  isControlOwnedKey,
  isEditableTarget,
  isTerminalKeysInput,
  isOverridden,
  resolveBindings,
  shouldBlockNativeContextMenu,
  appKeepsInEditor,
  editorOwnsKey,
  isInDocEditor,
  tabIndexOf,
  type ActionDef,
  type ActionScope,
  type Overrides,
} from "$lib/keybindings";

/** `comboFromEvent` 가 보는 만큼만 흉내 낸 키 이벤트 */
function ev(
  code: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
): { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; code: string } {
  return {
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    code,
  };
}

/**
 * **기본 조합 없이** 등록한 액션 — 겹칠 걱정 없는 키를 고를 수 없어 사용자가 설정에서 정한다(`keybindings.ts` 의
 * `open-plans` 주석). 기본 조합의 모양을 훑는 검사들은 이것들을 빼고 본다.
 */
const UNBOUND_BY_DEFAULT: readonly string[] = ["open-plans"];

/** 기본 조합이 있는 액션 */
const BOUND = ACTIONS.filter((a) => !UNBOUND_BY_DEFAULT.includes(a.id));

/** 그 층에서 기본 조합이 있는 액션 수 */
const boundIn = (scope: ActionScope) => actionsByScope(scope).filter((a) => !UNBOUND_BY_DEFAULT.includes(a.id)).length;

// ---------------------------------------------------------------------------
// 이 파일의 가장 중요한 회귀 테스트 — 기본 키맵 전체를 훑어 같은 조합이 두 액션에
// 걸리지 않았는지 본다. 액션을 한 줄 더 적을 때마다 사람이 눈으로 40여 줄을 대조하는
// 대신 여기서 걸린다.
// ---------------------------------------------------------------------------
describe("기본 키맵 — 충돌 0건", () => {
  it("오버라이드가 하나도 없을 때 충돌이 없다", () => {
    expect(conflicts()).toEqual([]);
    expect(conflicts({})).toEqual([]);
  });

  it("같은 층 안에서 기본 조합이 하나도 겹치지 않는다 (조합별로 훑어 확인)", () => {
    // 파일 층은 전역과 한 창 keydown 을 나눠 쓰므로(`sharesKeys`) 둘을 한 이름공간으로 훑는다
    for (const scopes of [["terminal"], ["global", "files"]] as const) {
      const scope = scopes.join("+");
      const seen = new Map<string, string>();
      for (const action of scopes.flatMap((s) => actionsByScope(s))) {
        const prev = seen.get(action.def);
        expect(
          prev,
          `${scope} 층에서 "${action.def}" 가 ${prev} 와 ${action.id} 에 겹쳐 있다`,
        ).toBeUndefined();
        seen.set(action.def, action.id);
      }
    }
  });

  it("액션 id 가 중복되지 않는다 (settings.toml 의 키다)", () => {
    const ids = ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 액션에 비어 있지 않은 기본 조합이 있다 (기본 조합 없이 등록한 것만 빼고)", () => {
    for (const action of ACTIONS) {
      if (UNBOUND_BY_DEFAULT.includes(action.id)) continue;
      expect(action.def.trim(), action.id).not.toBe("");
    }
  });

  it("기본 조합 없이 등록한 액션은 어느 층에도 걸리지 않는다 (사용자가 설정에서 정한다)", () => {
    for (const id of UNBOUND_BY_DEFAULT) {
      expect(ACTIONS.find((a) => a.id === id)?.def, id).toBe("");
      expect(effectiveCombo(id, {}), id).toBe("");
      const resolved = resolveBindings({});
      expect(resolved.effective[id], id).toBeUndefined();
    }
    // 사용자가 정하면 그 조합으로 걸린다
    expect(resolveBindings({ "open-plans": "Ctrl+Shift+F9" }).global.get("Ctrl+Shift+F9")).toBe("open-plans");
  });

  /**
   * 액션 **이름**은 이 파일에 없다 — id 로 설정 사전을 찾는다 (`actionLabel` ·
   * docs/log/2026-09-17-i18n.md). 여기서는 그 키가 실제로 문구를 내는지만 본다:
   * 사전에 칸이 없으면 `translate` 가 **키 자체**를 돌려주므로 그 자리에서 드러난다.
   * (액션이 하나 늘었는데 사전이 안 따라온 경우는 `i18n.test.ts` 도 잡는다.)
   */
  it("모든 액션의 이름이 사전에서 나온다 (두 언어 다)", () => {
    for (const action of ACTIONS) {
      const name = actionLabel(action.id);
      for (const locale of ["ko", "en"] as const) {
        const shown = translate(locale, name.key, name.params);
        expect(shown.trim(), `${locale} ${action.id}`).not.toBe("");
        expect(shown, `${locale} ${action.id}`).not.toBe(name.key);
      }
    }
  });

  it("`workspace-1`…`-9` 는 번호를 인자로 받는 키 하나를 나눠 쓴다", () => {
    expect(actionLabel("workspace-3")).toEqual({
      key: "settings.keybinding.workspace",
      params: { n: "3" },
    });
    expect(actionLabel("find")).toEqual({ key: "settings.keybinding.find" });
  });

  it("기본 조합의 수식 순서가 전부 `Ctrl → Alt → Shift` 로 정규화돼 있다", () => {
    const MODS = ["Ctrl", "Alt", "Shift"];
    for (const action of BOUND) {
      const parts = action.def.split("+");
      const mods = parts.filter((p) => MODS.includes(p));
      const keys = parts.filter((p) => !MODS.includes(p));
      // 수식 키는 앞에, 본 키는 딱 하나 뒤에
      expect(keys, action.id).toHaveLength(1);
      expect(parts.slice(0, mods.length), action.id).toEqual(mods);
      expect(mods, action.id).toEqual(MODS.filter((m) => mods.includes(m)));
    }
  });

  it("기본 조합에 Meta(⊞/⌘)를 쓰는 액션이 없다 (v1 에서 무시하는 수식 키)", () => {
    for (const action of ACTIONS) {
      expect(action.def, action.id).not.toContain("Meta");
    }
  });

  it("기본 조합은 전부 comboFromEvent 가 만들어 낼 수 있는 모양이다 (왕복)", () => {
    for (const action of BOUND) {
      const parts = action.def.split("+");
      const code = parts[parts.length - 1];
      const made = comboFromEvent(
        ev(code, {
          ctrl: parts.includes("Ctrl"),
          alt: parts.includes("Alt"),
          shift: parts.includes("Shift"),
        }),
      );
      expect(made, action.id).toBe(action.def);
    }
  });

  it("`Ctrl+Alt+화살표` 는 타일 크기 조절 넷만 · `Ctrl+Shift+←/→` 는 앱이 묶지 않는다(낱말 고르기 — 2026-11-02 사용자 결정)", () => {
    const ctrlAlt = ACTIONS.filter((a) => /^Ctrl\+Alt\+Arrow/.test(a.def)).map((a) => a.id);
    expect(ctrlAlt.sort()).toEqual(["expand-down", "expand-left", "expand-right", "expand-up"]);
    for (const action of ACTIONS) {
      expect(action.def, action.id).not.toMatch(/^Ctrl\+Shift\+Arrow(Left|Right)$/);
    }
  });
});

describe("레지스트리 모양", () => {
  it("scope 는 terminal · global · files 뿐이다", () => {
    const scopes: ActionScope[] = ["terminal", "global", "files"];
    for (const action of ACTIONS) expect(scopes).toContain(action.scope);
  });

  it("actionsByScope 가 레지스트리를 빠짐없이 셋으로 가른다", () => {
    const terminal = actionsByScope("terminal");
    const global = actionsByScope("global");
    const files = actionsByScope("files");
    expect(terminal.length + global.length + files.length).toBe(ACTIONS.length);
    expect(terminal.every((a) => a.scope === "terminal")).toBe(true);
    expect(global.every((a) => a.scope === "global")).toBe(true);
    expect(files.every((a) => a.scope === "files")).toBe(true);
  });

  it("파일 층과 전역 층은 한 이름공간이다 — 겹치면 충돌로 적힌다", () => {
    expect(sharesKeys("files", "global")).toBe(true);
    expect(sharesKeys("files", "terminal")).toBe(false);
    const overrides: Overrides = { "files-location": "Ctrl+Shift+KeyT" };
    expect(conflicts(overrides)).toContainEqual({
      scope: "files",
      combo: "Ctrl+Shift+KeyT",
      ids: ["new-tab", "files-location"],
    });
    expect(conflictsWith("files-location", overrides)).toEqual(["new-tab"]);
    expect(conflictsWith("new-tab", overrides)).toEqual(["files-location"]);
  });

  it("탭 직접 전환은 1…9 아홉 줄이고 `Alt+DigitN` 이다", () => {
    for (let i = 1; i <= 9; i++) {
      const found: ActionDef | undefined = ACTIONS.find((a) => a.id === `workspace-${i}`);
      expect(found, `workspace-${i}`).toBeDefined();
      expect(found?.def).toBe(`Alt+Digit${i}`);
      expect(found?.scope).toBe("global");
    }
    expect(ACTIONS.some((a) => a.id === "workspace-0")).toBe(false);
    expect(ACTIONS.some((a) => a.id === "workspace-10")).toBe(false);
  });

  it("찾기 둘의 기본 조합은 `Ctrl+F` · `Ctrl+Shift+F` 다 (터미널 앱의 관례)", () => {
    const find = ACTIONS.find((a) => a.id === "find");
    expect(find, "find").toBeDefined();
    expect(find?.def).toBe("Ctrl+KeyF");
    expect(find?.scope).toBe("global");

    const all = ACTIONS.find((a) => a.id === "find-all");
    expect(all, "find-all").toBeDefined();
    expect(all?.def).toBe("Ctrl+Shift+KeyF");
    expect(all?.scope).toBe("global");
  });

  it("`open-sftp` 는 `Ctrl+Shift+O` 로 비켰고 id 는 그대로다 (라벨만 로컬 셸까지 아우른다)", () => {
    // `Ctrl+Shift+F` 를 `find-all` 에 넘겨준 이사다. id 는 `settings.toml` 의 키라 바꾸면
    // 저장해 둔 오버라이드가 조용히 날아간다. 라벨은 설정 화면·치트시트가 같이 쓰는 문구라
    // **로컬 셸의 "현재 폴더 열기" 까지 담아야 한다** (같은 키가 두 종류의 타일에서 산다 —
    // docs/log/2026-09-08-local-cwd-folder.md).
    const sftp = ACTIONS.find((a) => a.id === "open-sftp");
    expect(sftp, "open-sftp").toBeDefined();
    expect(sftp?.def).toBe("Ctrl+Shift+KeyO");
    expect(translate("ko", actionLabel("open-sftp").key)).toBe(
      "파일 열기 (원격 SFTP · 로컬 현재 폴더)",
    );
    expect(sftp?.scope).toBe("global");
  });

  it("이미 저장해 둔 `open-sftp` 오버라이드는 이사와 무관하게 그대로 이긴다", () => {
    expect(effectiveCombo("open-sftp", { "open-sftp": "Ctrl+Shift+KeyF" })).toBe("Ctrl+Shift+KeyF");
  });

  it("세션 목록(`open-console`)은 `Ctrl+Shift+M` 이고 다른 액션과 겹치지 않는다", () => {
    // 관리뷰 → 대시보드 → 세션 시트(2026-10-07). id 는 그대로, 라벨만 바뀌었다.
    const console_ = ACTIONS.find((a) => a.id === "open-console");
    expect(console_, "open-console").toBeDefined();
    expect(console_?.def).toBe("Ctrl+Shift+KeyM");
    expect(console_?.scope).toBe("global");
    expect(translate("ko", actionLabel("open-console").key)).toBe("세션 목록");
    // KeyM 을 쓰는 다른 기본값이 없어야 한다 (전역 `conflicts()` 가 잡지만 여기서 못 박는다).
    const usingM = ACTIONS.filter((a) => a.def.endsWith("KeyM")).map((a) => a.id);
    expect(usingM).toEqual(["open-console"]);
  });

  it("세션 시트 · 작업안 토글은 `bypassesEditGuard` 를 지나간다 (같은 키로 닫혀야 한다)", () => {
    expect(bypassesEditGuard("open-console")).toBe(true);
    expect(bypassesEditGuard("open-plans")).toBe(true);
  });

  it("AI 타일 넘기기는 대화 면 입력 칸에서도 지나간다 (같은 키로 터미널 면에 돌아와야 한다)", () => {
    expect(bypassesEditGuard("flip-convo")).toBe(true);
  });

  it("폐기된 layout 액션은 레지스트리와 편집 가드에 없고 기본 조합은 삼킨다", () => {
    for (const id of ["open-layouts", "save-layout"]) {
      expect(ACTIONS.some((a) => a.id === id)).toBe(false);
      expect(bypassesEditGuard(id)).toBe(false);
    }
    // 레이아웃 독의 `Ctrl+Shift+K` 는 2026-10-21 DB 독(`open-db-dock`)이 다시 쓴다 — 삼키는 목록에서 빠졌다(아래 시험).
    expect(isBrowserChromeCombo("Ctrl+Shift+KeyS")).toBe(true);
  });

  it("프로젝트 독(`open-projects-dock`)은 `Ctrl+Shift+J` 이고 어느 자리와도 겹치지 않는다", () => {
    // docs/log/2026-09-24-projects.md — 호스트 독 안의 가짜 폴더에서 자기 독으로 나왔다.
    const projects = ACTIONS.find((a) => a.id === "open-projects-dock");
    expect(projects, "open-projects-dock").toBeDefined();
    expect(projects?.def).toBe("Ctrl+Shift+KeyJ");
    expect(projects?.scope).toBe("global");
    expect(translate("ko", actionLabel("open-projects-dock").key)).toBe("독: 프로젝트");
    // KeyJ 를 쓰는 다른 기본값이 없고, 웹뷰가 가로채 막는 조합(`BROWSER_CHROME_COMBOS`)도 아니다.
    expect(ACTIONS.filter((a) => a.def.endsWith("KeyJ")).map((a) => a.id)).toEqual(["open-projects-dock"]);
    expect(isBrowserChromeCombo("Ctrl+Shift+KeyJ")).toBe(false);
    // 토글이라 입력칸(검색 칸) 안에서도 같은 키로 닫힌다.
    expect(bypassesEditGuard("open-projects-dock")).toBe(true);
  });

  it("DB 독(`open-db-dock`)은 `Ctrl+Shift+K` 이고 그 조합의 유일한 액션이다 (2026-10-21)", () => {
    const db = ACTIONS.find((a) => a.id === "open-db-dock");
    expect(db, "open-db-dock").toBeDefined();
    expect(db?.def).toBe("Ctrl+Shift+KeyK");
    expect(db?.scope).toBe("global");
    expect(translate("ko", actionLabel("open-db-dock").key)).toBe("독: DB");
    expect(translate("en", actionLabel("open-db-dock").key)).toBe("Dock: DB");
    expect(ACTIONS.filter((a) => a.def === "Ctrl+Shift+KeyK").map((a) => a.id)).toEqual(["open-db-dock"]);
    expect(resolveBindings().global.get("Ctrl+Shift+KeyK")).toBe("open-db-dock");
    // 폐기된 레이아웃 독 시절 삼키던 조합 — 이제 앱 액션이 잡으므로 막는 목록에 없다.
    expect(isBrowserChromeCombo("Ctrl+Shift+KeyK")).toBe(false);
    // 토글이라 입력칸(검색 칸) 안에서도 같은 키로 닫힌다.
    expect(bypassesEditGuard("open-db-dock")).toBe(true);
  });

  it("채팅 독(`open-chat-dock`)은 `Ctrl+Shift+'` 이고 그 조합의 유일한 액션이다 (2026-10-23)", () => {
    const chat = ACTIONS.find((a) => a.id === "open-chat-dock");
    expect(chat, "open-chat-dock").toBeDefined();
    expect(chat?.def).toBe("Ctrl+Shift+Quote");
    expect(chat?.scope).toBe("global");
    expect(translate("ko", actionLabel("open-chat-dock").key)).toBe("채팅 독");
    expect(translate("en", actionLabel("open-chat-dock").key)).toBe("Chat dock");
    expect(ACTIONS.filter((a) => a.def.endsWith("Quote")).map((a) => a.id)).toEqual(["open-chat-dock"]);
    expect(resolveBindings().global.get("Ctrl+Shift+Quote")).toBe("open-chat-dock");
    // 목업의 자리 표시 `Ctrl+Shift+L` 은 로컬 파일의 것이다 — 빼앗지 않았다
    expect(resolveBindings().global.get("Ctrl+Shift+KeyL")).toBe("open-localfs");
    expect(isBrowserChromeCombo("Ctrl+Shift+Quote")).toBe(false);
    expect(displayCombo(chat?.def)).toBe("Ctrl+Shift+'");
    // 토글이라 입력칸(다음 단계의 대화 입력) 안에서도 같은 키로 닫힌다.
    expect(bypassesEditGuard("open-chat-dock")).toBe(true);
  });

  it("독 칸 id 는 `open-*-dock` 하나로 통일했다 — 옛 `open-hosts` · `open-projects` 는 없다 (2026-10-21 사용자 승인 예외)", () => {
    for (const id of ["open-hosts", "open-projects"]) expect(ACTIONS.some((a) => a.id === id), id).toBe(false);
    expect(ACTIONS.find((a) => a.id === "open-hosts-dock")?.def).toBe("Ctrl+Shift+KeyH");
  });

  it("테마 프로필 전환(`switch-profile`)은 `Ctrl+Shift+U` 이고 어느 자리와도 겹치지 않는다", () => {
    // docs/log/2026-09-28-profile-switcher.md — 위에서 내려오는 카드 줄.
    const sw = ACTIONS.find((a) => a.id === "switch-profile");
    expect(sw, "switch-profile").toBeDefined();
    expect(sw?.def).toBe("Ctrl+Shift+KeyU");
    expect(sw?.scope).toBe("global");
    expect(translate("ko", actionLabel("switch-profile").key)).toBe("테마 프로필 전환");
    expect(translate("en", actionLabel("switch-profile").key)).toBe("Switch theme profile");
    expect(ACTIONS.filter((a) => a.def.endsWith("KeyU")).map((a) => a.id)).toEqual(["switch-profile"]);
    // `Ctrl+U`(소스 보기)는 막는 목록에 있지만 Shift 가 붙은 이 조합은 아니다.
    expect(isBrowserChromeCombo("Ctrl+Shift+KeyU")).toBe(false);
    expect(resolveBindings().global.get("Ctrl+Shift+KeyU")).toBe("switch-profile");
    expect(bypassesEditGuard("switch-profile")).toBe(true);
    expect(displayCombo(sw?.def)).toBe("Ctrl+Shift+U");
  });

  it("설정 파일 키로 못 박은 옛 id 들이 그대로 남아 있다 (바꾸면 남의 오버라이드가 날아간다)", () => {
    // 라벨은 "탭"·"호스트"·"Claude Code" 로 바뀌었지만 id 는 옛 이름 그대로다.
    // (`open-hosts` 는 2026-10-21 사용자 승인으로 `open-hosts-dock` 이 됐다 — 바로 위 시험.)
    for (const id of ["new-tab", "close-tab", "next-tab", "prev-tab", "ai-panel"]) {
      expect(ACTIONS.some((a) => a.id === id), id).toBe(true);
    }
  });
});

describe("effectiveCombo — 오버라이드가 기본을 이긴다", () => {
  it("오버라이드가 없으면 기본값", () => {
    expect(effectiveCombo("jump-prev", {})).toBe("Ctrl+ArrowUp");
    expect(effectiveCombo("open-settings", {})).toBe("Ctrl+Comma");
    expect(effectiveCombo("quit-app", {})).toBe("Ctrl+Shift+F4");
  });

  it("오버라이드가 있으면 그쪽", () => {
    expect(effectiveCombo("jump-prev", { "jump-prev": "Ctrl+KeyK" })).toBe("Ctrl+KeyK");
  });

  it("빈 문자열·공백뿐인 오버라이드는 기본값으로 되돌아간다", () => {
    expect(effectiveCombo("jump-prev", { "jump-prev": "" })).toBe("Ctrl+ArrowUp");
    expect(effectiveCombo("jump-prev", { "jump-prev": "   " })).toBe("Ctrl+ArrowUp");
  });

  it("다른 액션의 오버라이드는 이 액션에 영향을 주지 않는다", () => {
    expect(effectiveCombo("jump-next", { "jump-prev": "Ctrl+KeyK" })).toBe("Ctrl+ArrowDown");
  });

  it("모르는 id 는 null (옛 설정 파일에 남은 죽은 키)", () => {
    expect(effectiveCombo("does-not-exist", {})).toBeNull();
    expect(effectiveCombo("does-not-exist", { "does-not-exist": "Ctrl+KeyK" })).toBeNull();
  });

  it("모든 액션이 오버라이드 없이도 조합을 돌려준다", () => {
    for (const action of ACTIONS) expect(effectiveCombo(action.id, {}), action.id).toBe(action.def);
  });
});

describe("isOverridden — 설정 화면의 ↺ 활성 판정", () => {
  it("기본값과 같은 값을 적어 둔 것은 오버라이드가 아니다", () => {
    expect(isOverridden("jump-prev", { "jump-prev": "Ctrl+ArrowUp" })).toBe(false);
  });

  it("다른 값이면 오버라이드다", () => {
    expect(isOverridden("jump-prev", { "jump-prev": "Ctrl+KeyK" })).toBe(true);
  });

  it("없음·빈 값은 오버라이드가 아니다", () => {
    expect(isOverridden("jump-prev", {})).toBe(false);
    expect(isOverridden("jump-prev", { "jump-prev": "  " })).toBe(false);
  });

  it("모르는 id 는 거짓", () => {
    expect(isOverridden("does-not-exist", { "does-not-exist": "Ctrl+KeyK" })).toBe(false);
  });
});

describe("comboFromEvent — 키 이벤트 → 조합 문자열", () => {
  it("수식 없는 키는 code 하나", () => {
    expect(comboFromEvent(ev("KeyA"))).toBe("KeyA");
  });

  it("수식 순서는 언제나 Ctrl → Alt → Shift", () => {
    expect(comboFromEvent(ev("KeyC", { shift: true, ctrl: true }))).toBe("Ctrl+Shift+KeyC");
    expect(comboFromEvent(ev("ArrowLeft", { shift: true, alt: true }))).toBe("Alt+Shift+ArrowLeft");
    expect(comboFromEvent(ev("KeyX", { shift: true, alt: true, ctrl: true }))).toBe(
      "Ctrl+Alt+Shift+KeyX",
    );
  });

  it("수식 키만 눌렸으면 null (기록이 홀로 눌린 수식 키를 무시한다)", () => {
    for (const code of [
      "ControlLeft",
      "ControlRight",
      "ShiftLeft",
      "ShiftRight",
      "AltLeft",
      "AltRight",
      "MetaLeft",
      "MetaRight",
    ]) {
      expect(comboFromEvent(ev(code, { ctrl: true, shift: true })), code).toBeNull();
    }
  });

  it("code 가 비어 있으면 null (IME 등으로 물리 키를 못 읽은 경우)", () => {
    expect(comboFromEvent(ev(""))).toBeNull();
    expect(comboFromEvent(ev("", { ctrl: true }))).toBeNull();
  });

  it("`ev.key` 가 아니라 `ev.code` 를 본다 — IME 가 켜져도 같은 조합이 나온다", () => {
    // 한국어 IME 는 `key` 를 `"Process"` 로 뭉개지만 `code` 는 물리 키를 그대로 담는다.
    // 이 함수는 애초에 `key` 를 받지 않으므로 IME 상태와 무관하게 같은 값이 나온다.
    expect(comboFromEvent({ ctrlKey: true, altKey: false, shiftKey: true, code: "KeyC" })).toBe(
      "Ctrl+Shift+KeyC",
    );
  });
});

describe("displayCombo — 사람이 읽는 표기", () => {
  // 안 걸린 칸을 뭐라고 부를지는 **화면의 몫**이다 (설정 화면은 `settings.keys.unbound` 를
  // 쓴다 — `settings/combo.ts`). 순수 모듈은 글자를 짓지 않는다.
  it("빈 값은 빈 문자열이다", () => {
    expect(displayCombo(null)).toBe("");
    expect(displayCombo(undefined)).toBe("");
    expect(displayCombo("")).toBe("");
  });

  it("글자 키는 접두사를 뗀다", () => {
    expect(displayCombo("Ctrl+Shift+KeyC")).toBe("Ctrl+Shift+C");
    expect(displayCombo("Alt+Digit1")).toBe("Alt+1");
  });

  it("화살표는 기호로", () => {
    expect(displayCombo("Ctrl+ArrowUp")).toBe("Ctrl+↑");
    expect(displayCombo("Ctrl+ArrowDown")).toBe("Ctrl+↓");
    expect(displayCombo("Alt+ArrowLeft")).toBe("Alt+←");
    expect(displayCombo("Alt+Shift+ArrowRight")).toBe("Alt+Shift+→");
  });

  it("기호·이름 키는 표에서 (`Comma`→`,`, `Escape`→`Esc`, `Slash`→`/`)", () => {
    expect(displayCombo("Ctrl+Comma")).toBe("Ctrl+,");
    expect(displayCombo("Escape")).toBe("Esc");
    expect(displayCombo("Ctrl+Shift+Slash")).toBe("Ctrl+Shift+/");
    expect(displayCombo("Backspace")).toBe("⌫");
    expect(displayCombo("PageUp")).toBe("PgUp");
  });

  it("수식 키 이름과 순서는 조합 문자열 그대로 유지된다", () => {
    expect(displayCombo("Ctrl+Alt+Shift+KeyX")).toBe("Ctrl+Alt+Shift+X");
    expect(displayCombo("Ctrl+Shift+Tab")).toBe("Ctrl+Shift+Tab");
  });

  it("F 키·넘패드·모르는 code 는 손대지 않거나 표기만 붙인다", () => {
    expect(displayCombo("F5")).toBe("F5");
    expect(displayCombo("Ctrl+F12")).toBe("Ctrl+F12");
    expect(displayCombo("Numpad1")).toBe("Num 1");
    expect(displayCombo("MediaPlayPause")).toBe("MediaPlayPause");
  });

  it("`Key`·`Digit` 접두사 규칙은 길이가 맞을 때만 적용된다", () => {
    expect(displayCombo("Keyboard")).toBe("Keyboard"); // KeyX 4글자가 아니다
    expect(displayCombo("Digit12")).toBe("Digit12"); // Digit1 6글자가 아니다
  });

  it("기본 키맵 전체가 사람이 읽을 표기로 바뀐다 — 남는 code 접두사가 없다", () => {
    for (const action of ACTIONS) {
      const shown = displayCombo(action.def);
      expect(shown, action.id).not.toContain("Key");
      expect(shown, action.id).not.toContain("Digit");
      expect(shown, action.id).not.toContain("Arrow");
      expect(shown, action.id).not.toBe("(없음)");
    }
  });
});

describe("resolveBindings — 층별 조합 → 액션 id 맵", () => {
  it("층이 갈려 있고, effective 가 모든 액션을 담는다", () => {
    const { terminal, global, effective } = resolveBindings();
    expect(terminal.get("Ctrl+ArrowUp")).toBe("jump-prev");
    expect(terminal.get("Ctrl+Shift+KeyT")).toBeUndefined(); // 전역 액션이다
    expect(global.get("Ctrl+Shift+KeyT")).toBe("new-tab");
    expect(global.get("Ctrl+Comma")).toBe("open-settings");
    expect(global.get("Ctrl+Shift+F4")).toBe("quit-app"); // 끝내기 모달(2026-10-29)
    // 기본 조합 없이 등록한 액션(`UNBOUND_BY_DEFAULT`)은 걸린 조합이 없어 담기지 않는다
    expect(Object.keys(effective)).toHaveLength(BOUND.length);
  });

  it("충돌이 없으므로 기본 키맵의 세 맵 크기가 액션 수와 정확히 같다", () => {
    const { terminal, global, files } = resolveBindings();
    expect(terminal.size).toBe(actionsByScope("terminal").length);
    expect(global.size).toBe(boundIn("global"));
    expect(files.size).toBe(boundIn("files"));
    expect(files.get("Ctrl+KeyL")).toBe("files-location");
    // 미리 보기 패널의 F11 — 전역 · 터미널 어디에도 묶여 있지 않다
    expect(files.get("F11")).toBe("files-preview");
    expect(global.has("F11") || resolveBindings().terminal.has("F11")).toBe(false);
    expect(global.get("Ctrl+KeyL")).toBeUndefined();
  });

  it("오버라이드는 옛 조합을 비우고 새 조합에 앉는다", () => {
    const overrides: Overrides = { "jump-prev": "Ctrl+KeyK" };
    const { terminal, effective } = resolveBindings(overrides);
    expect(terminal.get("Ctrl+KeyK")).toBe("jump-prev");
    expect(terminal.get("Ctrl+ArrowUp")).toBeUndefined();
    expect(effective["jump-prev"]).toBe("Ctrl+KeyK");
  });

  it("모르는 id 의 오버라이드는 조용히 무시된다 (옛 설정 파일)", () => {
    const { global, effective } = resolveBindings({ "does-not-exist": "Ctrl+KeyK" });
    expect(global.get("Ctrl+KeyK")).toBeUndefined();
    expect(effective["does-not-exist"]).toBeUndefined();
  });

  it("같은 층에서 겹치면 **나중 것이 남는다** (last-wins)", () => {
    // ACTIONS 순서상 new-tab 이 close-tab 보다 앞이라 나중 것(close-tab)이 이긴다.
    const { global } = resolveBindings({ "new-tab": "Ctrl+Shift+KeyW" });
    expect(global.get("Ctrl+Shift+KeyW")).toBe("close-tab");
    expect(global.size).toBe(boundIn("global") - 1);
  });

  it("입력 오버라이드를 건드리지 않는다 (순수 함수)", () => {
    const overrides: Overrides = { "jump-prev": "Ctrl+KeyK" };
    resolveBindings(overrides);
    expect(overrides).toEqual({ "jump-prev": "Ctrl+KeyK" });
  });
});

describe("conflicts / conflictsWith — 경고만 하고 막지는 않는다", () => {
  it("같은 층에서 겹치면 그 조합과 액션 둘을 들어 준다", () => {
    const found = conflicts({ "new-tab": "Ctrl+Shift+KeyW" });
    expect(found).toHaveLength(1);
    expect(found[0].scope).toBe("global");
    expect(found[0].combo).toBe("Ctrl+Shift+KeyW");
    expect(found[0].ids.sort()).toEqual(["close-tab", "new-tab"]);
  });

  it("셋이 겹치면 셋 다 들어 준다", () => {
    const found = conflicts({ "new-tab": "Ctrl+Shift+KeyW", "new-shell": "Ctrl+Shift+KeyW" });
    expect(found).toHaveLength(1);
    expect(found[0].ids.sort()).toEqual(["close-tab", "new-shell", "new-tab"]);
  });

  it("층이 다르면 충돌이 아니다 (터미널 맵과 전역 맵은 진입점이 다르다)", () => {
    // 터미널 액션을 전역 기본값(`Ctrl+Comma` = 설정 열기)과 같게 만들어도 충돌이 아니다.
    expect(conflicts({ "jump-prev": "Ctrl+Comma" })).toEqual([]);
  });

  it("터미널 층 안에서 겹치면 잡아낸다", () => {
    const found = conflicts({ "jump-prev": "Ctrl+ArrowDown" });
    expect(found).toHaveLength(1);
    expect(found[0].scope).toBe("terminal");
    expect(found[0].ids.sort()).toEqual(["jump-next", "jump-prev"]);
  });

  it("conflictsWith 는 자기 자신을 빼고 같은 층의 겹친 액션만 돌려준다", () => {
    const overrides: Overrides = { "new-tab": "Ctrl+Shift+KeyW" };
    expect(conflictsWith("new-tab", overrides)).toEqual(["close-tab"]);
    expect(conflictsWith("close-tab", overrides)).toEqual(["new-tab"]);
  });

  it("겹치지 않으면 빈 배열, 모르는 id 도 빈 배열", () => {
    expect(conflictsWith("new-tab")).toEqual([]);
    expect(conflictsWith("new-tab", {})).toEqual([]);
    expect(conflictsWith("does-not-exist", { "new-tab": "Ctrl+Shift+KeyW" })).toEqual([]);
  });

  it("기본 키맵에서는 어느 액션도 겹치는 짝이 없다", () => {
    for (const action of ACTIONS) {
      expect(conflictsWith(action.id, {}), action.id).toEqual([]);
    }
  });
});

describe("tabIndexOf — `workspace-<1..9>` 에서 번호 읽기", () => {
  it("아홉 줄 전부 자기 번호를 돌려준다", () => {
    for (let n = 1; n <= 9; n++) {
      expect(tabIndexOf(`workspace-${n}`)).toBe(n);
    }
  });

  it("레지스트리가 만들어 내는 id 와 **같은 형식**이다", () => {
    // 만드는 쪽(`goToTabActions`)과 읽는 쪽이 어긋나면 키가 조용히 죽는다.
    const made = ACTIONS.filter((a) => a.id.startsWith("workspace-"));
    expect(made).toHaveLength(9);
    for (const a of made) expect(tabIndexOf(a.id)).not.toBeNull();
  });

  it("0·10·접두사만 같은 것은 null", () => {
    expect(tabIndexOf("workspace-0")).toBeNull();
    expect(tabIndexOf("workspace-10")).toBeNull();
    expect(tabIndexOf("workspace-")).toBeNull();
    expect(tabIndexOf("workspaces-1")).toBeNull();
    expect(tabIndexOf("new-tab")).toBeNull();
  });
});

describe("bypassesEditGuard — 입력칸 안에서도 통하는 액션", () => {
  it("방향 이동·이동·확장은 전부 지나간다 (글자 키가 아니다)", () => {
    for (const dir of ["left", "right", "up", "down"]) {
      expect(bypassesEditGuard(`focus-${dir}`)).toBe(true);
      expect(bypassesEditGuard(`move-${dir}`)).toBe(true);
      expect(bypassesEditGuard(`expand-${dir}`)).toBe(true);
    }
  });

  it("나가는 문 둘도 지나간다 — 못 닫으면 키보드만으로 빠져나올 길이 없다", () => {
    expect(bypassesEditGuard("close-tile")).toBe(true);
    expect(bypassesEditGuard("zoom-tile")).toBe(true);
    expect(bypassesEditGuard("quit-app")).toBe(true); // 끝내기 모달
  });

  it("독 토글도 지나간다 — 독 안은 입력칸이라 못 지나가면 같은 키로 못 닫는다", () => {
    expect(bypassesEditGuard("open-hosts-dock")).toBe(true); // 열리자마자 트리의 검색 칸
    expect(bypassesEditGuard("open-db-dock")).toBe(true); // 연결 목록의 검색 칸
    expect(bypassesEditGuard("open-settings")).toBe(true); // 칸을 하나 만진 뒤에도 닫혀야 한다
  });

  it("나머지는 입력칸에 양보한다", () => {
    expect(bypassesEditGuard("new-tab")).toBe(false);
    expect(bypassesEditGuard("close-tab")).toBe(false);
    expect(bypassesEditGuard("split")).toBe(false);
    expect(bypassesEditGuard("command-palette")).toBe(false);
    expect(bypassesEditGuard("toggle-sync")).toBe(false);
  });

  it("찾기 둘은 지나가지 않는다 — 글자 키(F)라 입력칸에서는 양보해야 한다", () => {
    // 검색 오버레이 자신의 질의 칸에서 `Ctrl+F` 를 다시 잡아 버리면, 그 칸은 자기 글자를
    // 못 받는 자리가 된다. `focus-*` 무리와 달리 이쪽은 수식+글자라 입력칸에 뜻이 있다.
    expect(bypassesEditGuard("find")).toBe(false);
    expect(bypassesEditGuard("find-all")).toBe(false);
  });

  it("지나가는 액션은 전부 레지스트리에 실제로 있는 id 다", () => {
    const ids = new Set(ACTIONS.map((a) => a.id));
    for (const id of ids) {
      if (!bypassesEditGuard(id)) continue;
      expect(ids.has(id)).toBe(true);
    }
    // 그리고 그 목록은 비어 있지 않다 (규칙이 통째로 죽지 않았는지).
    expect([...ids].filter(bypassesEditGuard).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 브라우저 가속키 목록 (docs/log/2026-09-08-browser-accelerators.md)
// ---------------------------------------------------------------------------
describe("isBrowserChromeCombo — 앱이 뜻을 두지 않은 웹뷰 기본 동작 막기", () => {
  it("인쇄·저장·열기·소스·다운로드·기록·찾기막대를 막는다", () => {
    for (const combo of [
      "Ctrl+KeyP",
      "Ctrl+Shift+KeyP",
      "Ctrl+KeyS",
      "Ctrl+KeyO",
      "Ctrl+KeyU",
      "Ctrl+KeyJ",
      "Ctrl+KeyH",
      "Ctrl+KeyF",
      "Ctrl+KeyG",
      "Ctrl+Shift+KeyG",
      "F3",
      "Shift+F3",
    ]) {
      expect(isBrowserChromeCombo(combo), combo).toBe(true);
    }
  });

  it("새로고침·개발자 도구는 **일부러** 막지 않는다 (개발이 그 키에 기대고 있다)", () => {
    expect(isBrowserChromeCombo("Ctrl+KeyR")).toBe(false);
    expect(isBrowserChromeCombo("F5")).toBe(false);
    expect(isBrowserChromeCombo("F12")).toBe(false);
    expect(isBrowserChromeCombo("Ctrl+Shift+KeyI")).toBe(false);
  });

  it("평범한 조합·빈 문자열·수식 없는 글자는 목록 밖이다", () => {
    expect(isBrowserChromeCombo("")).toBe(false);
    expect(isBrowserChromeCombo("KeyP")).toBe(false);
    expect(isBrowserChromeCombo("Alt+KeyP")).toBe(false);
    expect(isBrowserChromeCombo("Ctrl+Shift+KeyT")).toBe(false);
    expect(isBrowserChromeCombo("Ctrl+ArrowUp")).toBe(false);
  });

  it("workspace switcher uses code-based Ctrl+Shift+G without a default action collision", () => {
    const action = ACTIONS.find((a) => a.id === "switch-workspace")!;
    expect(action.def).toBe("Ctrl+Shift+KeyG");
    expect(comboFromEvent(ev("KeyG", { ctrl: true, shift: true }))).toBe(action.def);
    expect(ACTIONS.filter((a) => a.def === action.def).map((a) => a.id)).toEqual([action.id]);
  });

  it("수식 순서는 이 앱의 형식(Ctrl → Alt → Shift)이라 뒤집으면 안 걸린다", () => {
    // 목록은 `comboFromEvent` 가 만들어 내는 문자열과 **같은 형식**으로만 적혀 있다.
    expect(isBrowserChromeCombo("Shift+Ctrl+KeyP")).toBe(false);
  });

  it("`comboFromEvent` 가 실제로 만들어 내는 문자열과 맞물린다", () => {
    expect(isBrowserChromeCombo(comboFromEvent(ev("KeyP", { ctrl: true }))!)).toBe(true);
    expect(isBrowserChromeCombo(comboFromEvent(ev("KeyG", { ctrl: true, shift: true }))!)).toBe(
      true,
    );
    expect(isBrowserChromeCombo(comboFromEvent(ev("KeyF", { ctrl: true }))!)).toBe(true);
  });

  it("앱 동작과 겹치는 조합은 브라우저 기본 동작만 막는다", () => {
    // 캡처 가드는 전파를 끊지 않는다. 앱 키 핸들러는 같은 이벤트로 앱 동작을 실행한다.
    const overlapping = ACTIONS.filter((a) => isBrowserChromeCombo(a.def)).map((a) => a.id);
    expect(overlapping).toEqual(["switch-workspace", "command-palette", "find"]);
  });
});

// ---------------------------------------------------------------------------
// 네이티브 우클릭 메뉴 (docs/log/2026-09-08-native-context-menu.md)
// ---------------------------------------------------------------------------

/**
 * 우클릭 타깃 흉내 — `shouldBlockNativeContextMenu` 가 보는 셋(`tagName`·`closest`·
 * `isContentEditable`)만 있다. 러너 환경이 `node` 라 진짜 DOM 은 없고, 판정이 그 셋만
 * 보도록 되어 있는 것이 이 테스트가 존재할 수 있는 이유다.
 */
function target(
  tagName: string,
  opts: { contentEditable?: boolean; inXterm?: boolean; imeProxy?: boolean; type?: string; inEditor?: boolean; terminalKeys?: boolean } = {},
): EventTarget {
  return {
    tagName,
    isContentEditable: opts.contentEditable ?? false,
    ...(opts.type !== undefined ? { type: opts.type } : {}),
    closest: (sel: string) =>
      (sel === ".xterm" && opts.inXterm) ||
      (sel === "[data-ime-proxy]" && opts.imeProxy) ||
      (sel === ".cm-editor" && opts.inEditor) ||
      (sel === "[data-terminal-keys]" && opts.terminalKeys)
        ? {}
        : null,
  } as unknown as EventTarget;
}

describe("shouldBlockNativeContextMenu — 창 전역에서 웹뷰 메뉴를 막는다", () => {
  it("앱이 메뉴를 두지 않은 자리(빈 div·body·타깃 없음)에서는 막는다", () => {
    expect(shouldBlockNativeContextMenu(target("DIV"), false)).toBe(true);
    expect(shouldBlockNativeContextMenu(target("BODY"), false)).toBe(true);
    expect(shouldBlockNativeContextMenu(target("BUTTON"), false)).toBe(true);
    expect(shouldBlockNativeContextMenu(null, false)).toBe(true);
  });

  it("앱 메뉴가 이미 `preventDefault` 했으면 손대지 않는다", () => {
    expect(shouldBlockNativeContextMenu(target("DIV"), true)).toBe(false);
    // 편집 필드든 아니든 결과는 같다 — 먼저 잡은 쪽이 주인이다.
    expect(shouldBlockNativeContextMenu(target("INPUT"), true)).toBe(false);
  });

  it("편집 필드는 예외다 — 마우스만 쓰는 사용자의 잘라내기·복사·붙여넣기를 남긴다", () => {
    expect(shouldBlockNativeContextMenu(target("INPUT"), false)).toBe(false);
    expect(shouldBlockNativeContextMenu(target("TEXTAREA"), false)).toBe(false);
    expect(shouldBlockNativeContextMenu(target("DIV", { contentEditable: true }), false)).toBe(
      false,
    );
  });

  it("xterm 의 숨은 textarea 는 편집 필드가 아니다 — 터미널 위에서는 막는다", () => {
    // 터미널은 자기 `contextmenu` 로 붙여넣기/메뉴를 정하고 언제나 `preventDefault` 한다.
    // 그 배선이 끊겨 여기까지 올라오더라도 웹뷰 메뉴가 뜨는 일은 없어야 한다.
    expect(shouldBlockNativeContextMenu(target("TEXTAREA", { inXterm: true }), false)).toBe(true);
    expect(
      shouldBlockNativeContextMenu(target("DIV", { contentEditable: true, inXterm: true }), false),
    ).toBe(true);
  });

  it("`isEditableTarget` 과 같은 판정을 쓴다 (둘이 갈리면 키 가드와 어긋난다)", () => {
    expect(isEditableTarget(target("INPUT"))).toBe(true);
    expect(isEditableTarget(target("TEXTAREA", { inXterm: true }))).toBe(false);
    expect(isEditableTarget(target("DIV"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    // 요소가 아닌 것(window·document 처럼 `closest` 가 없는 것)은 편집 필드가 아니다.
    expect(isEditableTarget({} as unknown as EventTarget)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 편집 필드 = 글자를 치는 곳뿐 (docs/log/2026-09-25-editable-target.md)
// ---------------------------------------------------------------------------

describe("isEditableTarget — 글자를 치는 곳만 편집 필드다", () => {
  const TEXT_TYPES = [
    "text",
    "search",
    "password",
    "email",
    "url",
    "tel",
    "number",
    "date",
    "time",
    "datetime-local",
  ];
  const NON_TEXT_TYPES = [
    "checkbox",
    "radio",
    "range",
    "button",
    "submit",
    "reset",
    "image",
    "color",
    "file",
  ];

  it("글자를 받는 <input> 은 편집 필드다 (type 이 없어도)", () => {
    for (const type of TEXT_TYPES) {
      expect(isEditableTarget(target("INPUT", { type })), type).toBe(true);
    }
    expect(isEditableTarget(target("INPUT"))).toBe(true); // type 없음 = text
    expect(isEditableTarget(target("INPUT", { type: "Text" }))).toBe(true); // 대소문자 무관
  });

  it("글자를 받지 않는 <input> 과 <select> 는 편집 필드가 아니다 (스위치 위의 Ctrl+Shift+P)", () => {
    for (const type of NON_TEXT_TYPES) {
      expect(isEditableTarget(target("INPUT", { type })), type).toBe(false);
    }
    expect(isEditableTarget(target("INPUT", { type: "CheckBox" }))).toBe(false);
    expect(isEditableTarget(target("SELECT"))).toBe(false);
  });

  it("textarea · contenteditable 은 편집 필드다", () => {
    expect(isEditableTarget(target("TEXTAREA"))).toBe(true);
    expect(isEditableTarget(target("DIV", { contentEditable: true }))).toBe(true);
  });

  it("xterm 의 숨은 textarea 는 여전히 편집 필드가 아니다 (터미널 규칙 불변)", () => {
    expect(isEditableTarget(target("TEXTAREA", { inXterm: true }))).toBe(false);
    expect(isEditableTarget(target("INPUT", { type: "text", inXterm: true }))).toBe(false);
  });

  it("IME 포커스 주인(launcher 의 숨은 입력칸)은 편집 필드가 아니다 — 전역 단축키가 먹는다", () => {
    expect(isEditableTarget(target("INPUT", { type: "text", imeProxy: true }))).toBe(false);
    expect(shouldBlockNativeContextMenu(target("INPUT", { imeProxy: true }), false)).toBe(true);
  });

  it("우클릭 메뉴도 같은 판정을 따른다 — 체크박스·select 위에서는 막는다", () => {
    expect(shouldBlockNativeContextMenu(target("INPUT", { type: "checkbox" }), false)).toBe(true);
    expect(shouldBlockNativeContextMenu(target("SELECT"), false)).toBe(true);
    expect(shouldBlockNativeContextMenu(target("INPUT", { type: "search" }), false)).toBe(false);
  });
});

describe("isControlOwnedKey — 폼 컨트롤이 스스로 쓰는 맨 키", () => {
  const key = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
    code,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
  });
  const checkbox = target("INPUT", { type: "checkbox" });
  const range = target("INPUT", { type: "range" });
  const select = target("SELECT");

  it("Ctrl·Alt 조합은 언제나 앱의 것이다 — 스위치·select 위에서도 팔레트가 열린다", () => {
    for (const t of [checkbox, range, select]) {
      expect(isControlOwnedKey(t, key("KeyP", { ctrl: true, shift: true }))).toBe(false);
      expect(isControlOwnedKey(t, key("Digit1", { alt: true }))).toBe(false);
      expect(isControlOwnedKey(t, key("ArrowDown", { alt: true }))).toBe(false);
    }
  });

  it("체크박스·슬라이더는 Space·Enter·화살표·Home/End·PageUp/Down 을 쥔다", () => {
    for (const code of ["Space", "Enter", "ArrowLeft", "ArrowDown", "Home", "End", "PageUp"]) {
      expect(isControlOwnedKey(checkbox, key(code)), code).toBe(true);
      expect(isControlOwnedKey(range, key(code)), code).toBe(true);
    }
    expect(isControlOwnedKey(checkbox, key("Space", { shift: true }))).toBe(true);
  });

  it("체크박스 위의 다른 글자(`?` 치트시트 등)는 앱이 받는다", () => {
    expect(isControlOwnedKey(checkbox, key("Slash", { shift: true }))).toBe(false);
    expect(isControlOwnedKey(checkbox, key("KeyA"))).toBe(false);
    expect(isControlOwnedKey(checkbox, key("F2"))).toBe(false);
  });

  it("select 는 맨 글자(글자 찾기)·화살표를 쥐고, 기능 키는 놓는다", () => {
    expect(isControlOwnedKey(select, key("KeyA"))).toBe(true);
    expect(isControlOwnedKey(select, key("Slash", { shift: true }))).toBe(true);
    expect(isControlOwnedKey(select, key("ArrowDown"))).toBe(true);
    expect(isControlOwnedKey(select, key("F2"))).toBe(false);
  });

  it("텍스트 칸·일반 요소·터미널·타깃 없음은 여기서 무관하다", () => {
    expect(isControlOwnedKey(target("INPUT", { type: "text" }), key("Space"))).toBe(false);
    expect(isControlOwnedKey(target("TEXTAREA"), key("Space"))).toBe(false);
    expect(isControlOwnedKey(target("DIV"), key("Space"))).toBe(false);
    expect(isControlOwnedKey(target("TEXTAREA", { inXterm: true }), key("Space"))).toBe(false);
    expect(isControlOwnedKey(null, key("Space"))).toBe(false);
  });
});

describe("문서 편집기의 키 경계 (docs/log/2026-09-27-doc-edit.md F2)", () => {
  const PALETTE = "Ctrl+Shift+KeyP";
  const inEd = target("DIV", { contentEditable: true, inEditor: true });

  it("`.cm-editor` 안이면 편집기다 — 글 칸 · 거터 모두", () => {
    expect(isInDocEditor(inEd)).toBe(true);
    expect(isInDocEditor(target("DIV", { inEditor: true }))).toBe(true);
    expect(isInDocEditor(target("DIV", { contentEditable: true }))).toBe(false);
    expect(isInDocEditor(target("TEXTAREA", { inXterm: true }))).toBe(false);
    expect(isInDocEditor(null)).toBe(false);
  });

  it("앱이 쥐는 것: Ctrl+Shift+… · Alt+화살표 · Alt+Shift+화살표 · Ctrl+Tab · Ctrl+PageUp/Down · 팔레트", () => {
    for (const c of [
      "Ctrl+Shift+KeyT",
      "Ctrl+Shift+KeyK",
      "Ctrl+Shift+ArrowLeft",
      "Ctrl+Shift+Tab",
      "Ctrl+Shift+BracketLeft",
      "Alt+ArrowUp",
      "Alt+ArrowLeft",
      "Alt+Shift+ArrowDown",
      "Ctrl+Alt+ArrowUp",
      "Ctrl+Alt+ArrowLeft",
      "Ctrl+Tab",
      "Ctrl+PageUp",
      "Ctrl+PageDown",
    ]) {
      expect(appKeepsInEditor(c, PALETTE), c).toBe(true);
    }
    // 팔레트를 다른 조합으로 다시 묶었으면 그 조합도
    expect(appKeepsInEditor("Ctrl+KeyK", "Ctrl+KeyK")).toBe(true);
    expect(appKeepsInEditor("Ctrl+KeyK", null)).toBe(false);
  });

  it("편집기의 것: Ctrl+D · F · Z · Y · A · S · 맨 글자 · Escape · Alt+글자 · Ctrl+Alt", () => {
    for (const c of [
      "Ctrl+KeyD",
      "Ctrl+KeyF",
      "Ctrl+KeyZ",
      "Ctrl+KeyY",
      "Ctrl+KeyA",
      "Ctrl+KeyS",
      "KeyA",
      "Escape",
      "Alt+KeyX",
      "Ctrl+Alt+KeyX",
      "Ctrl+ArrowUp",
      "Shift+ArrowUp",
    ]) {
      expect(appKeepsInEditor(c, PALETTE), c).toBe(false);
    }
  });

  it("editorOwnsKey — 편집기 밖이면 언제나 false(예전 규칙 그대로)", () => {
    expect(editorOwnsKey(target("DIV"), "Ctrl+KeyD", { bound: false, paletteCombo: PALETTE })).toBe(false);
    expect(editorOwnsKey(target("INPUT"), "Ctrl+KeyF", { bound: true, paletteCombo: PALETTE })).toBe(false);
  });

  it("editorOwnsKey — 앱 계열이라도 액션에 묶이지 않았으면 편집기에 둔다", () => {
    expect(editorOwnsKey(inEd, "Ctrl+Shift+KeyT", { bound: true, paletteCombo: PALETTE })).toBe(false);
    expect(editorOwnsKey(inEd, "Alt+ArrowUp", { bound: true, paletteCombo: PALETTE })).toBe(false);
    expect(editorOwnsKey(inEd, "Ctrl+Shift+KeyX", { bound: false, paletteCombo: PALETTE })).toBe(true);
    // 묶여 있어도 앱 계열이 아니면 편집기의 것(찾기 Ctrl+F 는 편집기의 찾기)
    expect(editorOwnsKey(inEd, "Ctrl+KeyF", { bound: true, paletteCombo: PALETTE })).toBe(true);
    expect(editorOwnsKey(inEd, "Ctrl+KeyD", { bound: false, paletteCombo: PALETTE })).toBe(true);
  });

  it("우클릭: 편집기 안 어디서든 네이티브 메뉴를 허용한다(거터 포함) · 밖은 그대로", () => {
    expect(shouldBlockNativeContextMenu(inEd, false)).toBe(false);
    expect(shouldBlockNativeContextMenu(target("DIV", { inEditor: true }), false)).toBe(false);
    expect(shouldBlockNativeContextMenu(target("DIV"), false)).toBe(true);
  });
});


describe("isTerminalKeysInput — AI 타일 대화 면 입력 칸만 단축키에서 터미널처럼(2026-11-02)", () => {
  it("표지가 있는 글 칸만 · 글 칸 판정 자체는 그대로(우클릭 메뉴는 웹뷰 것)", () => {
    const composer = target("TEXTAREA", { terminalKeys: true });
    expect(isTerminalKeysInput(composer)).toBe(true);
    expect(isEditableTarget(composer)).toBe(true);
    expect(isTerminalKeysInput(target("TEXTAREA"))).toBe(false);
    expect(isTerminalKeysInput(target("INPUT"))).toBe(false);
    expect(isTerminalKeysInput(null)).toBe(false);
  });
});
