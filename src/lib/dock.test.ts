import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adjacentSegment,
  normalizeLauncherSegment,
  clampDockWidth,
  CHAT_DOCK_SPEC,
  clampChatDockWidth,
  readChatDockWidth,
  normalizeChatDockSection,
  readChatDockSection,
  writeChatDockSection,
  writeChatDockWidth,
  DEFAULT_LAUNCHER_SEGMENT,
  DOCK_ACTION_ICONS,
  DOCK_LEGACY_STORE_KEY,
  DOCK_TOOLS,
  EDGE_AFTER_CLOSE,
  EDGE_BAND_PX,
  EDGE_DWELL_MS,
  EDGE_IDLE,
  edgeHoverDue,
  edgeHoverMove,
  inEdgeStrip,
  sideEdgeStrip,
  DEFAULT_DOCK_LAYOUT,
  dockSides,
  oppositeSide,
  DOCK_SPEC,
  DOCK_STORE_KEY,
  dockSlotOf,
  isLauncherKind,
  LAUNCHER_SEGMENTS,
  readDockWidth,
  writeDockWidth,
} from "$lib/dock";
import { ACTIONS } from "$lib/keybindings";
import { UI_ICONS } from "$lib/ui-icons.generated";
import { translate } from "$lib/i18n/dict";

/**
 * 독 폭의 규칙 — **종류별** 경계값과 **저장소가 던질 때**.
 *
 * 저장 실패를 굳이 시험하는 이유는 그 자리가 조용하기 때문이다: `localStorage` 는 사생활
 * 보호 모드·저장소 차단에서 `getItem` 만으로도 던지는데, 그때 폭 하나 때문에 독이 통째로
 * 안 뜨면 원인을 화면에서 읽을 길이 없다.
 */

/** node 환경에는 `localStorage` 가 없다 — 케이스마다 손으로 심고 지운다 */
function stubStorage(impl: Partial<Storage>): void {
  vi.stubGlobal("localStorage", impl as Storage);
}

/** 키 → 값 표를 그대로 흉내 내는 저장소 (읽고 합쳐 쓰는 규칙을 보려면 이게 필요하다) */
function memoryStorage(seed: Record<string, string> = {}): {
  store: Record<string, string>;
  impl: Partial<Storage>;
} {
  const store = { ...seed };
  return {
    store,
    impl: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clampDockWidth", () => {
  it("종류마다 최소 폭이 다르다 — 설정은 두 칸 구조라 훨씬 넓다", () => {
    expect(clampDockWidth("hosts", 10, 1600)).toBe(DOCK_SPEC.hosts.min);
    expect(clampDockWidth("hosts", 10, 1600)).toBe(DOCK_SPEC.hosts.min);
    expect(clampDockWidth("settings", 10, 1600)).toBe(DOCK_SPEC.settings.min);
    expect(DOCK_SPEC.settings.min).toBeGreaterThan(DOCK_SPEC.hosts.min);
  });

  it("창 폭의 60% 를 넘지 않는다 (종류와 무관하다)", () => {
    expect(clampDockWidth("hosts", 2000, 1000)).toBe(600);
    expect(clampDockWidth("settings", 2000, 1600)).toBe(960);
    expect(clampDockWidth("hosts", 500, 1000)).toBe(500);
  });

  it("기본 설정 폭은 1100px 창을 덮지 않는다 — 미리보기가 오른쪽에 남아야 한다", () => {
    // 설정은 색·투명도·글꼴을 바꾸는 화면이라, 바뀐 것이 그 자리에서 보여야 한다.
    expect(clampDockWidth("settings", DOCK_SPEC.settings.def, 1100)).toBe(600);
    expect(1100 - 600).toBeGreaterThan(400);
  });

  it("좁은 창에서는 상한이 하한을 이기지 못한다", () => {
    // 300 × 0.6 = 180 < 220 — 읽을 수 없는 독보다 창을 덮는 독이 낫다
    expect(clampDockWidth("hosts", 400, 300)).toBe(DOCK_SPEC.hosts.min);
    // 설정은 그 문턱이 훨씬 높다 (700 × 0.6 = 420 = 최소)
    expect(clampDockWidth("settings", 900, 600)).toBe(DOCK_SPEC.settings.min);
  });

  it("창 폭을 모르면 상한을 걸지 않는다 (저장값을 몰래 깎지 않는다)", () => {
    expect(clampDockWidth("hosts", 900, 0)).toBe(900);
    expect(clampDockWidth("settings", 900, Number.NaN)).toBe(900);
  });

  it("숫자가 아니면 그 종류의 기본값에서 시작한다", () => {
    expect(clampDockWidth("hosts", Number.NaN, 1600)).toBe(DOCK_SPEC.hosts.def);
    expect(clampDockWidth("settings", Number.POSITIVE_INFINITY, 1600)).toBe(DOCK_SPEC.settings.def);
  });

  it("정수로 떨어뜨린다 (소수 픽셀을 style 에 흘리지 않는다)", () => {
    expect(clampDockWidth("hosts", 300.4, 1600)).toBe(300);
    expect(clampDockWidth("hosts", 300.6, 1600)).toBe(301);
  });
});

describe("채팅 독 갈래 (2026-10-25 — [채팅 | 작업안])", () => {
  it("모르는 값 · 없음은 채팅", () => {
    expect(normalizeChatDockSection("plans")).toBe("plans");
    expect(normalizeChatDockSection("chat")).toBe("chat");
    expect(normalizeChatDockSection("matrix")).toBe("chat");
    expect(normalizeChatDockSection(undefined)).toBe("chat");
  });

  it("제 칸 `chatSection` 에만 쓰고 폭 칸은 그대로 둔다 · 저장소가 던져도 채팅", () => {
    const mem = memoryStorage({ [DOCK_STORE_KEY]: JSON.stringify({ chat: { width: 400 } }) });
    stubStorage(mem.impl);
    expect(readChatDockSection()).toBe("chat");
    writeChatDockSection("plans");
    expect(JSON.parse(mem.store[DOCK_STORE_KEY])).toEqual({ chat: { width: 400 }, chatSection: "plans" });
    expect(readChatDockSection()).toBe("plans");
    stubStorage({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readChatDockSection()).toBe("chat");
    expect(() => writeChatDockSection("plans")).not.toThrow();
  });
});

describe("채팅 독 폭", () => {
  it("최소 320 · 창 폭 60% 상한 · 좁은 창에서는 최소가 이긴다", () => {
    expect(clampChatDockWidth(10, 1600)).toBe(CHAT_DOCK_SPEC.min);
    expect(clampChatDockWidth(2000, 1000)).toBe(600);
    expect(clampChatDockWidth(450, 1000)).toBe(450);
    expect(clampChatDockWidth(500, 400)).toBe(CHAT_DOCK_SPEC.min);
  });

  it("창 폭을 모르면 상한 없음 · 숫자가 아니면 기본값 · 정수", () => {
    expect(clampChatDockWidth(900, 0)).toBe(900);
    expect(clampChatDockWidth(Number.NaN, 1600)).toBe(CHAT_DOCK_SPEC.def);
    expect(clampChatDockWidth(400.6, 1600)).toBe(401);
  });

  it("제 칸 `chat` 에만 쓰고 런처 · 설정 칸은 그대로 둔다", () => {
    const mem = memoryStorage({ [DOCK_STORE_KEY]: JSON.stringify({ launcher: { width: 333 } }) });
    stubStorage(mem.impl);
    expect(readChatDockWidth(1600)).toBe(CHAT_DOCK_SPEC.def);
    writeChatDockWidth(512);
    expect(JSON.parse(mem.store[DOCK_STORE_KEY])).toEqual({ launcher: { width: 333 }, chat: { width: 512 } });
    expect(readChatDockWidth(1600)).toBe(512);
    expect(readChatDockWidth(700)).toBe(420);
    expect(readDockWidth("hosts", 1600)).toBe(333);
  });

  it("저장소가 던져도 기본값 · 쓰기는 조용히 넘어간다", () => {
    stubStorage({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readChatDockWidth(1600)).toBe(CHAT_DOCK_SPEC.def);
    expect(() => writeChatDockWidth(400)).not.toThrow();
  });
});

describe("readDockWidth", () => {
  it("저장소가 없으면 종류별 기본값", () => {
    expect(readDockWidth("hosts", 1600)).toBe(DOCK_SPEC.hosts.def);
    expect(readDockWidth("hosts", 1600)).toBe(DOCK_SPEC.hosts.def);
    expect(readDockWidth("settings", 1600)).toBe(DOCK_SPEC.settings.def);
  });

  it("종류별 칸을 따로 읽고 지금 창 폭으로 자른다", () => {
    stubStorage({
      getItem: () => JSON.stringify({ hosts: { width: 480 }, settings: { width: 800 } }),
    });
    expect(readDockWidth("hosts", 1600)).toBe(480);
    expect(readDockWidth("settings", 1600)).toBe(800);
    // 창이 작아졌으면 그 자리에서 줄어든다 (저장값은 그대로 둔다)
    expect(readDockWidth("hosts", 600)).toBe(360);
  });

  it("한쪽만 저장돼 있으면 다른 쪽은 기본값", () => {
    stubStorage({ getItem: () => JSON.stringify({ settings: { width: 700 } }) });
    expect(readDockWidth("settings", 1600)).toBe(700);
    expect(readDockWidth("hosts", 1600)).toBe(DOCK_SPEC.hosts.def);
  });

  it("옛 키(`aynx:hosts-dock`)의 폭을 호스트가 이어받는다", () => {
    const { impl } = memoryStorage({ [DOCK_LEGACY_STORE_KEY]: JSON.stringify({ width: 420 }) });
    stubStorage(impl);
    expect(readDockWidth("hosts", 1600)).toBe(420);
    // 설정은 그 키와 무관하다 — 그때는 호스트 독뿐이었다
    expect(readDockWidth("settings", 1600)).toBe(DOCK_SPEC.settings.def);
  });

  it("새 키가 있으면 옛 키는 더 이상 읽지 않는다", () => {
    const { impl } = memoryStorage({
      [DOCK_STORE_KEY]: JSON.stringify({ hosts: { width: 260 } }),
      [DOCK_LEGACY_STORE_KEY]: JSON.stringify({ width: 420 }),
    });
    stubStorage(impl);
    expect(readDockWidth("hosts", 1600)).toBe(260);
  });

  it("통합 전 저장값 — 옛 세 칸 중 가장 넓은 폭을 런처가 이어받는다", () => {
    const { impl } = memoryStorage({
      [DOCK_STORE_KEY]: JSON.stringify({
        hosts: { width: 300 },
        projects: { width: 430 },
        layouts: { width: 260 },
        settings: { width: 700 },
      }),
    });
    stubStorage(impl);
    for (const k of ["hosts", "projects"] as const) expect(readDockWidth(k, 1600)).toBe(430);
    expect(readDockWidth("settings", 1600)).toBe(700);
  });

  it("`launcher` 칸이 생기면 옛 칸들은 더 이상 읽지 않는다", () => {
    const { impl } = memoryStorage({
      [DOCK_STORE_KEY]: JSON.stringify({ launcher: { width: 280 }, projects: { width: 430 } }),
      [DOCK_LEGACY_STORE_KEY]: JSON.stringify({ width: 500 }),
    });
    stubStorage(impl);
    expect(readDockWidth("projects", 1600)).toBe(280);
  });

  it("옛 키(`aynx:hosts-dock`)는 런처 둘 모두가 이어받는다 — 설정은 아니다", () => {
    const { impl } = memoryStorage({ [DOCK_LEGACY_STORE_KEY]: JSON.stringify({ width: 420 }) });
    stubStorage(impl);
    expect(readDockWidth("hosts", 1600)).toBe(420);
    expect(readDockWidth("settings", 1600)).toBe(DOCK_SPEC.settings.def);
  });

  it("빈 자리·깨진 JSON·모양이 다른 값은 전부 기본값", () => {
    stubStorage({ getItem: () => null });
    expect(readDockWidth("hosts", 1600)).toBe(DOCK_SPEC.hosts.def);
    stubStorage({ getItem: () => "{{" });
    expect(readDockWidth("hosts", 1600)).toBe(DOCK_SPEC.hosts.def);
    stubStorage({ getItem: () => JSON.stringify({ hosts: { width: "wide" } }) });
    expect(readDockWidth("hosts", 1600)).toBe(DOCK_SPEC.hosts.def);
    stubStorage({ getItem: () => JSON.stringify({ hosts: 480 }) });
    expect(readDockWidth("hosts", 1600)).toBe(DOCK_SPEC.hosts.def);
    stubStorage({ getItem: () => JSON.stringify(null) });
    expect(readDockWidth("hosts", 1600)).toBe(DOCK_SPEC.hosts.def);
  });

  it("저장소가 던져도 기본값으로 돌아온다", () => {
    stubStorage({
      getItem: () => {
        throw new Error("storage blocked");
      },
    });
    expect(readDockWidth("settings", 1600)).toBe(DOCK_SPEC.settings.def);
  });
});

describe("writeDockWidth", () => {
  it("키 하나에 `{ 자리: { width } }` 로 남긴다 — 런처 둘은 `launcher` 한 칸이다", () => {
    const { store, impl } = memoryStorage();
    stubStorage(impl);
    writeDockWidth("hosts", 420);
    expect(store[DOCK_STORE_KEY]).toBe(JSON.stringify({ launcher: { width: 420 } }));
    writeDockWidth("hosts", 380);
    expect(store[DOCK_STORE_KEY]).toBe(JSON.stringify({ launcher: { width: 380 } }));
  });

  it("런처 둘은 한 폭이다 — 한 칸에서 바꾸면 다른 칸도 그 폭으로 읽는다", () => {
    const { impl } = memoryStorage();
    stubStorage(impl);
    writeDockWidth("projects", 430);
    expect(readDockWidth("hosts", 1600)).toBe(430);
    expect(readDockWidth("projects", 1600)).toBe(430);
    expect(readDockWidth("hosts", 1600)).toBe(430);
    expect(readDockWidth("settings", 1600)).toBe(DOCK_SPEC.settings.def);
  });

  it("다른 종류의 칸은 그대로 둔다 — 창이 여럿이라 통째로 덮으면 남의 폭이 사라진다", () => {
    const { store, impl } = memoryStorage({
      [DOCK_STORE_KEY]: JSON.stringify({ hosts: { width: 420 } }),
    });
    stubStorage(impl);
    writeDockWidth("settings", 700);
    expect(JSON.parse(store[DOCK_STORE_KEY])).toEqual({
      hosts: { width: 420 },
      settings: { width: 700 },
    });
  });

  it("쓴 값을 그대로 다시 읽는다", () => {
    const { impl } = memoryStorage();
    stubStorage(impl);
    writeDockWidth("settings", 720);
    expect(readDockWidth("settings", 1600)).toBe(720);
  });

  it("저장소가 던져도 조용히 넘어간다", () => {
    stubStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => writeDockWidth("hosts", 420)).not.toThrow();
  });

  it("저장소가 아예 없어도 던지지 않는다", () => {
    expect(() => writeDockWidth("hosts", 420)).not.toThrow();
  });
});

describe("런처 칸 표 (LAUNCHER_SEGMENTS)", () => {
  it("칸이 알림 · H · J · K(호스트 · 프로젝트 · DB) 순서다 — 설정은 칸이 아니다 (알림은 2026-10-18 통합 독)", () => {
    expect(LAUNCHER_SEGMENTS.map((s) => s.kind)).toEqual(["alerts", "hosts", "projects", "db"]);
    expect(LAUNCHER_SEGMENTS.map((s) => s.action)).toEqual([null, "open-hosts-dock", "open-projects-dock", "open-db-dock"]);
    expect(isLauncherKind("settings")).toBe(false);
    expect(isLauncherKind(null)).toBe(false);
    for (const s of LAUNCHER_SEGMENTS) expect(isLauncherKind(s.kind)).toBe(true);
  });

  it("폭을 기억하는 자리는 둘 — 런처 둘이 한 자리, 설정이 한 자리", () => {
    expect(new Set(LAUNCHER_SEGMENTS.map((s) => dockSlotOf(s.kind)))).toEqual(new Set(["launcher"]));
    expect(dockSlotOf("settings")).toBe("settings");
    expect(DOCK_SPEC.hosts).toBe(DOCK_SPEC.projects);
    expect(DOCK_SPEC.db).toBe(DOCK_SPEC.hosts);
    expect(DOCK_SPEC.alerts).toBe(DOCK_SPEC.hosts);
  });

  it("칸 없이 열면 알림 칸이다 — 그 칸은 표의 맨 앞이다", () => {
    expect(DEFAULT_LAUNCHER_SEGMENT).toBe("alerts");
    expect(LAUNCHER_SEGMENTS[0].kind).toBe(DEFAULT_LAUNCHER_SEGMENT);
  });

  it("액션 id 는 키바인딩 레지스트리에 있고(없는 칸은 팔레트 id 를 갖는다), 그림은 생성 목록에 있다", () => {
    const known = new Set(ACTIONS.map((a) => a.id));
    for (const s of LAUNCHER_SEGMENTS) {
      if (s.action === null) {
        expect(s.paletteId).toBeTruthy();
        expect(known.has(s.paletteId!)).toBe(false); // 팔레트 전용 — settings.toml 키가 아니다
      } else expect(known.has(s.action)).toBe(true);
      expect(Object.keys(UI_ICONS)).toContain(s.icon);
    }
  });

  it("이름과 바닥 줄 안내의 문구가 두 언어 사전에 있다", () => {
    for (const s of LAUNCHER_SEGMENTS) {
      const keys = [s.labelKey, ...s.hints.map((h) => h.labelKey)];
      for (const k of keys) {
        expect(translate("ko", k)).not.toBe(k);
        expect(translate("en", k)).not.toBe(k);
      }
      // 알림 칸은 키 안내 대신 제 바닥 줄(새 알림 수 · 작업안 기록 · 모두 읽음)을 그린다 — 안내가 빈 칸은 그것뿐이다
      if (s.kind === "alerts") {
        expect(s.hints).toEqual([]);
        continue;
      }
      expect(s.hints.length).toBeGreaterThan(0);
      expect(s.hints[0].keys).toBe("↵"); // 첫 안내는 언제나 그 칸의 Enter 다
    }
  });

  it("옆 칸은 끝에서 감싼다", () => {
    expect(adjacentSegment("alerts", 1)).toBe("hosts");
    expect(adjacentSegment("hosts", 1)).toBe("projects");
    expect(adjacentSegment("projects", 1)).toBe("db");
    expect(adjacentSegment("db", 1)).toBe("alerts");
    expect(adjacentSegment("alerts", -1)).toBe("db");
    expect(adjacentSegment("projects", -1)).toBe("hosts");
  });
});

describe("머리 아이콘 줄 (DOCK_TOOLS) · 동작 그림 (DOCK_ACTION_ICONS) — 2026-10-18 통합 독", () => {
  it("화면 잠금 · 새로고침 · 설정 · 종료 순서다 (2026-10-23 — 팔레트 자리에 자물쇠)", () => {
    expect(DOCK_TOOLS.map((t) => t.id)).toEqual(["lock", "reload", "settings", "quit"]);
  });

  it("조합의 출처 — 레지스트리 id 이거나, 레지스트리 밖이면 새로고침의 F5 뿐이다 (끝내기 = quit-app · 2026-10-29)", () => {
    const known = new Set(ACTIONS.map((a) => a.id));
    for (const tool of DOCK_TOOLS) {
      if (tool.action !== null) expect(known.has(tool.action)).toBe(true);
    }
    expect(DOCK_TOOLS.find((t) => t.id === "reload")?.fixedCombo).toBe("F5");
    expect(DOCK_TOOLS.find((t) => t.id === "quit")?.action).toBe("quit-app");
  });

  it("그림은 생성 목록에 있고, 이름은 두 언어 사전에 있다", () => {
    for (const tool of DOCK_TOOLS) {
      expect(Object.keys(UI_ICONS)).toContain(tool.icon);
      expect(translate("ko", tool.labelKey)).not.toBe(tool.labelKey);
      expect(translate("en", tool.labelKey)).not.toBe(tool.labelKey);
    }
    for (const [, icon] of DOCK_ACTION_ICONS) expect(Object.keys(UI_ICONS)).toContain(icon);
  });

  it("동작 그림의 액션은 레지스트리 id 거나 팔레트 전용 id(오케스트레이션)다 · 로컬 파일은 열린 폴더", () => {
    const known = new Set([...ACTIONS.map((a) => a.id), "orchestration-start", "orchestration-board"]);
    for (const [action] of DOCK_ACTION_ICONS) expect(known.has(action)).toBe(true);
    expect(new Map(DOCK_ACTION_ICONS).get("open-localfs")).toBe("folder-open");
  });
});

it("구형 layouts 칸은 hosts로 정규화하며 옛 너비는 읽기만 호환한다", () => {
  expect(normalizeLauncherSegment("layouts")).toBe("hosts");
  expect(normalizeLauncherSegment("projects")).toBe("projects");
  expect(normalizeLauncherSegment("db")).toBe("db");
  expect(normalizeLauncherSegment("alerts")).toBe("alerts");
  expect(normalizeLauncherSegment(null)).toBe("hosts");
});

describe("가장자리 호버로 열기 (2026-10-18 통합 독)", () => {
  const strip = { left: 0, top: 40, right: EDGE_BAND_PX, bottom: 700 };
  const at = (inStrip: boolean, buttons = 0, allowed = true) => ({ inStrip, allowed, buttons });

  it("띠는 16px — 창 끝의 OS 크기 조절 띠(약 4~6px)를 넉넉히 넘는다 · 머무는 시간은 약 250ms", () => {
    expect(EDGE_BAND_PX).toBe(16);
    expect(EDGE_BAND_PX).toBeGreaterThan(6 + 4); // OS 띠 너머에도 넉넉히 남는다
    expect(EDGE_DWELL_MS).toBe(250);
  });

  it("띠 안 판정 — 오른쪽 · 아래 변은 열린 끝 · 띠가 없으면 늘 밖", () => {
    expect(inEdgeStrip(strip, 0, 100)).toBe(true);
    expect(inEdgeStrip(strip, 15, 100)).toBe(true);
    expect(inEdgeStrip(strip, 16, 100)).toBe(false);
    expect(inEdgeStrip(strip, 8, 700)).toBe(false);
    expect(inEdgeStrip(strip, 8, 39)).toBe(false);
    expect(inEdgeStrip(null, 8, 100)).toBe(false);
  });

  it("들어오면 시계가 서고, 머무는 동안은 처음 시각 그대로, 다 차면 열 때다", () => {
    const a = edgeHoverMove(EDGE_IDLE, at(true), 1000);
    expect(a).toEqual({ since: 1000, needLeave: false });
    const b = edgeHoverMove(a, at(true), 1100);
    expect(b).toBe(a);
    expect(edgeHoverDue(b, 1249)).toBe(false);
    expect(edgeHoverDue(b, 1250)).toBe(true);
  });

  it("띠를 벗어나면 시계가 멈춘다 — 지나가는 커서로는 열리지 않는다", () => {
    const a = edgeHoverMove(EDGE_IDLE, at(true), 1000);
    const b = edgeHoverMove(a, at(false), 1100);
    expect(b).toEqual(EDGE_IDLE);
    expect(edgeHoverDue(b, 5000)).toBe(false);
    expect(edgeHoverMove(EDGE_IDLE, at(false), 1)).toBe(EDGE_IDLE);
  });

  it("마우스 단추를 누른 채(글자 고르기 · 끌기)로는 세지 않고, 놓은 뒤 머물면 그때부터 센다", () => {
    expect(edgeHoverMove(EDGE_IDLE, at(true, 1), 1000)).toBe(EDGE_IDLE);
    const counting = edgeHoverMove(EDGE_IDLE, at(true), 1000);
    const pressed = edgeHoverMove(counting, at(true, 1), 1100);
    expect(pressed.since).toBeNull();
    expect(edgeHoverDue(pressed, 2000)).toBe(false);
    expect(edgeHoverMove(pressed, at(true), 1200)).toEqual({ since: 1200, needLeave: false });
  });

  it("열 수 없는 때(독이 떠 있다 · 모달)에 띠 안이었으면, 띠를 한 번 벗어나야 다시 센다 — 닫힌 독이 커서 아래에서 도로 열리지 않게", () => {
    const blocked = edgeHoverMove(edgeHoverMove(EDGE_IDLE, at(true), 1000), at(true, 0, false), 1100);
    expect(blocked).toEqual(EDGE_AFTER_CLOSE);
    const stay = edgeHoverMove(blocked, at(true), 1200);
    expect(stay).toBe(blocked);
    expect(edgeHoverDue(stay, 9999)).toBe(false);
    const left = edgeHoverMove(stay, at(false), 1300);
    expect(left).toEqual(EDGE_IDLE);
    expect(edgeHoverMove(left, at(true), 1400)).toEqual({ since: 1400, needLeave: false });
  });
});

describe("창 끝 고정 띠 — 상태바 자리 · 모양과 무관 (2026-10-18 실기 재수정)", () => {
  const vp = { width: 1200, height: 800 };
  const TITLE = 40; // 제목줄(탭 줄) 아래 끝

  it("사이드 독 — 상태바 위·아래·좌·우 × flat·panel·hug 어느 배치든 늘 같은 창 끝 사각형이다", () => {
    // 띠는 상태바 배치를 입력으로 받지 않는다 — 배치마다 바뀌던 옛 띠(기둥 옆 · hug 3px inset)와 달리 늘 같은 값이어야 한다.
    // 독의 쪽도 상태바와 무관하다(2026-10-23 — `[dock] layout` 이 정한다): 같은 배치면 상태바가 어디든 같은 쪽이다.
    const leftWant = { left: 0, top: TITLE, right: EDGE_BAND_PX, bottom: 800 };
    const rightWant = { left: 1200 - EDGE_BAND_PX, top: TITLE, right: 1200, bottom: 800 };
    for (const layout of ["launcher-left", "launcher-right"] as const) {
      for (const position of ["top", "bottom", "left", "right"] as const) {
        for (const style of ["flat", "panel", "hug"] as const) {
          const { launcher, chat } = dockSides(layout);
          const at = `${layout}/${position}/${style}`;
          expect(sideEdgeStrip(launcher, vp, TITLE), at).toEqual(layout === "launcher-left" ? leftWant : rightWant);
          expect(sideEdgeStrip(chat, vp, TITLE), `${at} 채팅`).toEqual(layout === "launcher-left" ? rightWant : leftWant);
        }
      }
    }
  });

  it("왼쪽 상태바 기둥(48px) 위에 겹친다 — 창 끝 2 · 8 · 15px 이 띠, 기둥 안쪽 끝(48)은 아니다", () => {
    const s = sideEdgeStrip("left", vp, TITLE);
    for (const x of [2, 8, 15]) expect(inEdgeStrip(s, x, 300)).toBe(true);
    expect(inEdgeStrip(s, 48, 300)).toBe(false);
    expect(inEdgeStrip(s, 8, TITLE - 1)).toBe(false); // 제목줄 위는 아니다(창 끌기 · 탭)
  });

  it("OS 크기 조절 띠(창 끝 4~6px) 너머에도 띠가 10px 이상 남는다 — 왼쪽 · 오른쪽", () => {
    const l = sideEdgeStrip("left", vp, TITLE);
    const r = sideEdgeStrip("right", vp, TITLE);
    expect(l.right - 6).toBeGreaterThanOrEqual(10);
    expect(1200 - 6 - r.left).toBeGreaterThanOrEqual(10);
  });
});

describe("독 배치 — `[dock] layout` (2026-10-23 채팅 독 · docs/log/2026-10-23-side-chat-dock.md)", () => {
  const vp = { width: 1200, height: 800 };

  it("기본은 런처 왼쪽 · 채팅 오른쪽이다 — 상태바 자리를 따르지 않는다(자동 없음)", () => {
    expect(DEFAULT_DOCK_LAYOUT).toBe("launcher-left");
    expect(dockSides(DEFAULT_DOCK_LAYOUT)).toEqual({ launcher: "left", chat: "right" });
    expect(dockSides("launcher-right")).toEqual({ launcher: "right", chat: "left" });
  });

  it("모르는 값 · 빈 값(옛 파일 · 손으로 고친 값)은 기본 배치로 읽는다", () => {
    for (const v of [undefined, null, "", "auto", "right", "LAUNCHER-RIGHT"]) {
      expect(dockSides(v), String(v)).toEqual({ launcher: "left", chat: "right" });
    }
  });

  it("두 독은 늘 반대쪽이다 — 두 띠가 겹치지 않아 한 움직임에 두 독이 함께 반응하지 않는다", () => {
    expect(oppositeSide("left")).toBe("right");
    expect(oppositeSide("right")).toBe("left");
    for (const layout of ["launcher-left", "launcher-right"] as const) {
      const { launcher, chat } = dockSides(layout);
      expect(chat).toBe(oppositeSide(launcher));
      const a = sideEdgeStrip(launcher, vp, 40);
      const b = sideEdgeStrip(chat, vp, 40);
      for (let x = 0; x < vp.width; x += 1) {
        expect(inEdgeStrip(a, x, 300) && inEdgeStrip(b, x, 300), `${layout} x=${x}`).toBe(false);
      }
    }
  });

  it("채팅 독의 띠 — 오른쪽(기본)이면 창 오른쪽 끝 16px, 런처 쪽 끝은 띠가 아니다", () => {
    const chat = sideEdgeStrip(dockSides(DEFAULT_DOCK_LAYOUT).chat, vp, 40);
    for (const x of [1199, 1192, 1200 - EDGE_BAND_PX]) expect(inEdgeStrip(chat, x, 300)).toBe(true);
    for (const x of [0, 8, 1200 - EDGE_BAND_PX - 1]) expect(inEdgeStrip(chat, x, 300)).toBe(false);
    expect(inEdgeStrip(chat, 1195, 39)).toBe(false); // 제목줄 위는 아니다
  });
});
