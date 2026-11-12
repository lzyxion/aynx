import { describe, expect, it } from "vitest";
import type { AppSettings } from "$lib/settings.svelte.js";
import {
  APPEARANCE_APP_KEYS,
  MAX_PROFILES,
  MAX_PROFILE_NAME,
  THEME_PROFILE_FILE_VERSION,
  applyAppearance,
  parseProfiles,
  profileNamed,
  renameProfile,
  sameAppearance,
  serializeProfiles,
  snapshotAppearance,
  withProfile,
  withStartBoard,
  withoutProfile,
  type AppearanceSnapshot,
  type ThemeProfile,
} from "$lib/theme-profiles";
import { defaultStartWidgets, sameStartBoard, type StartBoardSnapshot } from "$lib/start-widgets";
import { DEFAULT_CLOCK_OPTIONS } from "$lib/start-clock";

/**
 * 모양 프로필의 순수 층 — 담기·입히기·비교·파일 왕복·목록 조작
 * (docs/log/2026-09-15-theme-profiles.md).
 *
 * 룬을 쓰는 층(`theme-profiles.svelte.ts`)은 여기 함수들을 부르고 뒤처리(화면 반영·저장)만
 * 한다. 그래서 규칙이 실제로 사는 자리는 이 파일이 덮는다.
 */

/** 설정 한 벌 — 모양 칸과 **모양이 아닌 칸**을 함께 채워 둔다(빠지는지 보려고) */
function settingsFixture(): AppSettings {
  return {
    app: {
      accent: "#d95a9e",
      bg: "#101014",
      bg_panel: "#17171c",
      fg: "#e6e6ea",
      border: "#2a2a33",
      err: "#e05561",
      ok: "#6ec46e",
      warn: "#d8a33a",
      dynamic: "full",
      opacity: 80,
      mode: "light",
      tile_header: "multi",
      status_bar: "bottom",
      status_bar_style: "panel",
      // 모양이 아닌 것들 — 프로필에 담기면 안 된다
      auto_reconnect: true,
      tiling: "focus",
      idle_lock_min: 15,
      language: "en",
    },
    terminal: {
      theme: "dynamic",
      opacity: 85,
      tab_style: "pill",
      dynamic: { background: "#101014", red: "#e05561", "before-theme": "aynx-dark" },
      // 모양 칸(글꼴 · 커서 · 합자 — 2026-11-08)
      font_family: "Cascadia Mono",
      cursor_style: "bar",
      ligatures: true,
      // 모양이 아닌 것들(글자 크기는 모니터 · 시력의 값이라 담지 않는다)
      font_size: 15,
      webgl: false,
      right_click: "paste",
      confirm_multiline_paste: false,
      local_shell_integration: false,
    },
    shell: { default: "pwsh" },
    ai: { start_dir: "C:/work" },
    wallpaper: { file: "wallpaper.jpg", dim: 55, blur: 6, fit: "contain" },
    triggers: [{ pattern: "error", fg: undefined, bg: "#6b4a17", enabled: true }],
    keybindings: { "new-shell": "Ctrl+T" },
    automation: {
      auto_approve: true,
      allow_patterns: ["systemctl status"],
      bundles: ["system"],
      bundle_off: { system: ["date"] },
      max_targets: 5,
      max_concurrency: 2,
      auto_max_per_window: 20,
      auto_window_secs: 300,
      approval_ttl_minutes: 30,
      notify_review_requests: true,
      notify_operation_results: true,
      audit_retention_days: 90,
      audit_output_excerpt: false,
      allow_pipes: false,
      allow: [{ exec: "df", subcommands: [] }],
    },
    // 모양이 아닌 것 — 자격증명 볼트의 정책 한 칸도 프로필에 담기면 안 된다
    vault: { auto_lock_minutes: 5 },
    // 모양이 아닌 것 — 호스트 목록 정렬도 프로필에 담기면 안 된다
    hosts: { sort: "recent" },
    // 모양이 아닌 것 — 파일 타일의 기본 보기도 프로필에 담기면 안 된다
    files: { default_view: "navigate" },
    // 모양이 아닌 것 — 프로젝트 시작 화면도 프로필에 담기면 안 된다
    projects: { start_screen: "off" },
    dock: { layout: "launcher-right" },
    // 모양이 아닌 것 — 작업안 실행 목록 정렬도 프로필에 담기면 안 된다
    plans: { exec_sort: "oldest" },
    // 모양이 아닌 것 — 업데이트 자동 확인도 프로필에 담기면 안 된다
    updates: { auto_check: false },
    // 모양이 아닌 것 — 메신저 알림도 프로필에 담기면 안 된다
    messenger: { when: "always" },
    // 원격 관문도 모양이 아니다
    remote: { enabled: true, host: "mypc.tailnet-ab.ts.net" },
  };
}

function profileOf(id: string, name: string, appearance: AppearanceSnapshot): ThemeProfile {
  return { id, name, savedAt: 1, appearance };
}

describe("snapshotAppearance", () => {
  it("모양 칸만 담고 그 밖의 설정은 담지 않는다", () => {
    const snap = snapshotAppearance(settingsFixture());

    expect(snap.app.accent).toBe("#d95a9e");
    expect(snap.app.dynamic).toBe("full");
    expect(snap.app.opacity).toBe(80);
    expect(snap.app.mode).toBe("light");
    expect(snap.app.status_bar_style).toBe("panel");
    expect(snap.terminal.theme).toBe("dynamic");
    expect(snap.terminal.opacity).toBe(85);
    expect(snap.terminal.tab_style).toBe("pill");
    expect(snap.terminal.dynamic?.["before-theme"]).toBe("aynx-dark");
    expect(snap.wallpaper).toEqual({ file: "wallpaper.jpg", dim: 55, blur: 6, fit: "contain" });

    // 동작·취향 칸은 한 칸도 새지 않는다.
    for (const key of ["auto_reconnect", "tiling", "idle_lock_min", "language"]) {
      expect(snap.app).not.toHaveProperty(key);
    }
    expect(snap.terminal.font_family).toBe("Cascadia Mono");
    expect(snap.terminal.cursor_style).toBe("bar");
    expect(snap.terminal.ligatures).toBe(true);
    for (const key of ["font_size", "webgl"]) {
      expect(snap.terminal).not.toHaveProperty(key);
    }
    expect(snap).not.toHaveProperty("shell");
    expect(snap).not.toHaveProperty("keybindings");
    expect(snap).not.toHaveProperty("vault");
  });

  it("안 정한 칸은 키 자체를 만들지 않는다", () => {
    const s = settingsFixture();
    s.app.accent = undefined;
    s.wallpaper.file = undefined;
    const snap = snapshotAppearance(s);
    expect(snap.app).not.toHaveProperty("accent");
    expect(snap.wallpaper).not.toHaveProperty("file");
  });

  it("팔레트를 복사한다 — 나중에 설정을 고쳐도 담아 둔 벌이 따라 변하지 않는다", () => {
    const s = settingsFixture();
    const snap = snapshotAppearance(s);
    s.terminal.dynamic!.red = "#000000";
    expect(snap.terminal.dynamic?.red).toBe("#e05561");
  });
});

describe("applyAppearance", () => {
  it("모양 칸을 갈아 끼우고 나머지 설정은 그대로 둔다", () => {
    const current = settingsFixture();
    const snap = snapshotAppearance(settingsFixture());
    snap.app.accent = "#3b82f6";
    snap.app.mode = "dark";
    snap.terminal.tab_style = "pill";
    snap.wallpaper.file = "wallpaper.png";

    const next = applyAppearance(current, snap);

    expect(next.app.accent).toBe("#3b82f6");
    expect(next.app.mode).toBe("dark");
    expect(next.terminal.tab_style).toBe("pill");
    expect(next.wallpaper.file).toBe("wallpaper.png");
    // 모양이 아닌 칸은 그대로다.
    expect(next.app.auto_reconnect).toBe(true);
    expect(next.app.tiling).toBe("focus");
    expect(next.terminal.font_size).toBe(15);
    expect(next.shell.default).toBe("pwsh");
    expect(next.keybindings).toEqual({ "new-shell": "Ctrl+T" });
    // 원본은 건드리지 않는다.
    expect(current.app.accent).toBe("#d95a9e");
  });

  it("프로필이 **안 정한** 모양 칸은 지운다 (지난 벌의 값이 남지 않게)", () => {
    const current = settingsFixture();
    const empty: AppearanceSnapshot = { app: {}, terminal: {}, wallpaper: {} };

    const next = applyAppearance(current, empty);

    for (const key of APPEARANCE_APP_KEYS) expect(next.app[key]).toBeUndefined();
    expect(next.terminal.theme).toBeUndefined();
    expect(next.terminal.dynamic).toBeUndefined();
    expect(next.wallpaper.file).toBeUndefined();
    // 그래도 모양 밖은 살아 있다.
    expect(next.app.idle_lock_min).toBe(15);
    expect(next.terminal.webgl).toBe(false);
    expect(next.vault.auto_lock_minutes).toBe(5);
  });

  it("keepWallpaper 면 배경 네 칸을 건드리지 않는다", () => {
    const current = settingsFixture();
    const snap = snapshotAppearance(settingsFixture());
    snap.wallpaper = { file: "사라진.png", dim: 0, blur: 0, fit: "cover" };
    snap.app.accent = "#3b82f6";

    const next = applyAppearance(current, snap, { keepWallpaper: true });

    expect(next.wallpaper).toEqual(current.wallpaper);
    expect(next.app.accent).toBe("#3b82f6"); // 나머지는 그대로 적용된다
  });

  it("팔레트를 복사해 넣는다 — 프로필과 설정이 같은 맵을 나눠 갖지 않는다", () => {
    const snap = snapshotAppearance(settingsFixture());
    const next = applyAppearance(settingsFixture(), snap);
    next.terminal.dynamic!.red = "#000000";
    expect(snap.terminal.dynamic?.red).toBe("#e05561");
  });
});

describe("앱 아이콘 칸 (docs/log/2026-10-22-custom-app-icon.md)", () => {
  it("담을 때 기본(빈 칸)도 gpt 로 적는다 — 없음(옛 프로필)과 갈린다", () => {
    const s = settingsFixture();
    s.app.app_icon = undefined;
    expect(snapshotAppearance(s).app.app_icon).toBe("gpt");
    s.app.app_icon = "user-0123456789ab";
    expect(snapshotAppearance(s).app.app_icon).toBe("user-0123456789ab");
  });

  it("적용하면 그 아이콘으로 — gpt(기본)는 설정 관례대로 빈 칸", () => {
    const current = settingsFixture();
    current.app.app_icon = "claude";
    const snap = snapshotAppearance(settingsFixture());
    snap.app.app_icon = "user-0123456789ab";
    expect(applyAppearance(current, snap).app.app_icon).toBe("user-0123456789ab");
    snap.app.app_icon = "gpt";
    expect(applyAppearance(current, snap).app.app_icon).toBeUndefined();
  });

  it("옛 프로필(칸 없음)은 기본(gpt)으로 읽히고, 적용하면 gpt 로 바뀐다", () => {
    const current = settingsFixture();
    current.app.app_icon = "grok";
    const old = parseProfiles(
      JSON.stringify({ version: 1, active: null, profiles: [{ id: "P1", name: "옛", appearance: { app: { mode: "dark" } } }] }),
    )!.profiles[0].appearance;
    expect(old.app.app_icon).toBe("gpt");
    expect(applyAppearance(current, old).app.app_icon).toBeUndefined(); // 기본 = 설정의 빈 칸
    // 칸이 아예 없는 값(손으로 만든 스냅숏)도 기본으로 적용된다.
    expect(applyAppearance(current, { app: {}, terminal: {}, wallpaper: {} }).app.app_icon).toBeUndefined();
  });

  it("아이콘만 달라도 (수정됨)이고, 없음은 gpt(기본)와 같다", () => {
    const s = settingsFixture();
    s.app.app_icon = "grok";
    const now = snapshotAppearance(s);
    expect(sameAppearance(now, { ...now, app: { ...now.app, app_icon: "claude" } })).toBe(false);
    expect(sameAppearance(now, { ...now, app: { ...now.app, app_icon: undefined } })).toBe(false);
    const dflt = { ...now, app: { ...now.app, app_icon: "gpt" } };
    expect(sameAppearance(dflt, { ...now, app: { ...now.app, app_icon: undefined } })).toBe(true);
  });

  it("지워진 사용자 아이콘은 기본으로 접고, 원격(keep)은 그대로 둔다", () => {
    const current = settingsFixture();
    current.app.app_icon = "claude";
    const snap = snapshotAppearance(settingsFixture());
    snap.app.app_icon = "user-0123456789ab";
    expect(applyAppearance(current, snap, { icon: "default" }).app.app_icon).toBeUndefined();
    expect(applyAppearance(current, snap, { icon: "keep" }).app.app_icon).toBe("claude");
  });

  it("파일 왕복에 아이콘이 오가고, 모르는 값(옛 luna 포함) · 틀린 모양은 기본(gpt)으로 읽는다", () => {
    const s = settingsFixture();
    s.app.app_icon = "user-0123456789ab";
    const json = JSON.stringify(serializeProfiles([profileOf("P1", "밤", snapshotAppearance(s))], "P1"));
    expect(parseProfiles(json)!.profiles[0].appearance.app.app_icon).toBe("user-0123456789ab");
    for (const bad of ["nobody", "luna", "user-../x", 3]) {
      const raw = JSON.stringify({ version: 1, active: null, profiles: [{ id: "P", name: "n", appearance: { app: { app_icon: bad } } }] });
      expect(parseProfiles(raw)!.profiles[0].appearance.app.app_icon).toBe("gpt");
    }
  });
});

describe("sameAppearance", () => {
  it("같은 벌은 같다 — 담기·입히기를 지나도 그대로다", () => {
    const a = snapshotAppearance(settingsFixture());
    const b = snapshotAppearance(applyAppearance(settingsFixture(), a));
    expect(sameAppearance(a, b)).toBe(true);
  });

  it("칸 하나만 달라도 다르다", () => {
    const a = snapshotAppearance(settingsFixture());
    for (const patch of [
      (s: AppearanceSnapshot) => (s.app.accent = "#000000"),
      (s: AppearanceSnapshot) => (s.app.dynamic = undefined),
      (s: AppearanceSnapshot) => (s.app.opacity = 79),
      (s: AppearanceSnapshot) => (s.app.status_bar = "top"),
      (s: AppearanceSnapshot) => (s.terminal.theme = "aynx-dark"),
      (s: AppearanceSnapshot) => (s.terminal.opacity = 100),
      (s: AppearanceSnapshot) => (s.terminal.dynamic = { red: "#000000" }),
      (s: AppearanceSnapshot) => (s.wallpaper.dim = 10),
    ]) {
      const b = snapshotAppearance(settingsFixture());
      patch(b);
      expect(sameAppearance(a, b)).toBe(false);
    }
  });

  it("모양이 아닌 설정이 달라진 것은 보지 않는다", () => {
    const a = snapshotAppearance(settingsFixture());
    const s = settingsFixture();
    s.terminal.font_size = 20;
    s.app.tiling = "spiral";
    s.keybindings = {};
    expect(sameAppearance(a, snapshotAppearance(s))).toBe(true);
  });

  it("팔레트 없음과 빈 맵은 같다", () => {
    const a: AppearanceSnapshot = { app: {}, terminal: {}, wallpaper: {} };
    const b: AppearanceSnapshot = { app: {}, terminal: { dynamic: {} }, wallpaper: {} };
    expect(sameAppearance(a, b)).toBe(true);
  });
});

describe("상태바 고리 둘(resource_rings · usage_rings — 2026-11-08)", () => {
  it("끈 고리는 담기고 파일을 왕복해도 남으며, 적용하면 그대로 꺼진다", () => {
    const s = settingsFixture();
    s.app.resource_rings = false;
    s.app.usage_rings = false;
    const snap = snapshotAppearance(s);
    expect(snap.app.resource_rings).toBe(false);
    expect(snap.app.usage_rings).toBe(false);
    const back = parseProfiles(JSON.stringify(serializeProfiles([profileOf("P1", "밤", snap)], "P1")))!;
    expect(back.profiles[0].appearance.app.resource_rings).toBe(false);
    expect(back.profiles[0].appearance.app.usage_rings).toBe(false);
    const next = applyAppearance(settingsFixture(), back.profiles[0].appearance);
    expect(next.app.resource_rings).toBe(false);
    expect(next.app.usage_rings).toBe(false);
  });

  it("켬(기본)은 담기지 않고, 그 칸 없는 옛 프로필을 적용하면 둘 다 켬으로 돌아온다 · 불리언이 아니면 버린다", () => {
    const snap = snapshotAppearance(settingsFixture());
    expect(snap.app).not.toHaveProperty("resource_rings");
    const off = settingsFixture();
    off.app.resource_rings = false;
    off.app.usage_rings = false;
    const next = applyAppearance(off, snap);
    expect(next.app.resource_rings).toBeUndefined();
    expect(next.app.usage_rings).toBeUndefined();
    const raw = { ...snap, app: { ...snap.app, resource_rings: "false", usage_rings: 0 } };
    const back = parseProfiles(JSON.stringify(serializeProfiles([profileOf("P1", "밤", raw as never)], "P1")))!;
    expect(back.profiles[0].appearance.app).not.toHaveProperty("resource_rings");
    expect(back.profiles[0].appearance.app).not.toHaveProperty("usage_rings");
  });
});

describe("글꼴 · 커서 · 합자 · 창 단추 · 독 배치(2026-11-08)", () => {
  function styled(): AppSettings {
    const s = settingsFixture();
    s.app.ui_font_family = "Pretendard";
    s.app.window_controls = true;
    s.terminal.font_family = "JetBrains Mono";
    s.terminal.cursor_style = "bar";
    s.terminal.ligatures = true;
    s.terminal.font_size = 17;
    s.app.ui_scale = 125;
    s.dock = { layout: "launcher-right" };
    return s;
  }

  it("담기고 파일을 왕복해 적용하면 되살아난다 · 글자 · UI 크기는 담지 않는다", () => {
    const snap = snapshotAppearance(styled());
    expect(snap.terminal).not.toHaveProperty("font_size");
    expect(snap.app).not.toHaveProperty("ui_scale");
    const back = parseProfiles(JSON.stringify(serializeProfiles([profileOf("P1", "밤", snap)], "P1")))!;
    const got = back.profiles[0].appearance;
    expect(sameAppearance(got, snap)).toBe(true);
    const base = settingsFixture();
    const next = applyAppearance(base, got);
    expect(next.app.ui_font_family).toBe("Pretendard");
    expect(next.app.window_controls).toBe(true);
    expect(next.terminal.font_family).toBe("JetBrains Mono");
    expect(next.terminal.cursor_style).toBe("bar");
    expect(next.terminal.ligatures).toBe(true);
    expect(next.dock.layout).toBe("launcher-right");
    expect(next.terminal.font_size).toBe(base.terminal.font_size);
    expect(next.app.ui_scale).toBe(base.app.ui_scale);
  });

  it("칸 없는 옛 프로필(dock 없음)을 적용하면 기본으로 돌아오고, 독 배치가 다르면 수정됨이다", () => {
    const { dock: _gone, ...old } = snapshotAppearance(settingsFixture());
    const { ligatures: _l, ...oldTerm } = old.terminal;
    const next = applyAppearance(styled(), { ...old, terminal: oldTerm } as AppearanceSnapshot);
    expect(next.dock.layout).toBeUndefined();
    expect(next.terminal.ligatures).toBeUndefined();
    expect(next.app.window_controls).toBeUndefined();
    const a = snapshotAppearance(styled());
    const b = snapshotAppearance({ ...styled(), dock: {} });
    expect(sameAppearance(a, b)).toBe(false);
  });
});

describe("parseProfiles", () => {
  const snap = snapshotAppearance(settingsFixture());

  it("저장한 것을 그대로 되읽는다", () => {
    const file = serializeProfiles([profileOf("P1", "밤", snap)], "P1");
    const back = parseProfiles(JSON.stringify(file));
    expect(back?.active).toBe("P1");
    expect(back?.profiles).toHaveLength(1);
    expect(back?.profiles[0].name).toBe("밤");
    expect(sameAppearance(back!.profiles[0].appearance, snap)).toBe(true);
  });

  it("깨진 입력·모르는 버전은 통째로 null (절대 throw 하지 않는다)", () => {
    for (const bad of [null, undefined, "", "   ", "{", "[]", "3", '{"version":2,"profiles":[]}']) {
      expect(parseProfiles(bad as string | null)).toBeNull();
    }
    expect(parseProfiles('{"version":1}')).toBeNull(); // profiles 가 배열이 아니다
  });

  it("깨진 줄만 버리고 나머지는 살린다", () => {
    const json = JSON.stringify({
      version: THEME_PROFILE_FILE_VERSION,
      active: null,
      profiles: [
        null,
        { id: "", name: "이름만", appearance: {} },
        { id: "P1", name: "  ", appearance: {} },
        { id: "P2", name: "정상", appearance: { app: { accent: "#fff" } } },
        { id: "P2", name: "id 중복", appearance: {} },
        { id: "P3", name: "appearance 없음" },
        { id: "P4", name: "긴 이름".repeat(40), appearance: {} },
      ],
    });
    const back = parseProfiles(json);
    expect(back?.profiles.map((p) => p.id)).toEqual(["P2", "P4"]);
    expect(back?.profiles[0].appearance.app.accent).toBe("#fff");
    expect(back?.profiles[1].name.length).toBe(MAX_PROFILE_NAME);
  });

  it("모르는 필드·이상한 타입은 버린다", () => {
    const json = JSON.stringify({
      version: THEME_PROFILE_FILE_VERSION,
      profiles: [
        {
          id: "P1",
          name: "잡동사니",
          savedAt: "어제",
          appearance: {
            app: { accent: 12, dynamic: "true", opacity: "80", mode: "light", 모르는칸: "x" },
            terminal: { theme: "aynx-dark", opacity: 85.4, dynamic: { red: "#f00", n: 5 } },
            wallpaper: { file: "../밖.png", dim: 40 },
            모르는테이블: { x: 1 },
          },
        },
      ],
    });
    const p = parseProfiles(json)!.profiles[0];
    expect(p.savedAt).toBe(0);
    expect(p.appearance.app).not.toHaveProperty("accent"); // 숫자는 색이 아니다
    expect(p.appearance.app).not.toHaveProperty("dynamic"); // 문자열 "true" 는 불리언이 아니다
    expect(p.appearance.app).not.toHaveProperty("opacity");
    expect(p.appearance.app.mode).toBe("light");
    expect(p.appearance.app).not.toHaveProperty("모르는칸");
    expect(p.appearance.terminal.opacity).toBe(85); // 정수로 접는다
    expect(p.appearance.terminal.dynamic).toEqual({ red: "#f00" }); // 색이 아닌 값만 걷어 낸다
    expect(p.appearance.wallpaper).not.toHaveProperty("file"); // 경로는 이름이 아니다
    expect(p.appearance).not.toHaveProperty("모르는테이블");
  });

  it("월페이퍼 색 단계 — 옛 불리언 true 는 전체로 옮기고, 세 단계 문자열은 그대로 받는다", () => {
    const app = (dynamic: unknown) =>
      parseProfiles(
        JSON.stringify({
          version: THEME_PROFILE_FILE_VERSION,
          active: null,
          profiles: [{ id: "P", name: "n", savedAt: 1, appearance: { app: { dynamic } } }],
        }),
      )!.profiles[0].appearance.app;
    expect(app(true).dynamic).toBe("full");
    expect(app("subtle").dynamic).toBe("subtle");
    expect(app("off").dynamic).toBe("off");
    expect(app(false)).not.toHaveProperty("dynamic");
  });

  it("목록에 없는 active 는 null 이다", () => {
    const json = JSON.stringify({
      version: THEME_PROFILE_FILE_VERSION,
      active: "없는-id",
      profiles: [{ id: "P1", name: "밤", appearance: {} }],
    });
    expect(parseProfiles(json)?.active).toBeNull();
  });

  it("상한을 넘는 목록은 앞에서부터 잘린다", () => {
    const many = Array.from({ length: MAX_PROFILES + 5 }, (_, i) => ({
      id: `P${i}`,
      name: `벌 ${i}`,
      appearance: {},
    }));
    const json = JSON.stringify({ version: THEME_PROFILE_FILE_VERSION, profiles: many });
    expect(parseProfiles(json)?.profiles).toHaveLength(MAX_PROFILES);
  });
});

describe("serializeProfiles", () => {
  const snap = snapshotAppearance(settingsFixture());

  it("같은 목록이면 같은 문자열이다 (무변경 생략의 전제)", () => {
    const list = [profileOf("P1", "밤", snap), profileOf("P2", "낮", snap)];
    const a = JSON.stringify(serializeProfiles(list, "P1"));
    const b = JSON.stringify(serializeProfiles([...list], "P1"));
    expect(a).toBe(b);
  });

  it("목록에 없는 active 는 파일에 남지 않는다", () => {
    expect(serializeProfiles([profileOf("P1", "밤", snap)], "P9").active).toBeNull();
  });
});

describe("목록 조작", () => {
  const snap = snapshotAppearance(settingsFixture());

  it("withProfile 은 같은 id 를 갈아 끼우고 맨 앞에 둔다", () => {
    const list = [profileOf("P1", "밤", snap), profileOf("P2", "낮", snap)];
    const next = withProfile(list, { ...profileOf("P2", "낮", snap), savedAt: 9 });
    expect(next.map((p) => p.id)).toEqual(["P2", "P1"]);
    expect(next[0].savedAt).toBe(9);
    expect(list.map((p) => p.id)).toEqual(["P1", "P2"]); // 원본은 그대로
  });

  it("withProfile 은 상한을 넘으면 가장 오래된 것부터 민다", () => {
    let list: ThemeProfile[] = [];
    for (let i = 0; i < MAX_PROFILES + 3; i++) {
      list = withProfile(list, profileOf(`P${i}`, `벌 ${i}`, snap));
    }
    expect(list).toHaveLength(MAX_PROFILES);
    expect(list[0].id).toBe(`P${MAX_PROFILES + 2}`);
  });

  it("withoutProfile 은 하나만 뺀다 (없는 id 는 아무 일도 아니다)", () => {
    const list = [profileOf("P1", "밤", snap), profileOf("P2", "낮", snap)];
    expect(withoutProfile(list, "P1").map((p) => p.id)).toEqual(["P2"]);
    expect(withoutProfile(list, "없음")).toHaveLength(2);
  });

  it("profileNamed 는 대소문자·앞뒤 공백을 무시한다", () => {
    const list = [profileOf("P1", "Night", snap)];
    expect(profileNamed(list, "  night ")?.id).toBe("P1");
    expect(profileNamed(list, "")).toBeUndefined();
    expect(profileNamed(list, "낮")).toBeUndefined();
  });

  it("renameProfile 은 겹치는 이름·빈 이름·없는 id·같은 이름을 거절한다", () => {
    const list = [profileOf("P1", "밤", snap), profileOf("P2", "낮", snap)];
    expect(renameProfile(list, "P1", "낮")).toBeNull();
    expect(renameProfile(list, "P1", "   ")).toBeNull();
    expect(renameProfile(list, "없음", "새 이름")).toBeNull();
    expect(renameProfile(list, "P1", "밤")).toBeNull();

    const next = renameProfile(list, "P1", "  깊은 밤  ");
    expect(next?.map((p) => p.name)).toEqual(["깊은 밤", "낮"]);
    expect(list[0].name).toBe("밤"); // 원본은 그대로
  });
});

describe("시작 화면 한 벌(startBoard — 2026-11-03)", () => {
  const snap = snapshotAppearance(settingsFixture());
  const board: StartBoardSnapshot = {
    widgets: defaultStartWidgets(),
    clock: { ...DEFAULT_CLOCK_OPTIONS, seconds: true, size: 120 },
  };
  const fileOf = (profiles: unknown[]) => JSON.stringify({ version: THEME_PROFILE_FILE_VERSION, active: null, profiles });

  it("파일 왕복 — 배치 · 시계 표시가 오간다(파일 판은 그대로 1)", () => {
    const file = serializeProfiles([{ ...profileOf("P1", "밤", snap), startBoard: board }], "P1");
    expect(file.version).toBe(1);
    const back = parseProfiles(JSON.stringify(file))!.profiles[0];
    expect(back.startBoard && sameStartBoard(back.startBoard, board)).toBe(true);
  });

  it("칸 없는 옛 프로필은 그대로 읽히고, 쓸 때도 칸을 만들지 않는다", () => {
    const back = parseProfiles(fileOf([{ id: "P1", name: "옛", savedAt: 1, appearance: {} }]))!.profiles[0];
    expect(back).not.toHaveProperty("startBoard");
    expect(serializeProfiles([back], null).profiles[0]).not.toHaveProperty("startBoard");
  });

  it("깨진 배치는 칸째 버리고(프로필은 산다), 시계 표시는 칸마다 고친다", () => {
    const broken = parseProfiles(
      fileOf([
        { id: "P1", name: "a", appearance: {}, startBoard: { widgets: [{ kind: "weather", x: 0, y: 0, w: 9, h: 9 }] } },
        { id: "P2", name: "b", appearance: {}, startBoard: "x" },
        { id: "P3", name: "c", appearance: {}, startBoard: { widgets: [], clock: { hour12: "yes", size: 9999 } } },
      ]),
    )!.profiles;
    expect(broken.map((p) => p.id)).toEqual(["P1", "P2", "P3"]);
    expect(broken[0]).not.toHaveProperty("startBoard");
    expect(broken[1]).not.toHaveProperty("startBoard");
    expect(broken[2].startBoard).toEqual({ widgets: [], clock: { ...DEFAULT_CLOCK_OPTIONS, size: 160 } });
  });

  it("배치가 달라도 (수정됨)이 아니다 — 비교는 모양만 본다", () => {
    const a = { ...profileOf("P1", "밤", snap), startBoard: board };
    const moved = withStartBoard([a], "P1", { ...board, widgets: [] })[0];
    expect(sameAppearance(moved.appearance, a.appearance)).toBe(true);
    expect(moved.startBoard?.widgets).toEqual([]);
  });

  it("withStartBoard — 그 프로필 칸만, 자리 · 저장 시각은 그대로, 없는 id 면 그대로", () => {
    const list = [profileOf("P1", "밤", snap), profileOf("P2", "낮", snap)];
    const next = withStartBoard(list, "P2", board);
    expect(next.map((p) => p.id)).toEqual(["P1", "P2"]);
    expect(next[1].savedAt).toBe(1);
    expect(next[0]).not.toHaveProperty("startBoard");
    expect(next[1].startBoard && sameStartBoard(next[1].startBoard, board)).toBe(true);
    // 담은 값은 복사본 — 나중에 배치를 고쳐도 담긴 칸이 따라 변하지 않는다
    board.widgets[0].x += 8;
    expect(next[1].startBoard!.widgets[0].x).not.toBe(board.widgets[0].x);
    board.widgets[0].x -= 8;
    expect(withStartBoard(list, "P9", board)).toEqual(list);
  });

  it("같은 목록이면 같은 문자열 — 칸 순서가 고정이다", () => {
    const shuffled: StartBoardSnapshot = {
      widgets: board.widgets.map(({ h, w, y, x, kind }) => ({ h, w, y, x, kind })),
      clock: { size: 120, date: true, seconds: true, hour12: false },
    };
    const a = JSON.stringify(serializeProfiles([{ ...profileOf("P1", "밤", snap), startBoard: board }], null));
    const b = JSON.stringify(serializeProfiles([{ ...profileOf("P1", "밤", snap), startBoard: shuffled }], null));
    expect(a).toBe(b);
  });
});
