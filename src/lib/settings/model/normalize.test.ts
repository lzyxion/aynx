// `settings/model/` 의 순수 조각(normalize · payload)을 **지금 동작 그대로** 고정한다 — 나누기 뒤 첫 안전망.
// 기대값은 코드에서 읽은 것이다(새 규칙을 만들지 않는다). payload 는 내부 전용이라 형제 경로로 직접 부른다.
import { describe, expect, it } from "vitest";
import { cloneSettings, emptySettings, normalizeMcpServers, normalizeSettings, sameSettings } from "./normalize";
import { sendSnapshot, toPayload } from "./payload";
import {
  DEFAULT_MATERIAL,
  DEFAULT_OPACITY,
  DEFAULT_TAB_STYLE,
  defaultAutomation,
  IDLE_LOCK_MAX,
  isAppIconId,
  isUserAppIconId,
  OPACITY_MAX,
  OPACITY_MIN,
} from "./options";

describe("작업안 실행 목록 정렬 `[plans] exec_sort` (2026-11-01)", () => {
  it("아는 값만 받고, 모르는 값은 버린다(= 기본 newest)", () => {
    expect(normalizeSettings({ plans: { exec_sort: "oldest" } }).plans.exec_sort).toBe("oldest");
    expect(normalizeSettings({ plans: { exec_sort: "size" } }).plans.exec_sort).toBeUndefined();
    expect(normalizeSettings({}).plans.exec_sort).toBeUndefined();
  });
});

describe("독 배치 `[dock] layout` (2026-10-23)", () => {
  it("아는 값만 받고, 기본(launcher-left)은 짐에 적지 않는다", () => {
    expect(normalizeSettings({ dock: { layout: "launcher-right" } }).dock.layout).toBe("launcher-right");
    expect(normalizeSettings({ dock: { layout: "auto" } }).dock.layout).toBeUndefined();
    const s = emptySettings();
    s.dock.layout = "launcher-left";
    expect(toPayload(s).dock).toEqual({});
    s.dock.layout = "launcher-right";
    expect(toPayload(s).dock).toEqual({ layout: "launcher-right" });
    expect(sameSettings(s, emptySettings())).toBe(false);
    expect(cloneSettings(s).dock).toEqual({ layout: "launcher-right" });
  });
});

describe("기본값 왕복", () => {
  it("빈 입력을 정규화하면 빈 설정과 같다", () => {
    expect(sameSettings(normalizeSettings(undefined), emptySettings())).toBe(true);
    expect(sameSettings(normalizeSettings({}), emptySettings())).toBe(true);
    expect(normalizeSettings(null).automation).toEqual(defaultAutomation());
  });

  it("빈 설정의 짐은 칸만 남고 자동 승인은 언제나 통째로 실린다", () => {
    expect(toPayload(emptySettings())).toEqual({
      app: {},
      terminal: {},
      shell: {},
      ai: {},
      wallpaper: {},
      triggers: [],
      keybindings: {},
      automation: defaultAutomation(),
      vault: {},
      hosts: {},
      files: {},
      projects: {},
      dock: {},
      plans: {},
      messenger: {},
      remote: {},
    });
  });

  it("고른 값은 짐 → 정규화를 지나도 같다", () => {
    const s = normalizeSettings({
      app: { accent: "#ff8800", opacity: 70, tiling: "focus", idle_lock_min: 15 },
      terminal: { theme: "tokyo-night", font_size: 16, webgl: false, notify_after_secs: 0 },
      shell: { default: "pwsh" },
      hosts: { sort: "recent" },
      automation: { auto_approve: true, allow_patterns: ["ls"], max_targets: 5 },
      messenger: { enabled: true, discord: false },
      remote: { enabled: true, port: 47900, host: "mypc.tailnet-abcd.ts.net" },
    });
    expect(sameSettings(normalizeSettings(toPayload(s)), s)).toBe(true);
  });
});

describe("[remote] 원격 관문", () => {
  it("켬만 남고 · 포트는 1~65535 정수 · 이름은 소문자로 · 빈 값은 안 정함", () => {
    expect(normalizeSettings({}).remote).toEqual({ enabled: undefined, port: undefined, host: undefined });
    expect(normalizeSettings({ remote: { enabled: false, port: 0, host: "  " } }).remote).toEqual({
      enabled: undefined,
      port: undefined,
      host: undefined,
    });
    expect(normalizeSettings({ remote: { enabled: true, port: 47821, host: " MyPC.Tailnet-AB.ts.net " } }).remote).toEqual({
      enabled: true,
      port: 47821,
      host: "mypc.tailnet-ab.ts.net",
    });
    expect(normalizeSettings({ remote: { port: 70000 } }).remote.port).toBeUndefined();
    expect(normalizeSettings({ remote: { port: 1.5 } }).remote.port).toBeUndefined();
  });

  it("저장하면 정한 칸만 실리고 왕복해도 잃지 않는다", () => {
    const s = normalizeSettings({ remote: { enabled: true, host: "mypc.tailnet-ab.ts.net" } });
    expect(toPayload(s).remote).toEqual({ enabled: true, host: "mypc.tailnet-ab.ts.net" });
    expect(toPayload(normalizeSettings({})).remote).toEqual({});
    expect(sameSettings(normalizeSettings(toPayload(s)), s)).toBe(true);
    const other = normalizeSettings({ remote: { enabled: true, host: "other.tailnet-ab.ts.net" } });
    expect(sameSettings(s, other)).toBe(false);
  });
});

describe("파일 타일 기본 보기 — 옛 값 이관 (docs/log/2026-10-07-file-tile-dolphin.md)", () => {
  it("옛 tree · navigate 는 자세히(기본)로 옮겨 칸이 빈다 — 다음 저장에서 줄이 빠진다", () => {
    for (const old of ["tree", "navigate", " tree "]) {
      const s = normalizeSettings({ files: { default_view: old } });
      expect(s.files.default_view).toBeUndefined();
      expect(toPayload(s).files).toEqual({});
    }
  });

  it("새 두 값은 그대로 · 모르는 값은 버린다", () => {
    expect(normalizeSettings({ files: { default_view: "icons" } }).files.default_view).toBe("icons");
    expect(normalizeSettings({ files: { default_view: "compact" } }).files.default_view).toBe("compact");
    expect(normalizeSettings({ files: { default_view: "details" } }).files.default_view).toBeUndefined();
    expect(normalizeSettings({ files: { default_view: "grid" } }).files.default_view).toBeUndefined();
  });
});

describe("범위 자르기", () => {
  it("크롬 불투명도는 슬라이더 범위로 자른다(0 도 하한으로 올라온다)", () => {
    expect(normalizeSettings({ app: { opacity: 0 } }).app.opacity).toBe(OPACITY_MIN);
    expect(normalizeSettings({ app: { opacity: 150 } }).app.opacity).toBe(OPACITY_MAX);
  });

  it("자동 잠금은 0 을 끔(undefined)으로 접고 켠 값은 상한으로 자른다", () => {
    expect(normalizeSettings({ app: { idle_lock_min: 0 } }).app.idle_lock_min).toBeUndefined();
    expect(normalizeSettings({ app: { idle_lock_min: 9999 } }).app.idle_lock_min).toBe(IDLE_LOCK_MAX);
  });

  it("글꼴 크기는 범위 밖이면 자르지 않고 버린다", () => {
    expect(normalizeSettings({ terminal: { font_size: 99 } }).terminal.font_size).toBeUndefined();
    expect(normalizeSettings({ terminal: { font_size: 13.6 } }).terminal.font_size).toBe(14);
  });

  it("긴 명령 알림은 0(끔)을 살리고, 짐에도 0 을 적는다", () => {
    const s = normalizeSettings({ terminal: { notify_after_secs: 0 } });
    expect(s.terminal.notify_after_secs).toBe(0);
    expect(toPayload(s).terminal.notify_after_secs).toBe(0);
  });

  it("자동 승인 상한은 범위로 자르고 비숫자는 기본값", () => {
    const a = normalizeSettings({ automation: { max_targets: 1000, max_concurrency: "x" } }).automation;
    expect(a.max_targets).toBe(100);
    expect(a.max_concurrency).toBe(defaultAutomation().max_concurrency);
  });
});

describe("모르는 값은 기본값 추종", () => {
  it("모르는 선택지 키는 undefined 로 버린다", () => {
    const s = normalizeSettings({
      app: { tiling: "zigzag", mode: "sepia", status_bar: "middle" },
      terminal: { tab_style: "hex", cursor_style: "blink", bell: "loud", theme: "no-such-preset" },
      hosts: { sort: "size" },
    });
    expect(s.app.tiling).toBeUndefined();
    expect(s.app.mode).toBeUndefined();
    expect(s.app.status_bar).toBeUndefined();
    expect(s.terminal.tab_style).toBeUndefined();
    expect(s.terminal.cursor_style).toBeUndefined();
    expect(s.terminal.bell).toBeUndefined();
    expect(s.terminal.theme).toBeUndefined();
    expect(s.hosts.sort).toBeUndefined();
  });

  it.each(["powerline", "slant"])("뺀 탭 모양 %s 은 오류 없이 기본(pill)으로 떨어진다", (old) => {
    // 2026-10-01(powerline) · 2026-10-24(slant)에 뺀 값 — 옛 settings.toml·테마 프로필(적용 때 이 정규화를
    // 지난다)에 남아 있을 수 있다 (docs/log/2026-10-01-design-defaults.md).
    const s = normalizeSettings({ terminal: { tab_style: old } });
    expect(s.terminal.tab_style).toBeUndefined();
    expect(DEFAULT_TAB_STYLE).toBe("pill");
    expect(toPayload(s).terminal).toEqual({});
  });

  it("재질은 모르는 값을 버리고(= glass), 기본 glass 는 파일에 적지 않으며 flat 만 남긴다", () => {
    // 2026-10-11 — `[app] material`. 색과 독립된 축이고 기본은 글래스다.
    expect(DEFAULT_MATERIAL).toBe("glass");
    expect(normalizeSettings({ app: { material: "metal" } }).app.material).toBeUndefined();
    expect(toPayload(normalizeSettings({ app: { material: "glass" } })).app).toEqual({});
    expect(toPayload(normalizeSettings({ app: { material: "flat" } })).app).toEqual({ material: "flat" });
  });

  it("뺀 신호 모양 signal_style 은 오류 없이 버려진다", () => {
    // 2026-10-01 에 뺀 설정 — 옛 settings.toml·테마 프로필에 남아 있을 수 있다
    // (docs/log/2026-10-01-agent-status-three.md).
    const s = normalizeSettings({ app: { signal_style: "grid", status_bar: "top" } });
    expect("signal_style" in s.app).toBe(false);
    expect(s.app.status_bar).toBe("top");
    expect(toPayload(s).app).toEqual({ status_bar: "top" });
  });

  it("셸 id 는 목록과 맞춰 보지 않고 살려 둔다", () => {
    expect(normalizeSettings({ shell: { default: "wsl:Gone" } }).shell.default).toBe("wsl:Gone");
  });
});

describe("복사·비교", () => {
  it("sameSettings 는 칸 하나의 변경을 알아챈다", () => {
    const a = normalizeSettings({ app: { accent: "#123456" } });
    const b = cloneSettings(a);
    expect(sameSettings(a, b)).toBe(true);
    b.app.accent = "#654321";
    expect(sameSettings(a, b)).toBe(false);
  });

  it("cloneSettings 는 배열 안쪽까지 새로 만든다([취소] 가 성립한다)", () => {
    const a = normalizeSettings({
      triggers: [{ pattern: "ERR", bg: "#6b4a17", enabled: true }],
      automation: { allow: [{ exec: "git", subcommands: ["status"] }] },
    });
    const b = cloneSettings(a);
    b.triggers[0].pattern = "WARN";
    b.automation.allow[0].subcommands.push("log");
    expect(a.triggers[0].pattern).toBe("ERR");
    expect(a.automation.allow[0].subcommands).toEqual(["status"]);
    expect(sameSettings(a, b)).toBe(false);
  });
});

describe("짐 — 기본값은 파일에 적지 않는다", () => {
  it("기본값과 같은 칸은 빠지고 다른 칸만 남는다", () => {
    const p = toPayload(
      normalizeSettings({
        app: {
          opacity: DEFAULT_OPACITY,
          mode: "dark",
          tile_header: "always",
          status_bar: "left",
        },
        terminal: { webgl: true, confirm_multiline_paste: false, cursor_style: "block", bell: "off" },
        wallpaper: { dim: 40, blur: 0, fit: "cover" },
      }),
    );
    expect(p.app).toEqual({});
    expect(p.terminal).toEqual({ confirm_multiline_paste: false, bell: "off" });
    expect(p.wallpaper).toEqual({});
  });

  it("기본이 아닌 Light·상단 상태바·flat 탭은 파일에 남는다", () => {
    const p = toPayload(
      normalizeSettings({
        app: { mode: "light", status_bar: "top" },
        terminal: { tab_style: "flat" },
      }),
    );
    expect(p.app).toEqual({ mode: "light", status_bar: "top" });
    expect(p.terminal).toEqual({ tab_style: "flat" });
  });
});


describe("외부 MCP 서버 설정", () => {
  it("프로젝트 범위·환경변수 참조는 왕복하고 값은 설정에서 제거한다", () => {
    const s = normalizeSettings({ ai: { mcp_servers: [
      { name: "postgres", enabled: true, transport: "stdio", command: "npx", project_id: "p1", env: [{ name: "DATABASE_URL", secret_ref: "p1/db:ref", value: "plaintext" }] },
    ] } });
    expect(JSON.stringify(toPayload(s))).not.toContain("plaintext");
    expect(sameSettings(s, normalizeSettings(toPayload(s)))).toBe(true);
    const draft = cloneSettings(s);
    draft.ai.mcp_servers![0].env![0].secret_ref = "new-reference";
    expect(s.ai.mcp_servers![0].env![0].secret_ref).toBe("p1/db:ref");
    expect(sameSettings(s, draft)).toBe(false);
    const moved = cloneSettings(s);
    moved.ai.mcp_servers![0].project_id = "p2";
    expect(sameSettings(s, moved)).toBe(false);
    const removed = cloneSettings(s);
    removed.ai.mcp_servers![0].env = [];
    expect(sameSettings(s, removed)).toBe(false);
  });

  const servers = [
    { name: "playwright", enabled: true, transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp", "folder with spaces"] },
    { name: "docs", enabled: false, transport: "http", url: "https://example.com/mcp" },
  ];

  it("켜기·끄기·종류·공백 있는 인자는 저장 왕복을 지나도 그대로다", () => {
    const s = normalizeSettings({ ai: { mcp_servers: servers } });
    expect(toPayload(s).ai.mcp_servers).toEqual(servers);
    expect(sameSettings(normalizeSettings(toPayload(s)), s)).toBe(true);
  });

  it("안쪽 인자까지 복사하고 켬/끔·이름·값 변경을 미저장으로 알아챈다", () => {
    const a = normalizeSettings({ ai: { mcp_servers: servers } });
    const b = cloneSettings(a);
    b.ai.mcp_servers![0].args!.push("--headless");
    expect(a.ai.mcp_servers![0].args).toEqual(servers[0].args);
    expect(sameSettings(a, b)).toBe(false);
    for (const patch of [{ enabled: false }, { name: "other" }, { command: "node" }, { transport: "http" as const }]) {
      const changed = cloneSettings(a);
      Object.assign(changed.ai.mcp_servers![0], patch);
      expect(sameSettings(a, changed)).toBe(false);
    }
    const changed = cloneSettings(a);
    changed.ai.mcp_servers![1].url = "https://other.example/mcp";
    expect(sameSettings(a, changed)).toBe(false);
  });

  it("구조가 틀린 항목만 버리고 목록이 비면 파일에 적지 않는다", () => {
    const s = normalizeSettings({ ai: { mcp_servers: [null, { name: "bad", enabled: true, transport: "stdio", command: "npx", args: [123] }, ...servers] } });
    expect(s.ai.mcp_servers).toEqual(servers);
    expect(toPayload(normalizeSettings({ ai: { mcp_servers: [] } })).ai.mcp_servers).toBeUndefined();
  });
});

describe("외부 MCP 대상 에이전트", () => {
  it("1차 항목은 agents 없이 남고 명시한 대상·빈 목록·모르는 id 는 왕복한다", () => {
    const servers = [
      { name: "legacy", enabled: false, transport: "http", url: "https://example.com/mcp" },
      { name: "claude", enabled: true, agents: ["claude", "unknown"], transport: "http", url: "https://example.com/mcp" },
      { name: "off", enabled: true, agents: [], transport: "http", url: "https://example.com/mcp" },
    ];
    const s = normalizeSettings({ ai: { mcp_servers: servers } });
    expect(toPayload(s).ai.mcp_servers).toEqual(servers);
    expect(sameSettings(normalizeSettings(toPayload(s)), s)).toBe(true);
    const clone = cloneSettings(s);
    clone.ai.mcp_servers![1].agents!.push("codex");
    expect(s.ai.mcp_servers![1].agents).toEqual(["claude", "unknown"]);
    expect(sameSettings(s, clone)).toBe(false);
  });

  it("agents 자료형이 다른 항목만 버린다", () => {
    const good = { name: "good", enabled: true, agents: ["codex"], transport: "http", url: "https://example.com/mcp" };
    const s = normalizeSettings({ ai: { mcp_servers: [
      { ...good, name: "bad", agents: "claude" },
      { ...good, name: "bad-array", agents: [123] }, good,
    ] } });
    expect(s.ai.mcp_servers).toEqual([good]);
  });
});

describe("세션 MCP 다음 실행 설정", () => {
  it("기본값은 생략하고 꺼짐·빈 대상·한 대상은 왕복한다", () => {
    const defaults = normalizeSettings({ ai: { mcp_sessions_enabled: true, mcp_sessions_agents: ["codex", "claude"] } });
    expect(toPayload(defaults).ai).toEqual({});
    expect(sameSettings(defaults, emptySettings())).toBe(true);
    for (const agents of [[], ["claude"], ["codex"], ["unknown"]]) {
      const s = normalizeSettings({ ai: { mcp_sessions_enabled: false, mcp_sessions_agents: agents } });
      expect(toPayload(s).ai).toEqual({ mcp_sessions_enabled: false, mcp_sessions_agents: agents });
      expect(sameSettings(s, normalizeSettings(toPayload(s)))).toBe(true);
    }
  });

  it("대상 초안을 깊게 복사하고 미저장 변경을 판정한다", () => {
    const saved = normalizeSettings({ ai: { mcp_sessions_agents: ["claude"] } });
    const draft = cloneSettings(saved);
    draft.ai.mcp_sessions_agents!.push("codex");
    expect(saved.ai.mcp_sessions_agents).toEqual(["claude"]);
    expect(sameSettings(saved, draft)).toBe(false);
    const disabled = cloneSettings(saved);
    disabled.ai.mcp_sessions_enabled = false;
    expect(sameSettings(saved, disabled)).toBe(false);
    expect(normalizeSettings({ ai: { mcp_sessions_agents: "claude" } }).ai.mcp_sessions_agents).toBeUndefined();
  });
});

describe("끈 에이전트 (`[ai] disabled_agents`)", () => {
  it("공백·빈 값·중복을 걸러 내고 모르는 id 는 남긴다 · 비면 안 정함", () => {
    expect(normalizeSettings({ ai: { disabled_agents: [" codex ", "", "codex", "gemini", 3] } }).ai.disabled_agents)
      .toEqual(["codex", "gemini"]);
    expect(normalizeSettings({ ai: { disabled_agents: [] } }).ai.disabled_agents).toBeUndefined();
    expect(normalizeSettings({ ai: { disabled_agents: "codex" } }).ai.disabled_agents).toBeUndefined();
  });

  it("비면 파일에 안 적히고, 끈 것이 있으면 적힌다", () => {
    expect(toPayload(normalizeSettings({})).ai.disabled_agents).toBeUndefined();
    expect(toPayload(normalizeSettings({ ai: { disabled_agents: ["codex"] } })).ai.disabled_agents).toEqual(["codex"]);
  });

  it("복사는 배열을 새로 만들고 비교는 바뀐 것을 알아챈다([취소] 가 성립한다)", () => {
    const a = normalizeSettings({ ai: { disabled_agents: ["codex"] } });
    const b = cloneSettings(a);
    expect(sameSettings(a, b)).toBe(true);
    b.ai.disabled_agents!.push("claude");
    expect(a.ai.disabled_agents).toEqual(["codex"]);
    expect(sameSettings(a, b)).toBe(false);
    expect(sameSettings(normalizeSettings({}), normalizeSettings({ ai: { disabled_agents: [] } }))).toBe(true);
  });
});

describe("HTTP MCP 비밀 헤더", () => {
  it("헤더 참조만 왕복하고 깊은 복사·취소 비교에서 평문 값을 제거한다", () => {
    const saved = normalizeSettings({ ai: { mcp_servers: [{
      name: "remote", enabled: true, transport: "http", url: "https://example.com/mcp",
      headers: [{ name: "Authorization", secret_ref: "global/remote/header:Authorization:ref", value: "header-plaintext" }],
    }] } });
    expect(JSON.stringify(toPayload(saved))).not.toContain("header-plaintext");
    expect(sameSettings(saved, normalizeSettings(toPayload(saved)))).toBe(true);
    const draft = cloneSettings(saved);
    draft.ai.mcp_servers![0].headers![0].secret_ref = "replacement";
    expect(saved.ai.mcp_servers![0].headers![0].secret_ref).toBe("global/remote/header:Authorization:ref");
    expect(sameSettings(saved, draft)).toBe(false);
    const renamed = cloneSettings(saved);
    renamed.ai.mcp_servers![0].headers![0].name = "X-Api-Key";
    expect(sameSettings(saved, renamed)).toBe(false);
    const removed = cloneSettings(saved);
    removed.ai.mcp_servers![0].headers = [];
    expect(sameSettings(saved, removed)).toBe(false);
    expect(normalizeSettings({ ai: { mcp_servers: [{ name: "bad", enabled: true,
      transport: "http", url: "https://example.com/mcp", headers: [{ name: "Authorization", secret_ref: 123 }],
    }] } }).ai.mcp_servers).toBeUndefined();
  });
});

describe("옛 프리셋 키 (`canonicalPreset` — 걷은 Luna 프리셋)", () => {
  it("`theme` · `before-theme` 의 옛 키는 읽을 때 지금 키로 접히고 다음 저장에 새 값이 실린다", () => {
    const s = normalizeSettings({
      terminal: { theme: "luna-light", dynamic: { background: "#101014", "before-theme": "luna-dark" } },
    });
    expect(s.terminal.theme).toBe("aynx-light");
    expect(s.terminal.dynamic?.["before-theme"]).toBe("aynx-dark");
    const payload = toPayload(s);
    expect(payload.terminal.theme).toBe("aynx-light");
    expect((payload.terminal.dynamic as Record<string, string> | undefined)?.["before-theme"]).toBe("aynx-dark");
  });

  it("걷은 Cyberpunk 프리셋(2026-10-24)은 버려지지 않고 같은 모드의 AYNX 로 접힌다", () => {
    expect(normalizeSettings({ terminal: { theme: "cyber-neon-light" } }).terminal.theme).toBe("aynx-light");
    expect(normalizeSettings({ terminal: { theme: "cyber-2077-dark" } }).terminal.theme).toBe("aynx-dark");
  });

  it("걷은 짝 없는 `light` 프리셋(2026-10-24)은 `theme` · `before-theme` 모두 AYNX Light 로 접힌다", () => {
    const s = normalizeSettings({
      terminal: { theme: "light", dynamic: { background: "#101014", "before-theme": "light" } },
    });
    expect(s.terminal.theme).toBe("aynx-light");
    expect(s.terminal.dynamic?.["before-theme"]).toBe("aynx-light");
  });
});

describe("고정 밝기 가상 키 (`dynamic-dark` · `dynamic-light`)", () => {
  const map = { background: "#101014", foreground: "#e0e0e0" };
  it("팔레트 맵이 있을 때만 통과하고 저장에도 실린다 — 맵이 없거나 반쯤 비면 버린다", () => {
    for (const key of ["dynamic-dark", "dynamic-light"]) {
      const s = normalizeSettings({ terminal: { theme: key, dynamic: map } });
      expect(s.terminal.theme).toBe(key);
      expect(toPayload(s).terminal.theme).toBe(key);
      expect(normalizeSettings({ terminal: { theme: key } }).terminal.theme).toBeUndefined();
      expect(normalizeSettings({ terminal: { theme: key, dynamic: { background: "#101014" } } }).terminal.theme)
        .toBeUndefined();
    }
  });

  it("옛 키 `dynamic`(밝기 따름)은 맵 밝기의 고정 키로 옮긴다 · 맵이 없으면 버린다", () => {
    expect(normalizeSettings({ terminal: { theme: "dynamic", dynamic: map } }).terminal.theme).toBe("dynamic-dark");
    const light = { background: "#f4f4f2", foreground: "#2a2a2e" };
    expect(normalizeSettings({ terminal: { theme: "dynamic", dynamic: light } }).terminal.theme).toBe("dynamic-light");
    expect(normalizeSettings({ terminal: { theme: "dynamic" } }).terminal.theme).toBeUndefined();
  });

  it("옛 상대 키 `dynamic-alt` 는 맵의 반대 밝기 고정 키로 옮긴다 · 맵이 없으면 버린다", () => {
    expect(normalizeSettings({ terminal: { theme: "dynamic-alt", dynamic: map } }).terminal.theme).toBe("dynamic-light");
    const light = { background: "#f4f4f2", foreground: "#2a2a2e" };
    expect(normalizeSettings({ terminal: { theme: "dynamic-alt", dynamic: light } }).terminal.theme).toBe("dynamic-dark");
    expect(normalizeSettings({ terminal: { theme: "dynamic-alt" } }).terminal.theme).toBeUndefined();
  });
});

describe("사용자 터미널 테마 키 (`user:<id>`)", () => {
  it("모양이 맞으면 파일 유무와 상관없이 보존되고 저장에도 실린다", () => {
    const s = normalizeSettings({ terminal: { theme: "user:tokyo-night-2" } });
    expect(s.terminal.theme).toBe("user:tokyo-night-2");
    expect(toPayload(s).terminal.theme).toBe("user:tokyo-night-2");
  });
  it("모양이 틀린 키는 다른 모르는 키처럼 버린다", () => {
    for (const bad of ["user:", "user:Tokyo", "user:../x", "user:a/b"]) {
      expect(normalizeSettings({ terminal: { theme: bad } }).terminal.theme, bad).toBeUndefined();
    }
  });
});

describe("앱 아이콘 (`[app] app_icon`)", () => {
  it("아는 id 는 남고 모르는 값·빈 값은 버린다 = 기본(gpt) 추종", () => {
    expect(normalizeSettings({ app: { app_icon: "gpt" } }).app.app_icon).toBe("gpt");
    // 10-22 에 걷은 옛 내장 id 는 모르는 값 — 기본(gpt)으로 접힌다.
    for (const old of ["luna", "aoi", "hikari", "sumire"]) {
      expect(normalizeSettings({ app: { app_icon: old } }).app.app_icon, old).toBeUndefined();
    }
    expect(normalizeSettings({ app: { app_icon: "nobody" } }).app.app_icon).toBeUndefined();
    expect(normalizeSettings({ app: { app_icon: "" } }).app.app_icon).toBeUndefined();
    expect(normalizeSettings({ app: { app_icon: 3 } }).app.app_icon).toBeUndefined();
  });

  it("기본(gpt)은 파일에 적지 않고, 고른 캐릭터는 적는다", () => {
    expect(toPayload(normalizeSettings({ app: { app_icon: "gpt" } })).app.app_icon).toBeUndefined();
    expect(toPayload(normalizeSettings({ app: { app_icon: "grok" } })).app.app_icon).toBe("grok");
  });

  it("사용자 아이콘 id(`user-<12hex>`)는 모양만 맞으면 남고 파일에 적힌다 — 틀린 모양은 버린다", () => {
    expect(normalizeSettings({ app: { app_icon: "user-0123456789ab" } }).app.app_icon).toBe("user-0123456789ab");
    expect(toPayload(normalizeSettings({ app: { app_icon: "user-0123456789ab" } })).app.app_icon).toBe("user-0123456789ab");
    for (const bad of ["user-", "user-0123456789AB", "user-0123456789abc", "user-../../vault", "user-0123456789ab.png"]) {
      expect(normalizeSettings({ app: { app_icon: bad } }).app.app_icon, bad).toBeUndefined();
    }
    expect(isUserAppIconId("user-0123456789ab")).toBe(true);
    expect(isUserAppIconId("gpt")).toBe(false);
    expect(isAppIconId("gpt")).toBe(true);
    expect(isAppIconId("luna")).toBe(false);
    expect(isAppIconId("user-0123456789ab")).toBe(true);
    expect(isAppIconId("toString")).toBe(false);
  });

  it("값이 다르면 다른 설정이다", () => {
    const a = normalizeSettings({ app: { app_icon: "claude" } });
    expect(sameSettings(a, normalizeSettings({ app: { app_icon: "gemini" } }))).toBe(false);
    expect(sameSettings(a, cloneSettings(a))).toBe(true);
  });
});

describe("저장 스냅샷", () => {
  it("보내는 동안 생긴 편집은 돌려받은 사본에 없고 dirty 로 남는다", async () => {
    const current = emptySettings();
    current.app.accent = "#111111";
    let sent: unknown;
    const saved = await sendSnapshot(current, async (payload) => {
      sent = payload;
      current.app.accent = "#222222"; // 저장을 기다리는 사이의 편집
    });
    expect(sent).toEqual(toPayload({ ...emptySettings(), app: { accent: "#111111" } }));
    expect(saved.app.accent).toBe("#111111");
    expect(sameSettings(current, saved)).toBe(false);
  });

  it("편집이 없으면 돌려받은 사본은 지금 값과 같다", async () => {
    const current = emptySettings();
    current.terminal.font_size = 15;
    expect(sameSettings(current, await sendSnapshot(current, async () => {}))).toBe(true);
  });

  it("보내기가 실패하면 그대로 던진다", async () => {
    await expect(sendSnapshot(emptySettings(), async () => Promise.reject(new Error("디스크")))).rejects.toThrow("디스크");
  });
});

describe("③-4 — 트레이 · 메신저 작업안 결과", () => {
  it("머리줄 칩 — 기본이면 파일에 안 남고, 끈 칩·바꾼 순서만 남는다 · 옛 resource_chip=false 는 끈 칩으로 옮긴다", () => {
    const s = normalizeSettings({});
    expect(s.app.header_chip_order).toBeUndefined();
    expect(s.app.header_chips_hidden).toBeUndefined();
    expect(toPayload(s).app.header_chip_order).toBeUndefined();
    expect(toPayload(s).app.header_chips_hidden).toBeUndefined();
    // 기본 순서를 그대로 적어 둔 파일은 접힌다
    const def = ["folder", "branch", "jump", "tmux", "forward", "resource", "ai"];
    expect(normalizeSettings({ app: { header_chip_order: def } }).app.header_chip_order).toBeUndefined();
    // 10-18 의 기본(`ai_read` 가 든 순서)은 `ai` 로 합쳐져 10-23 전의 기본이 되고, 그것도 지금의 기본으로 접힌다
    const oldDef = ["folder", "branch", "tmux", "jump", "forward", "ai", "ai_read", "resource"];
    expect(normalizeSettings({ app: { header_chip_order: oldDef } }).app.header_chip_order).toBeUndefined();
    // 옛 id 가 없는 10-23 전 기본 순서는 바꾼 순서로 남는다(앱은 그때 기본을 적지 않았다 — 지금 일부러 고른 순서)
    const prev = ["folder", "branch", "tmux", "jump", "forward", "ai", "resource"];
    expect(normalizeSettings({ app: { header_chip_order: prev } }).app.header_chip_order).toEqual(prev);
    // 바꾼 순서 — 모르는 id 를 버리고 빠진 칩을 끼운다
    const moved = normalizeSettings({ app: { header_chip_order: ["ai", "nope", "folder"] } });
    expect(moved.app.header_chip_order).toEqual(["ai", "folder", "branch", "jump", "tmux", "forward", "resource"]);
    expect(toPayload(moved).app.header_chip_order).toEqual(moved.app.header_chip_order);
    // 끈 칩
    const hid = normalizeSettings({ app: { header_chips_hidden: ["resource", "x", "jump", "jump"] } });
    expect(hid.app.header_chips_hidden).toEqual(["jump", "resource"]);
    expect(toPayload(hid).app.header_chips_hidden).toEqual(["jump", "resource"]);
    expect(normalizeSettings({ app: { header_chips_hidden: [] } }).app.header_chips_hidden).toBeUndefined();
    // 옛 키 이사
    const old = normalizeSettings({ app: { resource_chip: false } });
    expect(old.app.resource_chip).toBeUndefined();
    expect(old.app.header_chips_hidden).toEqual(["resource"]);
    expect(toPayload(old).app.resource_chip).toBeUndefined();
    expect(normalizeSettings({ app: { resource_chip: true } }).app.header_chips_hidden).toBeUndefined();
    // 비교 · 복사
    expect(sameSettings(hid, emptySettings())).toBe(false);
    expect(sameSettings(moved, emptySettings())).toBe(false);
    const copy = cloneSettings(hid);
    copy.app.header_chips_hidden!.push("ai");
    expect(hid.app.header_chips_hidden).toEqual(["jump", "resource"]);
  });

  it("옛 `ai_read` 칩(10-23 합침)은 `ai` 로 옮기고 다시 적지 않는다 — 자리는 `ai` 가 이기고 · 켬끔은 하나라도 켜졌으면 켬", () => {
    const norm = (app: Record<string, unknown>) => normalizeSettings({ app }).app;
    // `ai` 의 자리가 이긴다(`ai_read` 는 버림)
    expect(norm({ header_chip_order: ["resource", "ai_read", "folder", "ai"] }).header_chip_order).toEqual([
      "resource",
      "folder",
      "branch",
      "jump",
      "tmux",
      "forward",
      "ai",
    ]);
    // `ai` 가 순서에 없으면 `ai_read` 의 자리에
    expect(norm({ header_chip_order: ["ai_read", "folder"] }).header_chip_order).toEqual([
      "ai",
      "folder",
      "branch",
      "jump",
      "tmux",
      "forward",
      "resource",
    ]);
    // 켬끔 — 둘 다 껐을 때만 끔
    expect(norm({ header_chips_hidden: ["ai", "ai_read", "jump"] }).header_chips_hidden).toEqual(["jump", "ai"]);
    expect(norm({ header_chips_hidden: ["ai_read"] }).header_chips_hidden).toBeUndefined();
    expect(norm({ header_chips_hidden: ["ai_read", "resource"] }).header_chips_hidden).toEqual(["resource"]);
    // 옛 파일임이 순서로 드러나면(순서에 `ai_read`) `ai` 만 끈 것도 켬 — 로컬 칩이 켜져 있었다
    expect(norm({ header_chip_order: ["ai_read", "ai"], header_chips_hidden: ["ai"] }).header_chips_hidden).toBeUndefined();
    // 새 파일(`ai_read` 없음)의 `ai` 끔은 그대로 끔
    expect(norm({ header_chips_hidden: ["ai"] }).header_chips_hidden).toEqual(["ai"]);
    // 다시 적지 않는다 — 내보내는 값에 `ai_read` 가 없다
    const s = normalizeSettings({ app: { header_chip_order: [" ai_read ", "folder"], header_chips_hidden: ["ai_read", "ai"] } });
    const out = JSON.stringify(toPayload(s).app);
    expect(out).not.toContain("ai_read");
    expect(s.app.header_chips_hidden).toEqual(["ai"]);
    // 이상한 값에도 죽지 않는다
    expect(() => norm({ header_chip_order: "ai_read", header_chips_hidden: 3 })).not.toThrow();
    // (아는 것이 `ai` 하나뿐이면 기본 순서로 접힌다)
    expect(norm({ header_chip_order: [1, null, "ai_read"], header_chips_hidden: [null] }).header_chip_order).toBeUndefined();
  });

  it("resource_rings 는 끌 때만 파일에 남고(기본 켬) 정규화가 불리언만 받는다", () => {
    const s = emptySettings();
    expect(toPayload(s).app.resource_rings).toBeUndefined();
    s.app.resource_rings = false;
    expect(toPayload(s).app.resource_rings).toBe(false);
    expect(normalizeSettings({ app: { resource_rings: 1 } }).app.resource_rings).toBeUndefined();
    expect(sameSettings(normalizeSettings({ app: { resource_rings: false } }), emptySettings())).toBe(false);
  });

  it("files.auto_refresh 는 끌 때만 파일에 남고(기본 켬) 정규화가 불리언만 받는다", () => {
    const s = emptySettings();
    expect(toPayload(s).files.auto_refresh).toBeUndefined();
    s.files.auto_refresh = false;
    expect(toPayload(s).files.auto_refresh).toBe(false);
    s.files.auto_refresh = true;
    expect(toPayload(s).files.auto_refresh).toBeUndefined();
    expect(normalizeSettings({ files: { auto_refresh: false } }).files.auto_refresh).toBe(false);
    expect(normalizeSettings({ files: { auto_refresh: "no" } }).files.auto_refresh).toBeUndefined();
    expect(sameSettings(normalizeSettings({ files: { auto_refresh: false } }), emptySettings())).toBe(false);
  });

  it("tray_on_close 는 끌 때만 파일에 남고(기본 켬) 정규화가 불리언만 받는다", () => {
    const s = emptySettings();
    expect(toPayload(s).app.tray_on_close).toBeUndefined();
    s.app.tray_on_close = false;
    expect(toPayload(s).app.tray_on_close).toBe(false);
    s.app.tray_on_close = true;
    expect(toPayload(s).app.tray_on_close).toBeUndefined();
    expect(normalizeSettings({ app: { tray_on_close: false } }).app.tray_on_close).toBe(false);
    expect(normalizeSettings({ app: { tray_on_close: "no" } }).app.tray_on_close).toBeUndefined();
    expect(sameSettings(normalizeSettings({ app: { tray_on_close: false } }), emptySettings())).toBe(false);
  });

  it("messenger.operation_pending · include_summary 는 끌 때만 남는다(승인 요약)", () => {
    const s = normalizeSettings({});
    expect(toPayload(s).messenger?.operation_pending).toBeUndefined();
    s.messenger.operation_pending = false;
    s.messenger.include_summary = false;
    expect(toPayload(s).messenger).toMatchObject({ operation_pending: false, include_summary: false });
    expect(normalizeSettings({ messenger: { operation_pending: false } }).messenger.operation_pending).toBe(false);
    expect(normalizeSettings({ messenger: { include_summary: "no" } }).messenger.include_summary).toBeUndefined();
  });

  it("messenger.operation_results 는 끌 때만 남는다", () => {
    const s = emptySettings();
    s.messenger.operation_results = false;
    expect(toPayload(s).messenger?.operation_results).toBe(false);
    expect(normalizeSettings({ messenger: { operation_results: false } }).messenger.operation_results).toBe(false);
  });
});

describe("외부 MCP 서버의 사이드 채팅 칸 (2026-10-25)", () => {
  const stdio = { name: "fs", enabled: true, transport: "stdio", command: "npx", args: ["-y", "fs"] };
  const http = { name: "web", enabled: true, transport: "http", url: "https://example.com/mcp" };

  it("normalizeMcpServers 는 side_chat · side_chat_no_ask 를 남긴다(stdio · http)", () => {
    expect(normalizeMcpServers([{ ...stdio, side_chat: true, side_chat_no_ask: true }])?.[0]).toMatchObject({ side_chat: true, side_chat_no_ask: true });
    expect(normalizeMcpServers([{ ...http, side_chat: true }])?.[0]).toMatchObject({ side_chat: true });
    expect(normalizeMcpServers([{ ...http, side_chat: true }])?.[0]).not.toHaveProperty("side_chat_no_ask");
  });

  it("불리언이 아니거나 거짓이면 버린다", () => {
    const [server] = normalizeMcpServers([{ ...stdio, side_chat: "yes", side_chat_no_ask: 1 }]) ?? [];
    expect(server).not.toHaveProperty("side_chat");
    expect(server).not.toHaveProperty("side_chat_no_ask");
    expect(normalizeMcpServers([{ ...stdio, side_chat: false }])?.[0]).not.toHaveProperty("side_chat");
  });

  it("사이드 채팅 없이 묻지 않기만 있으면 버린다", () => {
    expect(normalizeMcpServers([{ ...stdio, side_chat_no_ask: true }])?.[0]).not.toHaveProperty("side_chat_no_ask");
  });

  it("설정 왕복(normalize → payload → normalize)에서 살아남는다", () => {
    const s = normalizeSettings({ ai: { mcp_servers: [{ ...stdio, side_chat: true, side_chat_no_ask: true }] } });
    expect(toPayload(s).ai?.mcp_servers?.[0]).toMatchObject({ side_chat: true, side_chat_no_ask: true });
    expect(sameSettings(normalizeSettings(toPayload(s)), s)).toBe(true);
  });

  it("sameSettings 는 사이드 채팅 칸만 바뀐 것도 알아챈다(없음 = 끔)", () => {
    const a = normalizeSettings({ ai: { mcp_servers: [stdio] } });
    const b = cloneSettings(a);
    b.ai.mcp_servers![0] = { ...b.ai.mcp_servers![0], side_chat: false };
    expect(sameSettings(a, b)).toBe(true);
    b.ai.mcp_servers![0] = { ...b.ai.mcp_servers![0], side_chat: true };
    expect(sameSettings(a, b)).toBe(false);
    const c = cloneSettings(b);
    c.ai.mcp_servers![0] = { ...c.ai.mcp_servers![0], side_chat_no_ask: true };
    expect(sameSettings(b, c)).toBe(false);
  });
});

describe("AI 아이콘 모양 · CLI 별 아바타 `[ai] icon_style` · `avatar_*` (2026-10-31)", () => {
  it("옛 `loading_art = character` 는 `icon_style = avatar` 로 옮기고 옛 칸은 싣지 않는다 — 새 칸이 있으면 새 칸이 이긴다", () => {
    const moved = normalizeSettings({ ai: { loading_art: "character" } });
    expect(moved.ai.icon_style).toBe("avatar");
    expect(moved.ai.loading_art).toBeUndefined();
    expect(toPayload(moved).ai).toEqual({ icon_style: "avatar" });
    expect(normalizeSettings({ ai: { loading_art: "logo" } }).ai.icon_style).toBeUndefined();
    expect(normalizeSettings({ ai: { icon_style: "logo", loading_art: "character" } }).ai.icon_style).toBe("logo");
    expect(normalizeSettings({ ai: { icon_style: "emoji" } }).ai.icon_style).toBeUndefined();
  });

  it("기본(logo)은 짐에 적지 않는다", () => {
    expect(toPayload(normalizeSettings({ ai: { icon_style: "logo" } })).ai).toEqual({});
  });

  it("아바타 칸은 앱 아이콘 id 모양만 받고, 기본(claude · gpt)과 같으면 비운다", () => {
    const s = normalizeSettings({ ai: { avatar_claude: " grok ", avatar_codex: "user-0123456789ab" } });
    expect(s.ai.avatar_claude).toBe("grok");
    expect(s.ai.avatar_codex).toBe("user-0123456789ab");
    expect(toPayload(s).ai).toEqual({ avatar_claude: "grok", avatar_codex: "user-0123456789ab" });
    const d = normalizeSettings({ ai: { avatar_claude: "claude", avatar_codex: "gpt" } });
    expect(d.ai.avatar_claude).toBeUndefined();
    expect(d.ai.avatar_codex).toBeUndefined();
    for (const bad of ["luna", "user-../../x", "user:0123456789ab", ""]) {
      expect(normalizeSettings({ ai: { avatar_claude: bad } }).ai.avatar_claude, bad).toBeUndefined();
    }
    expect(sameSettings(s, normalizeSettings({ ai: { avatar_claude: "gemini", avatar_codex: "user-0123456789ab" } }))).toBe(false);
    expect(sameSettings(s, cloneSettings(s))).toBe(true);
  });
});
