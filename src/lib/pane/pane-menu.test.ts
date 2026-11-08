import { describe, expect, it } from "vitest";
import {
  docPathShown,
  isGroup,
  menuItemsFor,
  rowId,
  terminalMenuItems,
  type PaneFlyoutId,
  type PaneMenuAction,
  type PaneMenuCtx,
  type PaneMenuItem,
  type PaneMenuRow,
  type TermMenuCtx,
} from "$lib/pane/pane-menu";
import type { PaneKind } from "$lib/session";
import { UI_ICONS } from "$lib/ui-icons.generated";
import { translate } from "$lib/i18n/dict";

/**
 * 문구를 내는 함수 — 화면에서는 `t` 가 들어오고 여기서는 사전의 순수한 속을 쓴다
 * (`.svelte.ts` 는 vitest 가 못 읽는다 — `i18n/ko/pane.ts` 머리말).
 */
const ko = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate("ko", key, params);
const en = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate("en", key, params);

const off: PaneMenuCtx = {
  shared: false,
  syncOn: false,
  included: false,
  hasOutput: false,
  screenOnly: false,
  hasScrollback: true,
  logging: false,
};

/**
 * 터미널 우클릭의 평상시 — 링크도 선택도 없는 빈 자리에서 눌렀다.
 *
 * `snippet` 도 `null` 이다: 셸 통합이 없거나 아직 명령을 한 번도 안 친 세션이 기본 무대다
 * (저장 줄이 **없는** 것이 평소 모습이라는 뜻이기도 하다).
 */
const bare: TermMenuCtx = { ...off, link: null, hasSelection: false, snippet: null };

/** 우클릭한 줄에 끝난 명령이 있었다 (docs/log/2026-09-16-snippets.md) */
const onRow: TermMenuCtx = {
  ...bare,
  snippet: { command: "systemctl status nginx", fromRow: true },
};

/**
 * **줄 이름들** — 항목이면 액션 id, 옆목록을 여는 줄이면 그 목록의 id (`서버`·`출력`).
 * 2026-09-17 전에는 이 목록이 곧 액션 목록이었다 (docs/log/2026-09-17-tile-menu-flyouts.md).
 */
const actionsOf = (kind: PaneKind, ctx: PaneMenuCtx = off): (PaneMenuAction | PaneFlyoutId)[] =>
  menuItemsFor(kind, ctx, ko).map(rowId);

/** 옆목록을 여는 줄 하나 */
const groupOf = (kind: PaneKind, flyout: PaneFlyoutId, ctx: PaneMenuCtx = off) =>
  menuItemsFor(kind, ctx, ko)
    .filter(isGroup)
    .find((g) => g.flyout === flyout);

/** 그 옆목록에 든 항목들 (줄 자체가 없으면 `undefined`) */
const flyoutOf = (kind: PaneKind, flyout: PaneFlyoutId, ctx: PaneMenuCtx = off) =>
  groupOf(kind, flyout, ctx)?.children.map((i) => i.action);

/** 한 켜를 편 목록 — 항목의 상태를 볼 때는 그것이 어느 켜에 있든 상관없다 */
const flatten = (rows: readonly PaneMenuRow[]): PaneMenuItem[] =>
  rows.flatMap((row) => (isGroup(row) ? row.children : [row]));

const itemOf = (kind: PaneKind, action: PaneMenuAction, ctx: PaneMenuCtx = off) =>
  flatten(menuItemsFor(kind, ctx, ko)).find((i) => i.action === action);

const termActions = (kind: PaneKind, ctx: TermMenuCtx = bare): (PaneMenuAction | PaneFlyoutId)[] =>
  terminalMenuItems(kind, ctx, ko).map(rowId);

const termItem = (kind: PaneKind, action: PaneMenuAction, ctx: TermMenuCtx = bare) =>
  flatten(terminalMenuItems(kind, ctx, ko)).find((i) => i.action === action);

describe("menuItemsFor — 종류별 항목 표", () => {
  it("SSH 타일은 아홉 줄 — 접힌 묶음 둘(서버·출력)을 포함해서", () => {
    expect(actionsOf("ssh")).toEqual([
      "split-row",
      "split-col",
      "folder-conversations",
      "server",
      "output",
      "ai-permission",
      "toggle-sync",
      "detach",
      "close",
    ]);
  });

  it("로컬 셸에는 '서버' 묶음이 없다 (거기 든 셋이 전부 SSH 세션에 거는 것이다)", () => {
    expect(actionsOf("local")).toEqual([
      "split-row",
      "split-col",
      "folder-conversations",
      "output",
      "ai-permission",
      "toggle-sync",
      "detach",
      "close",
    ]);
  });

  it.each<PaneKind>(["localfs", "doc"])(
    "%s 타일에는 분할·분리·닫기뿐이다 (복사할 출력도 공유할 세션도 없다)",
    (kind) => {
      expect(actionsOf(kind)).toEqual([
        "split-row",
        "split-col",
        "detach",
        "close",
      ]);
    },
  );

  it("SFTP 타일에서는 **분리가 빠진다** — 옆 터미널의 세션을 빌려 쓴다", () => {
    expect(actionsOf("sftp")).toEqual([
      "split-row",
      "split-col",
      "close",
    ]);
  });

  it("원격 문서 타일(`borrowed`)도 분리가 빠진다 — SFTP 와 같은 이유 · 로컬 문서는 남는다", () => {
    const borrowed = { ...off, borrowed: true };
    expect(actionsOf("doc", borrowed)).toEqual([
      "split-row",
      "split-col",
      "close",
    ]);
    expect(actionsOf("doc")).toContain("detach");
    // 선도 SFTP 와 같이 닫기 앞으로 옮겨 온다
    const seps = menuItemsFor("doc", borrowed, ko)
      .filter((i) => i.separator)
      .map(rowId);
    expect(seps).toEqual(["close"]);
  });

  it("문서 타일에 경로가 있으면 '경로 복사' 가 분할 뒤 · 분리 앞에 선다(10-20 — 머리줄의 경로 글자를 걷은 자리)", () => {
    const local = { ...off, docPath: { path: "C:/notes/a.md", alias: "" } };
    expect(actionsOf("doc", local)).toEqual(["split-row", "split-col", "copy-path", "detach", "close"]);
    const item = itemOf("doc", "copy-path", local);
    expect(item?.label).toBe("경로 복사");
    expect(item?.icon).toBe("copy");
    expect(item?.separator).toBe(true);
    // 말풍선이 경로를 보여 준다(확인) — 로컬은 경로 그대로
    expect(item?.title).toBe("C:/notes/a.md");
    expect(UI_ICONS).toHaveProperty("copy");
    expect(flatten(menuItemsFor("doc", local, en)).find((i) => i.action === "copy-path")?.label).toBe("Copy path");
  });

  it("원격 문서의 '경로 복사' 말풍선은 `별칭:경로` — 분리는 빠지고 경로 복사는 남는다", () => {
    const remote = { ...off, borrowed: true, docPath: { path: "/srv/app/README.md", alias: "dev-01" } };
    expect(actionsOf("doc", remote)).toEqual(["split-row", "split-col", "copy-path", "close"]);
    expect(itemOf("doc", "copy-path", remote)?.title).toBe("dev-01:/srv/app/README.md");
    expect(docPathShown({ path: "/srv/a", alias: "" })).toBe("/srv/a");
  });

  it("'경로 복사' 는 문서 타일 · 경로가 있을 때만 — 빈 경로 · 다른 종류에는 없다", () => {
    expect(actionsOf("doc", { ...off, docPath: { path: "", alias: "" } })).not.toContain("copy-path");
    expect(actionsOf("doc", { ...off, docPath: null })).not.toContain("copy-path");
    const withPath = { ...off, docPath: { path: "/x", alias: "" } };
    for (const kind of ["localfs", "sftp", "local", "ssh", "query"] as const) {
      expect(actionsOf(kind, withPath)).not.toContain("copy-path");
    }
  });

  it("폰(`solo`) 문서 타일은 '경로 복사' 가 맨 위 — 첫 줄의 선은 걷힌다", () => {
    const rows = menuItemsFor("doc", { ...off, solo: true, docPath: { path: "/x", alias: "" } }, ko);
    expect(rows.map(rowId)).toEqual(["copy-path", "close"]);
    expect(rows[0]?.separator).toBeUndefined();
  });

  it("시작 타일도 분리가 없다 (옮겨 봐야 같은 안내 화면이다)", () => {
    expect(actionsOf("start")).toEqual([
      "split-row",
      "split-col",
      "close",
    ]);
  });

  it("분할 둘과 닫기는 **모든 종류**에 있다", () => {
    const kinds: PaneKind[] = ["ssh", "local", "sftp", "localfs", "start", "doc"];
    for (const kind of kinds) {
      const actions = actionsOf(kind);
      expect(actions.slice(0, 2)).toEqual(["split-row", "split-col"]);
      expect(actions.at(-1)).toBe("close");
    }
  });
});

describe("menuItemsFor — 토글 상태", () => {
  it("로컬 타일도 'AI 권한…'(10-23 — 예전 체크 'AI 읽기 허용') — 게이지 글리프 · 툴팁이 Off · Read 와 '실행 권한 없음' 을 말한다", () => {
    const offItem = itemOf("local", "ai-permission", off);
    expect(offItem?.checkbox).toBeUndefined();
    expect(offItem?.disabled).toBeUndefined();
    expect(offItem?.label).toBe("AI 권한…");
    expect(offItem?.icon).toBe("ai-gauge-0");
    expect(offItem?.title).toContain("Off");
    expect(offItem?.title).toContain("실행 권한이 없습니다");

    const onItem = itemOf("local", "ai-permission", { ...off, shared: true });
    expect(onItem?.icon).toBe("ai-gauge-1");
    expect(onItem?.title).toContain("Read");
    // 원격 단계는 로컬 줄에 뜻이 없다
    expect(itemOf("local", "ai-permission", { ...off, shared: true, aiStage: "all" })).toEqual(onItem);
    expect(flatten(menuItemsFor("local", off, en)).find((i) => i.action === "ai-permission")?.title).toContain(
      "no run permission",
    );
  });

  it("로컬 AI CLI 타일(10-23)에는 'AI 권한…' 줄이 없다 — 동시 입력 줄이 권한 묶음의 선을 긋는다", () => {
    expect(itemOf("local", "ai-permission", { ...off, aiTile: true })).toBeUndefined();
    expect(itemOf("local", "ai-permission", { ...off, aiTile: true, shared: true })).toBeUndefined();
    expect(itemOf("local", "toggle-sync", { ...off, aiTile: true })?.separator).toBe(true);
    expect(itemOf("local", "toggle-sync", off)?.separator).toBeUndefined();
    // 원격 타일에서는 뜻이 없다
    expect(itemOf("ssh", "ai-permission", { ...off, aiStage: "read", aiTile: true })).toBeDefined();
  });

  it("원격 타일은 체크가 아니라 'AI 권한…' — 그림과 툴팁이 호스트 단계를 말한다", () => {
    const item = itemOf("ssh", "ai-permission", { ...off, aiStage: "approve" });
    expect(item?.checkbox).toBeUndefined();
    expect(item?.disabled).toBe(false);
    // 앞자리 그림은 게이지 글리프 — 머리줄 칩의 미니 게이지와 같은 꼴(승인 후 실행 = 자리 2 · 막대 둘)
    expect(item?.icon).toBe("ai-gauge-2");
    expect(UI_ICONS).toHaveProperty("ai-gauge-2");
    expect(item?.title).toContain("Ask");
    // 원격 타일의 로컬 토글 값은 뜻이 없다 — 켜져 있어도 줄은 같다
    expect(itemOf("ssh", "ai-permission", { ...off, aiStage: "approve", shared: true })).toEqual(item);
  });

  it("호스트 목록에 없는 원격 타일(빠른 접속)은 'AI 권한…' 이 흐리고 이유를 말한다", () => {
    const item = itemOf("ssh", "ai-permission", { ...off, aiStage: null });
    expect(item?.disabled).toBe(true);
    expect(item?.icon).toBe("ai-gauge-0");
    expect(item?.title).toBe("호스트로 저장하면 AI 권한을 줄 수 있습니다");
    // 영어 사전도 같은 자리를 채운다
    const en1 = flatten(menuItemsFor("ssh", { ...off, aiStage: null }, en)).find((i) => i.action === "ai-permission");
    expect(en1?.title).toBe("Save it as a host to give the AI access");
  });

  it("쿼리 타일(10-14)은 'AI 권한…' 한 줄 — DB 연결의 단계 · 풀림 · 목록에 없는 연결은 흐림", () => {
    expect(actionsOf("query", off)).toEqual(["split-row", "split-col", "ai-permission", "detach", "close"]);
    const item = itemOf("query", "ai-permission", { ...off, dbAi: { level: "schema", broken: false } });
    expect(item?.disabled).toBe(false);
    expect(item?.icon).toBe("ai-gauge-1");
    expect(item?.title).toBe("Schema — 이 DB 연결에 적용됩니다");
    const broken = itemOf("query", "ai-permission", { ...off, dbAi: { level: "off", broken: true } });
    expect(broken?.disabled).toBe(false);
    expect(broken?.title).toContain("풀려");
    expect(broken?.icon).toBe("ai-gauge-0");
    // 모두 승인은 막대 넷 — 호스트 · DB 가 같은 자리면 같은 그림이다
    expect(itemOf("query", "ai-permission", { ...off, dbAi: { level: "all", broken: false } })?.icon).toBe("ai-gauge-4");
    expect(itemOf("ssh", "ai-permission", { ...off, aiStage: "all" })?.icon).toBe("ai-gauge-4");
    expect(itemOf("query", "ai-permission", { ...off, dbAi: null })?.disabled).toBe(true);
    // 다른 종류에는 서지 않는다
    expect(itemOf("run", "ai-permission", { ...off, dbAi: { level: "read", broken: false } })).toBeUndefined();
  });

  it("동시 입력 참여는 탭이 꺼져 있으면 **흐리다** (숨기지 않는다)", () => {
    const item = itemOf("ssh", "toggle-sync", off);
    expect(item?.disabled).toBe(true);
    expect(item?.title).toContain("탭을 우클릭해 켜세요");
  });

  it("탭이 켜져 있으면 누를 수 있고, 포함 여부가 ✓ 로 뜬다", () => {
    const notIn = itemOf("ssh", "toggle-sync", { ...off, syncOn: true });
    expect(notIn?.disabled).toBe(false);
    expect(notIn?.checked).toBe(false);
    expect(notIn?.icon).toBeNull();

    const isIn = itemOf("ssh", "toggle-sync", { ...off, syncOn: true, included: true });
    expect(isIn?.checked).toBe(true);
    expect(isIn?.icon).toBe("check");
    expect(isIn?.title).toContain("Ctrl+클릭");
  });

  it("체크가 아닌 항목은 `checkbox` 를 달지 않는다 (역할이 갈린다)", () => {
    expect(itemOf("ssh", "split-row")?.checkbox).toBeUndefined();
    expect(itemOf("ssh", "close")?.checkbox).toBeUndefined();
  });
});

describe("menuItemsFor — 구분선", () => {
  it("SSH 타일은 여섯 묶음으로 갈린다: 분할 / 지난 대화 / 서버 / 출력 / 권한 / 치우기", () => {
    const marks = menuItemsFor("ssh", off, ko)
      .filter((i) => i.separator)
      .map(rowId);
    expect(marks).toEqual(["folder-conversations", "server", "output", "ai-permission", "detach"]);
  });

  it("이 폴더의 지난 대화 — 터미널 타일에만 · 단축키 글자는 부르는 쪽이 넘긴 그대로", () => {
    for (const kind of ["localfs", "sftp", "start", "doc"] as const) {
      expect(actionsOf(kind), kind).not.toContain("folder-conversations");
    }
    expect(itemOf("local", "folder-conversations")?.label).toBe("이 폴더의 지난 대화");
    expect(itemOf("local", "folder-conversations")?.icon).toBe("conversations");
    expect(itemOf("local", "folder-conversations")?.hint).toBeUndefined();
    expect(itemOf("local", "folder-conversations", { ...off, folderConvoHint: "Ctrl+Shift+Y" })?.hint).toBe(
      "Ctrl+Shift+Y",
    );
    // 사용자가 단축키를 풀었으면(빈 글자) 적지 않는다
    expect(itemOf("local", "folder-conversations", { ...off, folderConvoHint: "" })?.hint).toBeUndefined();
  });

  it("사이드 채팅에서 이어 가기(사이드 채팅 v2 6단계) — 로컬 타일 · 부르는 쪽이 대화를 안다고 할 때만 · 지난 대화 바로 아래 · 두 메뉴 모두", () => {
    expect(actionsOf("local"), "대화를 모른다").not.toContain("continue-side-chat");
    const on = { ...off, sideChatFork: true };
    const acts = actionsOf("local", on);
    expect(acts.indexOf("continue-side-chat")).toBe(acts.indexOf("folder-conversations") + 1);
    for (const kind of ["ssh", "localfs", "doc", "query"] as const) {
      expect(actionsOf(kind, on), kind).not.toContain("continue-side-chat");
    }
    const item = itemOf("local", "continue-side-chat", on);
    expect(item?.label).toBe("사이드 채팅에서 이어 가기");
    expect(item?.separator).toBeUndefined();
    expect(UI_ICONS).toHaveProperty(item?.icon ?? "");
    expect(terminalMenuItems("local", { ...bare, sideChatFork: true }, ko).map(rowId)).toContain("continue-side-chat");
    expect(menuItemsFor("local", on, en).find((r) => rowId(r) === "continue-side-chat")?.label).toBe("Continue in side chat");
  });

  it("분리가 빠진 타일에서는 마지막 선이 **닫기 앞**으로 옮겨 온다", () => {
    const seps = (kind: PaneKind) =>
      menuItemsFor(kind, off, ko)
        .filter((i) => i.separator)
        .map(rowId);
    expect(seps("sftp")).toEqual(["close"]);
    expect(seps("start")).toEqual(["close"]);
  });

  it("첫 묶음(분할)에는 선이 없다", () => {
    expect(menuItemsFor("ssh", off, ko)[0]?.separator).toBeUndefined();
    expect(menuItemsFor("localfs", off, ko)[0]?.separator).toBeUndefined();
  });
});

describe("menuItemsFor — 아이콘과 이름", () => {
  it("항목마다 정해진 아이콘 이름을 쓴다", () => {
    expect(itemOf("ssh", "split-row")?.icon).toBe("split-h");
    expect(itemOf("ssh", "split-col")?.icon).toBe("split-v");
    expect(itemOf("ssh", "forward")?.icon).toBe("forward");
    expect(itemOf("ssh", "edit-remote")?.icon).toBe("edit");
    // 헤더의 폴더 버튼과 **같은 그림**이다 — 같은 것을 여는 두 자리가 같은 말을 한다
    expect(itemOf("ssh", "sftp")?.icon).toBe("folder");
    expect(itemOf("ssh", "copy-output")?.icon).toBe("copy");
    // 분리(이 앱의 새 창)와 링크 열기(브라우저)는 한 목록에 함께 서므로 그림이 갈린다
    expect(itemOf("ssh", "detach")?.icon).toBe("window");
    expect(termItem("ssh", "open-link", { ...bare, link: "https://x" })?.icon).toBe("external");
    expect(itemOf("ssh", "close")?.icon).toBe("close");
  });

  /**
   * **이름이 생성 목록에 실제로 있는가** (`status-items.test.ts` 와 같은 처방).
   *
   * 오타면 `UiIcon` 이 아무것도 그리지 않아 **빈 칸**이 선다 — 액션 id 오타와 똑같이
   * 사람 눈으로는 안 잡히고, 그 줄만 조용히 그림을 잃는다.
   */
  it("두 메뉴의 모든 아이콘 이름이 생성 목록에 있다", () => {
    const kinds: PaneKind[] = ["ssh", "local", "sftp", "localfs", "start", "doc"];
    const on: TermMenuCtx = {
      shared: true,
      aiStage: "auto",
      syncOn: true,
      included: true,
      hasOutput: true,
      screenOnly: true,
      hasScrollback: true,
      logging: true,
      link: "https://x",
      hasSelection: true,
      snippet: { command: "make all", fromRow: true },
    };
    // `on` 은 `screenOnly` 라 저장 줄이 없다 — 그 줄의 그림까지 보려면 꺼 둔 벌이 하나 더 필요하다.
    for (const kind of kinds) {
      for (const ctx of [bare, on, { ...on, screenOnly: false }]) {
        const items = [
          ...menuItemsFor(kind, ctx, ko),
          ...flatten(menuItemsFor(kind, ctx, ko)),
          ...terminalMenuItems(kind, ctx, ko),
          ...flatten(terminalMenuItems(kind, ctx, ko)),
        ];
        for (const item of items) {
          if (item.icon === null) continue;
          expect(Object.keys(UI_ICONS), `${kind}/${rowId(item)}`).toContain(item.icon);
        }
      }
    }
  });

  it("이름은 화면에 뜨는 그대로다", () => {
    expect(itemOf("ssh", "split-row")?.label).toBe("좌우로 분할");
    expect(itemOf("ssh", "forward")?.label).toBe("포트 포워딩…");
    expect(itemOf("ssh", "edit-remote")?.label).toBe("원격 파일 편집…");
    expect(itemOf("ssh", "detach")?.label).toBe("새 창으로 분리");
  });
});

// ---------------------------------------------------------------------------
// 터미널 우클릭 메뉴 (docs/log/2026-09-05-terminal-context-menu.md)
//
// 헤더 ⋯ 와 **한 정의**라는 것이 이 묶음이 붙드는 계약이다: 아래 절반은 언제나
// `menuItemsFor` 의 목록 그대로여야 하고, 그 위에만 화면·클립보드 항목이 얹힌다.
// ---------------------------------------------------------------------------

describe("terminalMenuItems — 묶음 넷", () => {
  it("링크도 선택도 없으면 붙여넣기부터 시작한다", () => {
    expect(termActions("ssh")).toEqual([
      "paste",
      "select-all",
      "clear-screen",
      "output",
      "split-row",
      "split-col",
      "folder-conversations",
      "ai-permission",
      "toggle-sync",
      "detach",
      "close",
    ]);
  });

  /**
   * **"서버 ▸" 는 ⋯ 전용이다** (2026-09-17). 우클릭은 화면 위에서 시작한 몸짓이라 그 자리에서
   * 하고 싶은 일이 먼저 와야 하는데, 포워딩·원격 파일은 타일이 아니라 저쪽 기계에 건다.
   */
  it("우클릭 메뉴에는 '서버' 묶음이 서지 않는다", () => {
    expect(termActions("ssh")).not.toContain("server");
    expect(termActions("ssh", { ...bare, screenOnly: true })).not.toContain("server");
    // 헤더 ⋯ 에는 그대로 있다 — 두 메뉴가 갈리는 유일한 자리가 여기다.
    expect(actionsOf("ssh")).toContain("server");
  });

  it("선택이 있을 때만 '복사' 가 맨 앞에 붙는다", () => {
    expect(termActions("local", { ...bare, hasSelection: true }).slice(0, 4)).toEqual([
      "copy",
      "paste",
      "select-all",
      "clear-screen",
    ]);
    expect(termActions("local")).not.toContain("copy");
  });

  it("링크 위에서 누르면 링크 둘이 **맨 위**로 온다", () => {
    const ctx: TermMenuCtx = { ...bare, link: "https://example.com/x", hasSelection: true };
    expect(termActions("ssh", ctx).slice(0, 3)).toEqual(["open-link", "copy-link", "copy"]);
    // 주소는 툴팁으로 보인다 — 라벨을 길게 늘이면 메뉴 폭이 링크 길이를 따라간다.
    expect(termItem("ssh", "open-link", ctx)?.title).toBe("https://example.com/x");
  });

  it("아래 절반은 헤더 ⋯ 의 목록 **그대로**다 ('출력' 은 위로, '서버' 는 아예 빠진다)", () => {
    for (const kind of ["ssh", "local"] as const) {
      const moved = ["output", "server"];
      const header = actionsOf(kind).filter((a) => !moved.includes(a));
      expect(termActions(kind).slice(-header.length)).toEqual(header);
    }
  });

  it("검색 항목은 없다 — 이 앱에 터미널 검색 UI 가 아직 없다", () => {
    expect(termActions("ssh").join(",")).not.toContain("search");
  });
});

describe("terminalMenuItems — 구분선", () => {
  const seps = (ctx: TermMenuCtx) =>
    terminalMenuItems("ssh", ctx, ko)
      .filter((i) => i.separator)
      .map(rowId);

  it("링크가 없으면 편집 묶음이 첫 줄이라 선이 없다", () => {
    // 편집 셋(붙여넣기…화면 지우기) 뒤로 묶음이 갈린다: 출력 / 타일 배치 / 지난 대화 /
    // 공유·동시 입력 / 치우기. 헤더 ⋯ 의 경계가 그대로 살아 있다.
    expect(seps(bare)).toEqual(["output", "split-row", "folder-conversations", "ai-permission", "detach"]);
  });

  it("링크가 있으면 그 아래 첫 항목이 선을 이고 온다", () => {
    expect(seps({ ...bare, link: "https://x", hasSelection: false })[0]).toBe("paste");
    expect(seps({ ...bare, link: "https://x", hasSelection: true })[0]).toBe("copy");
  });

  it("빠져나간 두 묶음이 이고 있던 경계는 **다음 줄이 물려받는다**", () => {
    // 헤더 메뉴에서는 그 선을 `server`·`output` 이 이고 있었다 — 둘 다 이 목록에서 빠지면
    // 뒤따르는 `split-row` 가 경계를 물려받는다 (안 그러면 편집 묶음에 그대로 붙는다).
    const items = terminalMenuItems("ssh", bare, ko);
    const split = items.findIndex((i) => rowId(i) === "split-row");
    expect(rowId(items[split - 1])).toBe("output");
    expect(items[split].separator).toBe(true);
  });
});

describe("menuItemsFor — 마지막 출력 복사", () => {
  it("복사할 블록이 없으면 흐리고, 툴팁이 왜인지 말한다", () => {
    const item = itemOf("ssh", "copy-output", off);
    expect(item?.disabled).toBe(true);
    expect(item?.title).toContain("OSC 133");
  });

  it("있으면 누를 수 있다", () => {
    const item = itemOf("ssh", "copy-output", { ...off, hasOutput: true });
    expect(item?.disabled).toBe(false);
  });

  /**
   * tmux 타일(간이 모드)은 **복사할 출력이 있어 보여도** 흐리다 — 애초에 블록이 생기지 않는
   * 타일이라, "지금은 없다"(기다리면 생긴다)와 다른 말을 해야 한다
   * (docs/log/2026-09-16-tmux-toggle.md).
   */
  it("tmux 타일은 출력이 있다고 해도 흐리고, 툴팁이 다른 말을 한다", () => {
    const item = itemOf("ssh", "copy-output", { ...off, hasOutput: true, screenOnly: true });
    expect(item?.disabled).toBe(true);
    expect(item?.title).toContain("tmux");
    // "셸 통합이 없다" 쪽 문구로 새지 않는다 — 두 사정이 섞이면 배울 것이 하나 늘어난다.
    expect(item?.title).not.toContain("OSC 133");
  });
});

// ---------------------------------------------------------------------------
// 스크롤백 내보내기 · 세션 로그 (docs/log/2026-09-17-scrollback-export-and-logs.md)
// ---------------------------------------------------------------------------

describe("menuItemsFor — '출력' 묶음 (복사 · 스크롤백 저장 · 세션 로그)", () => {
  it("세션이 있는 타일에만 선다 (설정·파일 타일에는 버퍼도 로그도 없다)", () => {
    for (const kind of ["ssh", "local"] as const) {
      expect(actionsOf(kind), kind).toContain("output");
    }
    for (const kind of ["localfs", "sftp", "start", "doc"] as const) {
      expect(actionsOf(kind), kind).not.toContain("output");
      expect(flyoutOf(kind, "output"), kind).toBeUndefined();
    }
  });

  it("셋의 순서는 **가져가는 크기순**이다: 블록 하나 → 화면 전체 → 쌓인 파일", () => {
    expect(flyoutOf("ssh", "output")).toEqual(["copy-output", "save-scrollback", "session-log"]);
    expect(flyoutOf("local", "output")).toEqual(["copy-output", "save-scrollback", "session-log"]);
  });

  it("묶음 줄에는 액션이 없다 — 누르면 목록이 열릴 뿐이다", () => {
    const group = groupOf("ssh", "output");
    expect(group?.label).toBe("출력");
    expect(group?.icon).toBe("terminal");
    expect(group && "action" in group).toBe(false);
  });

  it("버퍼가 비었으면 흐리고, 툴팁이 왜인지 말한다", () => {
    const empty = itemOf("ssh", "save-scrollback", { ...off, hasScrollback: false });
    expect(empty?.disabled).toBe(true);
    expect(empty?.title).toContain("비어 있습니다");

    const ready = itemOf("ssh", "save-scrollback", off);
    expect(ready?.disabled).toBe(false);
    expect(ready?.title).toContain("텍스트 파일");
  });

  /**
   * **tmux 타일에서도 저장은 살아 있다** — 바로 위의 "마지막 출력 복사" 와 갈리는 자리다.
   * 복사는 OSC 133 블록이 있어야 하지만 버퍼는 간이 모드에도 있다 (화면이 곧 그것이다).
   */
  it("tmux 타일에서도 저장은 눌린다 (출력 복사와 갈린다)", () => {
    const tmux: PaneMenuCtx = { ...off, screenOnly: true, hasOutput: true };
    expect(itemOf("ssh", "save-scrollback", tmux)?.disabled).toBe(false);
    expect(itemOf("ssh", "copy-output", tmux)?.disabled).toBe(true);
  });

  it("로깅이 꺼져 있으면 '세션 로그 열기' 가 흐리고, 어디서 켜는지를 말한다", () => {
    const item = itemOf("ssh", "session-log", off);
    expect(item?.disabled).toBe(true);
    expect(item?.title).toContain("세션 로깅");

    const on = itemOf("ssh", "session-log", { ...off, logging: true });
    expect(on?.disabled).toBe(false);
  });

  it("'로그 폴더 열기' 는 이 메뉴를 떠났다 (설정 › 터미널 · 호스트 폼)", () => {
    for (const kind of ["ssh", "local"] as const) {
      expect(flyoutOf(kind, "output"), kind).not.toContain("logs-folder");
      expect(flatten(menuItemsFor(kind, off, ko)).map((i) => i.action), kind).not.toContain(
        "logs-folder",
      );
    }
  });

  it("이름과 그림은 화면에 뜨는 그대로다", () => {
    expect(itemOf("ssh", "save-scrollback")?.label).toBe("스크롤백 저장…");
    expect(itemOf("ssh", "save-scrollback")?.icon).toBe("file-down");
    expect(itemOf("ssh", "session-log")?.label).toBe("세션 로그 열기");
    expect(itemOf("ssh", "session-log")?.icon).toBe("file-text");
    expect(itemOf("ssh", "sftp")?.icon).toBe("folder");
  });

  // ── 전부 흐린 묶음은 부모도 흐리다 (docs/log/2026-09-17-tile-menu-flyouts.md) ──
  it("셋이 다 흐리면 부모 줄이 흐리고, **첫 자식의 사유**를 그대로 말한다", () => {
    const nothing: PaneMenuCtx = { ...off, hasScrollback: false }; // 출력도·버퍼도·로그도 없다
    const group = groupOf("ssh", "output", nothing);
    expect(group?.disabled).toBe(true);
    expect(group?.title).toBe(itemOf("ssh", "copy-output", nothing)?.title);
    // 들어가 보면 정말로 셋 다 흐리다 — 부모의 흐림이 거짓말이 아니라는 확인이다.
    expect(groupOf("ssh", "output", nothing)?.children.every((c) => c.disabled)).toBe(true);
  });

  it("하나라도 눌리면 부모는 흐리지 않고 묶음을 설명한다", () => {
    for (const ctx of [
      off, // 스크롤백은 있다
      { ...off, hasScrollback: false, hasOutput: true },
      { ...off, hasScrollback: false, logging: true },
    ]) {
      const group = groupOf("ssh", "output", ctx);
      expect(group?.disabled).toBeUndefined();
      expect(group?.title).toBe(ko("pane.menu.output.title"));
    }
  });

  it("터미널 우클릭 메뉴에서는 묶음 **하나가 통째로** 위로 온다", () => {
    const list = termActions("ssh");
    expect(list.indexOf("output")).toBe(list.indexOf("clear-screen") + 1);
    // 안에 든 셋은 헤더 ⋯ 와 같은 순서 그대로다 (한 정의의 두 가지).
    const group = terminalMenuItems("ssh", bare, ko).filter(isGroup)[0];
    expect(group.children.map((c) => c.action)).toEqual([
      "copy-output",
      "save-scrollback",
      "session-log",
    ]);
  });
});

// ---------------------------------------------------------------------------
// tmux 세션 목록 (docs/log/2026-09-16-tmux-toggle.md)
// ---------------------------------------------------------------------------

describe("menuItemsFor — tmux 세션…", () => {
  const tmuxCtx: PaneMenuCtx = { ...off, screenOnly: true };

  it("tmux 타일에만 선다 — 없는 타일에는 흐리게도 안 뜬다", () => {
    expect(flyoutOf("ssh", "server")).not.toContain("tmux-sessions");
    expect(flyoutOf("ssh", "server", tmuxCtx)).toContain("tmux-sessions");
    // tmux 는 SSH 세션 위에만 있다 — 로컬 셸에는 `screenOnly` 가 서도 '서버' 줄 자체가 없다.
    expect(flyoutOf("local", "server", tmuxCtx)).toBeUndefined();
  });

  it("'서버' 목록의 **끝**이다 — 앞의 셋은 모든 SSH 타일에 뜻이 있다", () => {
    expect(flyoutOf("ssh", "server")).toEqual(["forward", "sftp", "edit-remote"]);
    expect(flyoutOf("ssh", "server", tmuxCtx)).toEqual([
      "forward",
      "sftp",
      "edit-remote",
      "tmux-sessions",
    ]);
    // 바깥 목록은 tmux 타일에서도 열 줄 그대로다 (길이가 타일 사정을 타지 않는다).
    expect(actionsOf("ssh", tmuxCtx)).toEqual(actionsOf("ssh"));
  });

  it("이름과 그림은 화면에 뜨는 그대로다", () => {
    const item = itemOf("ssh", "tmux-sessions", tmuxCtx);
    expect(item?.label).toBe("tmux 세션…");
    expect(item?.icon).toBe("list");
    expect(item?.disabled).toBeUndefined();
  });

  it("터미널 우클릭 메뉴에는 없다 — '서버' 묶음째 빠진 자리다 (2026-09-17)", () => {
    const ctx: TermMenuCtx = { ...tmuxCtx, link: null, hasSelection: false, snippet: null };
    expect(flatten(terminalMenuItems("ssh", ctx, ko)).map((i) => i.action)).not.toContain(
      "tmux-sessions",
    );
    // 머리줄의 tmux 칩과 ⋯ › 서버 둘이 남는다 (주 입구는 칩이다).
    expect(flyoutOf("ssh", "server", tmuxCtx)).toContain("tmux-sessions");
  });
});

describe("terminalMenuItems — 스니펫으로 저장", () => {
  it("저장할 명령이 없으면 줄 자체가 없다 (흐리게도 아니다)", () => {
    expect(termActions("local")).not.toContain("save-snippet");
    expect(termActions("ssh")).not.toContain("save-snippet");
  });

  it("우클릭한 줄의 명령이 있으면 그 명령이 라벨에 실린다", () => {
    const item = termItem("local", "save-snippet", onRow);
    expect(item?.label).toBe("스니펫으로 저장: systemctl status nginx");
    expect(item?.icon).toBe("bookmark");
    expect(item?.disabled).toBeUndefined();
  });

  it("긴 명령은 낱말 경계에서 잘리고 잘렸다는 표시가 붙는다", () => {
    const ctx: TermMenuCtx = {
      ...bare,
      snippet: { command: "docker compose -f docker-compose.prod.yml up -d", fromRow: true },
    };
    expect(termItem("local", "save-snippet", ctx)?.label).toBe(
      "스니펫으로 저장: docker compose -f…",
    );
  });

  it("커서 밑에 블록이 없으면 '마지막 명령' 이라고 말한다", () => {
    const ctx: TermMenuCtx = { ...bare, snippet: { command: "make all", fromRow: false } };
    const item = termItem("local", "save-snippet", ctx);
    expect(item?.label).toBe("마지막 명령을 스니펫으로 저장");
    // 라벨이 다르면 약속도 다르다 — 툴팁이 왜 물러섰는지를 말한다.
    expect(item?.title).toContain("마지막 명령");
  });

  it("화면만 있는 세션(tmux 타일)에는 서지 않는다 — 블록이 영영 없다", () => {
    expect(termActions("ssh", { ...onRow, screenOnly: true })).not.toContain("save-snippet");
  });

  it("끌어올린 '출력' 묶음 **바로 아래**다 (대상이 같은 화면·명령이다)", () => {
    const list = termActions("local", onRow);
    expect(list.indexOf("save-snippet")).toBe(list.indexOf("output") + 1);
  });

  it("헤더 ⋯ 메뉴에는 없다 — 그쪽에는 가리킨 줄이 없다", () => {
    expect(actionsOf("local")).not.toContain("save-snippet");
    expect(actionsOf("ssh")).not.toContain("save-snippet");
  });
});

describe("문구는 사전을 거친다 — 같은 표, 다른 언어", () => {
  it("항목 목록은 그대로고 이름만 갈아입는다", () => {
    const koItems = menuItemsFor("ssh", off, ko);
    const enItems = menuItemsFor("ssh", off, en);
    expect(enItems.map(rowId)).toEqual(koItems.map(rowId));
    expect(enItems.find((i) => rowId(i) === "split-row")?.label).toBe("Split left and right");
    expect(enItems.find((i) => rowId(i) === "detach")?.label).toBe("Detach to a new window");
    // 묶음 줄과 그 안의 줄도 함께 갈아입는다.
    expect(enItems.find((i) => rowId(i) === "output")?.label).toBe("Output");
    expect(enItems.find((i) => rowId(i) === "server")?.label).toBe("Server");
  });

  it("자리표시가 들어간 줄도 따라온다", () => {
    const item = flatten(terminalMenuItems("ssh", onRow, en)).find(
      (i) => i.action === "save-snippet",
    );
    expect(item?.label).toBe("Save as snippet: systemctl status nginx");
  });
});

describe("terminalMenuItems — 이 블록을 AI 에게 묻기 (docs/log/2026-09-28-ask-ai-block.md)", () => {
  const withBlock: TermMenuCtx = { ...onRow, askBlock: { fromRow: true }, askHint: "Ctrl+Shift+X" };

  it("블록이 없으면(셸 통합이 없는 타일) 줄이 아예 없다", () => {
    expect(termActions("local")).not.toContain("ask-ai");
    expect(termActions("local", { ...bare, askBlock: null })).not.toContain("ask-ai");
  });

  it("출력 바로 아래, 스니펫 위 — 누른 줄이면 '이 블록을', 아니면 '마지막 블록을', 단축키 글자가 붙는다", () => {
    const list = termActions("local", withBlock);
    expect(list.indexOf("ask-ai")).toBe(list.indexOf("output") + 1);
    expect(list.indexOf("save-snippet")).toBe(list.indexOf("ask-ai") + 1);
    const item = termItem("local", "ask-ai", withBlock);
    expect(item?.label).toBe("이 블록을 AI 에게 묻기…");
    expect(item?.hint).toBe("Ctrl+Shift+X");
    expect(item?.icon).toBe("ai");
    expect(termItem("ssh", "ask-ai", { ...withBlock, askBlock: { fromRow: false } })?.label).toBe(
      "마지막 블록을 AI 에게 묻기…",
    );
  });

  it("간이 모드(tmux 타일)에는 없다 · 헤더 ⋯ 에는 없다", () => {
    expect(termActions("ssh", { ...withBlock, screenOnly: true })).not.toContain("ask-ai");
    expect(actionsOf("local")).not.toContain("ask-ai");
  });
});

describe("menuItemsFor — 폰의 머리줄 줄들(`phone` · 10-20)", () => {
  it("`phone` 이 없으면(데스크톱 · 길게 누르기) 예전 목록 그대로다", () => {
    expect(actionsOf("local")).toEqual(actionsOf("local", { ...off, phone: undefined }));
    expect(actionsOf("local")[0]).toBe("split-row");
  });

  it("AI 타일 넘기기 · 폴더(로컬) · 브랜치가 맨 위에 서고 분할이 선을 인다(조정자 타일의 Run 줄은 2단계 단계 6 에서 걷었다)", () => {
    const rows = menuItemsFor("local", { ...off, phone: { flip: "term" } }, ko);
    expect(rows.slice(0, 4).map(rowId)).toEqual(["flip", "files", "branches", "split-row"]);
    const flip = rows[0] as PaneMenuItem;
    expect(flip.label).toBe(ko("pane.flip.toConvo"));
    expect(flip.icon).toBe("conversations");
    expect((rows[3] as PaneMenuItem).separator).toBe(true);
  });

  it("원격은 폴더 줄이 없다('서버 ▸ 원격 파일' 이 같은 일) · 대화 면이면 터미널로", () => {
    const rows = menuItemsFor("ssh", { ...off, phone: { flip: "convo" } }, ko);
    expect(rows.slice(0, 3).map(rowId)).toEqual(["flip", "branches", "split-row"]);
    expect((rows[0] as PaneMenuItem).label).toBe(ko("pane.flip.toTerm"));
  });

  it("터미널이 아닌 타일은 줄이 없어 분할에 선도 없다", () => {
    const rows = menuItemsFor("localfs", { ...off, phone: { flip: null } }, ko);
    expect(rowId(rows[0])).toBe("split-row");
    expect((rows[0] as PaneMenuItem).separator).toBeUndefined();
  });

  it("줄 그림이 생성 목록에 있다", () => {
    const rows = menuItemsFor("local", { ...off, phone: { flip: "convo" } }, ko);
    for (const r of rows.slice(0, 4)) expect(UI_ICONS[(r as PaneMenuItem).icon as keyof typeof UI_ICONS]).toBeDefined();
  });
});

describe("폰 배치(`solo` · 10-20) — 분할 둘 · 새 창으로 분리가 빠진다", () => {
  const PHONE_GONE = ["split-row", "split-col", "detach"] as const;
  const KINDS: PaneKind[] = ["local", "ssh", "query", "localfs", "branches", "doc", "sftp"];

  it("위 띠 ⋯(`phone` + `solo`) — 모든 종류에서 세 줄이 없고 나머지는 그대로다", () => {
    for (const kind of KINDS) {
      const desk = actionsOf(kind);
      const phone = actionsOf(kind, { ...off, solo: true });
      for (const id of PHONE_GONE) expect(phone).not.toContain(id);
      expect(phone).toEqual(desk.filter((id) => !(PHONE_GONE as readonly string[]).includes(id)));
    }
  });

  it("터미널 길게 누르기 메뉴에도 없다", () => {
    for (const kind of ["local", "ssh"] as PaneKind[]) {
      const list = termActions(kind, { ...bare, solo: true });
      for (const id of PHONE_GONE) expect(list).not.toContain(id);
      expect(list).toContain("close");
    }
  });

  it("데스크톱(`solo` 없음)은 예전 그대로 세 줄이 있다", () => {
    for (const id of PHONE_GONE) expect(actionsOf("local")).toContain(id);
    for (const id of PHONE_GONE) expect(termActions("ssh")).toContain(id);
  });

  it("머리줄 줄 뒤 첫 줄이 선을 이고, 머리줄 줄이 없으면 맨 윗줄에 선이 없다", () => {
    const rows = menuItemsFor("local", { ...off, solo: true, phone: { flip: "term" } }, ko);
    expect(rows.slice(0, 4).map(rowId)).toEqual(["flip", "files", "branches", "folder-conversations"]);
    expect((rows[3] as PaneMenuItem).separator).toBe(true);
    const bareRows = menuItemsFor("localfs", { ...off, solo: true, phone: { flip: null } }, ko);
    expect(bareRows.map(rowId)).toEqual(["close"]);
    expect(bareRows[0].separator).not.toBe(true);
  });
});

describe("타일이 맡긴 도구 줄(`tools` · 2026-10-20 파일 타일 B안) — 도구 ⋯ 와 타일 ⋯ 를 하나로", () => {
  const tools: PaneMenuItem[] = [
    { action: "tool:hidden", label: "숨김 파일 보기", icon: null, checkbox: true, checked: false },
    { action: "tool:places", label: "장소 패널", icon: "check", checkbox: true, checked: true },
  ];

  it("맨 위에 서고, 그 뒤 타일 항목(분할부터)이 선 하나로 갈린다", () => {
    const rows = menuItemsFor("localfs", { ...off, tools }, ko);
    expect(rows.map(rowId)).toEqual(["tool:hidden", "tool:places", ...actionsOf("localfs")]);
    expect(rows[0].separator).not.toBe(true);
    expect(rows[2].separator).toBe(true);
  });

  it("넘기지 않으면(터미널 우클릭 · 머리줄이 없는 타일) 예전 그대로다", () => {
    expect(actionsOf("sftp", { ...off, tools: [] })).toEqual(actionsOf("sftp"));
    expect(termActions("local")).not.toContain("tool:hidden");
  });
});

describe("terminalMenuItems — 사이드 채팅에 묻기(사이드 채팅 v2 5단계 · 결정 11)", () => {
  const withBlock: TermMenuCtx = { ...onRow, askBlock: { fromRow: true }, sideChat: true };

  it("주 창(sideChat)에서 블록이나 고른 글자가 있을 때만 — AI 에게 묻기 바로 아래", () => {
    const list = termActions("local", withBlock);
    expect(list.indexOf("ask-side-chat")).toBe(list.indexOf("ask-ai") + 1);
    expect(termItem("ssh", "ask-side-chat", withBlock)?.label).toBe("사이드 채팅에 묻기");
    expect(termItem("local", "ask-side-chat", withBlock)?.title).toContain("블록");
    // 고른 글자만 있어도(블록 없음 · tmux 간이 모드) 선다 — 말풍선이 글자를 말한다
    const sel: TermMenuCtx = { ...bare, hasSelection: true, sideChat: true, screenOnly: true };
    expect(termActions("ssh", sel)).toContain("ask-side-chat");
    expect(termItem("ssh", "ask-side-chat", sel)?.title).toContain("고른 글자");
  });

  it("주 창이 아니거나 넘길 것이 없으면 없다", () => {
    expect(termActions("local", { ...withBlock, sideChat: false })).not.toContain("ask-side-chat");
    expect(termActions("local", { ...bare, sideChat: true })).not.toContain("ask-side-chat");
    expect(termActions("local", { ...withBlock, screenOnly: true })).not.toContain("ask-side-chat");
  });
});

describe("오케스트레이션 탭(2026-10-29 — 노트 D11 · 0-3 Q1=B)", () => {
  const ids = (rows: PaneMenuRow[]) => rows.map(rowId);
  it("탭 밖의 로컬 AI 타일에만 [오케스트레이션으로 이어 가기]", () => {
    const on = menuItemsFor("local", { ...off, aiTile: true, orchContinue: true }, ko);
    expect(ids(on)).toContain("continue-orchestration");
    const item = on.find((r) => rowId(r) === "continue-orchestration") as PaneMenuItem;
    expect(item.label).toBe(ko("pane.menu.continueOrch"));
    // 대화·저장소를 고정한 초안 — 사이드 채팅 이어 가기와 같은 무리에 나란히.
    expect(item.title).toBe(ko("pane.menu.continueOrch.title"));
    expect(item.title).toContain("새 앨범 초안");
    const both = ids(menuItemsFor("local", { ...off, aiTile: true, orchContinue: true, sideChatFork: true }, ko));
    expect(both.indexOf("continue-orchestration")).toBe(both.indexOf("continue-side-chat") + 1);
    expect(UI_ICONS).toHaveProperty(item.icon!);
    expect(ids(menuItemsFor("local", { ...off, aiTile: true }, ko))).not.toContain("continue-orchestration");
    expect(ids(menuItemsFor("ssh", { ...off, orchContinue: true }, ko))).not.toContain("continue-orchestration");
  });
  it("오케스트레이션 탭의 타일 — 분할 둘 · 새 창으로 분리를 그리지 않는다(닫기는 남는다)", () => {
    const rows = ids(menuItemsFor("local", { ...off, aiTile: true, orchTab: true }, ko));
    for (const gone of ["split-row", "split-col", "detach"]) expect(rows).not.toContain(gone);
    expect(rows).toContain("close");
    expect(ids(menuItemsFor("run", { ...off, orchTab: true }, en))).not.toContain("split-row");
  });
});
