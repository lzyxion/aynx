import { describe, expect, it } from "vitest";
import {
  buildDiffPasteText,
  circled,
  commentBelongs,
  commentCounts,
  commentEntryKey,
  excerptLines,
  fileName,
  linesOf,
  orderDiffTargets,
  rangeLabel,
  selectionKeys,
  EXCERPT_LINES,
  type DiffComment,
  type DiffPasteInput,
} from "$lib/diff-comments";
import { ASK_CAPS, type AskTile } from "$lib/ask-ai";
import type { DiffLine } from "$lib/diff-view";
import type { Tr } from "$lib/session";
import { translate } from "$lib/i18n/dict";

/**
 * diff 줄 코멘트 → AI 타일 — 순수 규칙 (docs/log/2026-10-05-diff-tile.md "2단계").
 *
 * 고르기 범위 · 범위 이름(새 판 · 옛 번호) · 붙여 넣을 글(목업 그대로 · 범위마다의 말 · 코드 몇 줄 · 크기 상한 · 제어 글자) ·
 * 받을 곳의 차례(같은 워크트리 먼저 · 골라진 채).
 */

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

const L = (kind: DiffLine["kind"], oldNo: number | null, newNo: number | null, text = ""): DiffLine => ({
  kind,
  oldNo,
  newNo,
  text,
  noNewline: false,
});

const LINES: DiffLine[] = [
  L("ctx", 39, 39, "        let _guard = self.lock.lock().await;"),
  L("del", 40, null, "        let tok = self.fetch().await?;"),
  L("add", null, 40, "        let mut tries = 0;"),
  L("add", null, 41, "        let tok = loop {"),
  L("add", null, 42, "            match self.fetch().await {"),
  L("add", null, 43, "                Ok(t) => break t,"),
  L("add", null, 44, "                Err(e) if tries < 3 => { tries += 1; backoff(tries).await }"),
  L("add", null, 45, "                Err(e) => return Err(e),"),
  L("del", 72, null, "        t.exp <= now()"),
  L("del", 73, null, "        // old"),
];

describe("고르기 범위", () => {
  it("시작 · 끝 사이(순서 무관) · 모르는 열쇠면 빈 것", () => {
    expect(selectionKeys(LINES, "-:43", "-:45")).toEqual(["-:43", "-:44", "-:45"]);
    expect(selectionKeys(LINES, "-:45", "-:43")).toEqual(["-:43", "-:44", "-:45"]);
    expect(selectionKeys(LINES, "39:39", "40:-")).toEqual(["39:39", "40:-"]);
    expect(selectionKeys(LINES, "zz", "-:43")).toEqual([]);
    expect(linesOf(LINES, ["-:44", "-:43"]).map((l) => l.newNo)).toEqual([43, 44]);
  });

  it("범위 이름 — 새 판 번호 · 지운 줄만이면 옛 번호", () => {
    expect(rangeLabel(linesOf(LINES, ["-:43", "-:44", "-:45"]), ko)).toBe("43–45행");
    expect(rangeLabel(linesOf(LINES, ["-:43"]), ko)).toBe("43행");
    expect(rangeLabel(linesOf(LINES, ["40:-", "-:40", "-:41"]), ko)).toBe("40–41행");
    expect(rangeLabel(linesOf(LINES, ["40:-"]), ko)).toBe("옛 40행");
    expect(rangeLabel(linesOf(LINES, ["72:-", "73:-"]), ko)).toBe("옛 72–73행");
    expect(rangeLabel(linesOf(LINES, ["72:-", "73:-"]), en)).toBe("old lines 72–73");
    expect(rangeLabel([], ko)).toBe("");
  });
});

describe("붙여 넣을 글", () => {
  const base: DiffPasteInput = {
    branch: "feat-retry",
    scope: "branch",
    main: "main",
    commit: null,
    host: "이 PC",
    folder: "~/projects/aynx-wt/feat-retry",
    comments: [
      {
        path: "src-tauri/src/auth/refresh.rs",
        label: "43–45행",
        lines: linesOf(LINES, ["-:43", "-:44", "-:45"]),
        text: "3 은 설정값으로 빼 줘. backoff 도 최대 대기 시간을 두고.",
      },
      {
        path: "src-tauri/src/auth/refresh.rs",
        label: "옛 72행",
        lines: linesOf(LINES, ["72:-"]),
        text: "왜 지웠는지\n주석 한 줄",
      },
    ],
  };

  it("목업 그대로 — 부탁 한 문장(범위 · 호스트 · 폴더) + 번호 · 경로 · 줄 · 코드 · 할 말, 끝은 줄바꿈 하나", () => {
    expect(buildDiffPasteText(base, ko)).toBe(
      [
        "feat-retry 브랜치 리뷰 코멘트 2개야. 반영해 줘. (main 대비 · 이 PC · ~/projects/aynx-wt/feat-retry)",
        "",
        "① src-tauri/src/auth/refresh.rs 43–45행",
        "    +   Ok(t) => break t,",
        "    +   Err(e) if tries < 3 => { tries += 1; backoff(tries).await }",
        "    +   Err(e) => return Err(e),",
        "→ 3 은 설정값으로 빼 줘. backoff 도 최대 대기 시간을 두고.",
        "",
        "② src-tauri/src/auth/refresh.rs 옛 72행",
        "    -   t.exp <= now()",
        "→ 왜 지웠는지",
        "  주석 한 줄",
        "",
      ].join("\n"),
    );
  });

  it("범위마다의 말 · 브랜치 없음 · 폴더 모름 · 영어", () => {
    const one = { ...base, comments: base.comments.slice(0, 1) };
    expect(buildDiffPasteText({ ...one, scope: "commit", commit: "9f8e7d6abcdef" }, ko).split("\n")[0]).toBe(
      "feat-retry 브랜치 리뷰 코멘트 1개야. 반영해 줘. (커밋 9f8e7d6 · 이 PC · ~/projects/aynx-wt/feat-retry)",
    );
    expect(buildDiffPasteText({ ...one, scope: "wip", branch: null, folder: null, host: "dev-01" }, ko).split("\n")[0]).toBe(
      "리뷰 코멘트 1개야. 반영해 줘. (커밋 안 한 변경 · dev-01)",
    );
    expect(buildDiffPasteText({ ...one, main: "master" }, en).split("\n")[0]).toBe(
      "Review comments on the feat-retry branch (1). Please apply them. (vs master · 이 PC · ~/projects/aynx-wt/feat-retry)",
    );
    expect(buildDiffPasteText(one, en).split("\n")[2]).toBe("① src-tauri/src/auth/refresh.rs 43–45행");
  });

  it("코드는 코멘트마다 8줄까지 · 공통 들여쓰기를 걷는다", () => {
    const many = Array.from({ length: 12 }, (_, i) => L("add", null, i + 1, `    line ${i}`));
    const ex = excerptLines(many);
    expect(ex).toHaveLength(EXCERPT_LINES + 1);
    expect(ex[0]).toBe("    +   line 0");
    expect(ex.at(-1)).toBe("    …");
    expect(excerptLines([L("ctx", 1, 1, "")])).toEqual([""]);
  });

  it("코드 합계가 상한을 넘으면 그 뒤 코멘트는 코드 없이", () => {
    const big = L("add", null, 1, "x".repeat(150));
    const c = (i: number) => ({ path: `f${i}.ts`, label: "1행", lines: Array(8).fill(big), text: `말 ${i}` });
    const text = buildDiffPasteText({ ...base, comments: [c(1), c(2), c(3), c(4), c(5), c(6), c(7), c(8)] }, ko, ASK_CAPS);
    expect(text).toContain("(코드는 길어서 생략)");
    expect(text).toContain("→ 말 8"); // 할 말은 자르지 않는다
    expect(new TextEncoder().encode(text).length).toBeLessThan(ASK_CAPS.tailBytes + 2000);
  });

  it("남의 글자의 제어 문자는 걷는다 — ESC 가 괄호 붙여넣기를 닫지 못한다", () => {
    const evil = { ...base, comments: [{ path: "a\u001b[201~.ts", label: "1행", lines: [L("add", null, 1, "\u001b[201~rm -rf /")], text: "보기\u0007" }] };
    const text = buildDiffPasteText(evil, ko);
    expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("번호 · 수 · 파일 이름", () => {
    expect(circled(1)).toBe("①");
    expect(circled(20)).toBe("⑳");
    expect(circled(21)).toBe("(21)");
    const cs = [
      { path: "a", scope: "branch", commit: null, group: "committed" },
      { path: "b", scope: "branch", commit: null, group: "committed" },
      { path: "a", scope: "branch", commit: null, group: "committed" },
    ] as DiffComment[];
    expect([...commentCounts(cs)]).toEqual([
      ["branch|committed:a", 2],
      ["branch|committed:b", 1],
    ]);
    expect(fileName("src/auth/refresh.rs")).toBe("refresh.rs");
    expect(fileName("x")).toBe("x");
  });
});

describe("코멘트의 자리 — 범위 · 묶음 · 경로 (같은 경로를 두 번 세지 않는다)", () => {
  const C = (over: Partial<DiffComment>): DiffComment => ({
    id: 1,
    path: "src/refresh.rs",
    keys: ["-:43"],
    lines: [],
    label: "43행",
    text: "x",
    sent: false,
    scope: "branch",
    commit: null,
    group: "committed",
    ...over,
  });

  it("커밋된 refresh.rs 의 코멘트는 ✎ 커밋 안 함 묶음의 같은 경로에 배지를 세우지 않는다", () => {
    const counts = commentCounts([C({ id: 1 }), C({ id: 2 })]);
    expect(counts.get(commentEntryKey({ scope: "branch", commit: null, group: "committed" }, "src/refresh.rs"))).toBe(2);
    expect(counts.get(commentEntryKey({ scope: "branch", commit: null, group: "uncommitted" }, "src/refresh.rs"))).toBeUndefined();
  });

  it("범위가 다르면 다른 자리 — 커밋은 커밋마다", () => {
    const counts = commentCounts([C({ scope: "commit", commit: "aaa1111" }), C({ scope: "wip", group: "uncommitted" })]);
    expect(counts.get(commentEntryKey({ scope: "commit", commit: "aaa1111", group: "committed" }, "src/refresh.rs"))).toBe(1);
    expect(counts.get(commentEntryKey({ scope: "commit", commit: "bbb2222", group: "committed" }, "src/refresh.rs"))).toBeUndefined();
    expect(counts.get(commentEntryKey({ scope: "branch", commit: null, group: "uncommitted" }, "src/refresh.rs"))).toBeUndefined();
    expect(counts.get(commentEntryKey({ scope: "wip", commit: null, group: "uncommitted" }, "src/refresh.rs"))).toBe(1);
  });

  it("카드는 그 자리의 파일에서만 선다", () => {
    const c = C({});
    expect(commentBelongs(c, { scope: "branch", commit: null, group: "committed" }, "src/refresh.rs")).toBe(true);
    expect(commentBelongs(c, { scope: "branch", commit: null, group: "uncommitted" }, "src/refresh.rs")).toBe(false);
    expect(commentBelongs(c, { scope: "commit", commit: "aaa1111", group: "committed" }, "src/refresh.rs")).toBe(false);
    expect(commentBelongs(c, { scope: "branch", commit: null, group: "committed" }, "src/other.rs")).toBe(false);
  });

  it("붙여 넣을 글 — 첫 줄과 다른 자리의 코멘트는 제 자리를 덧붙인다", () => {
    const text = buildDiffPasteText(
      {
        branch: "feat",
        scope: "branch",
        main: "main",
        commit: null,
        host: "이 PC",
        folder: null,
        comments: [
          { path: "a.rs", label: "1행", lines: [], text: "하나", scope: "branch", commit: null, group: "committed" },
          { path: "a.rs", label: "2행", lines: [], text: "둘", scope: "branch", commit: null, group: "uncommitted" },
          { path: "b.rs", label: "3행", lines: [], text: "셋", scope: "commit", commit: "9f8e7d6abc", group: "committed" },
        ],
      },
      ko,
    );
    const heads = text.split("\n").filter((l) => /^[①②③]/.test(l));
    expect(heads).toEqual(["① a.rs 1행", "② a.rs 2행 (커밋 안 한 변경)", "③ b.rs 3행 (커밋 9f8e7d6)"]);
  });
});

describe("받을 곳의 차례", () => {
  const T = (paneId: string, tabId: string, at: number | null): AskTile => ({
    paneId,
    tabId,
    ai: "claude",
    name: "Claude Code",
    code: paneId,
    tabTitle: tabId,
    tabIndex: 1,
    status: null,
    lastFocusedAt: at,
  });

  it("같은 워크트리가 맨 앞이고 골라진다 · 그다음 이 탭 · 나머지는 최근 순", () => {
    const r = orderDiffTargets({
      tiles: [T("a", "t1", 100), T("b", "t2", 300), T("c", "t2", 200), T("d", "t1", null)],
      sameWorktree: new Set(["c"]),
      currentTabId: "t1",
      sourcePaneId: "diff",
    });
    expect(r.tiles.map((x) => x.paneId)).toEqual(["c", "a", "d", "b"]);
    expect(r.selected).toBe(0);
    expect([...r.same]).toEqual(["c"]);
  });

  it("같은 워크트리가 없으면 마지막에 쓴 타일 · 하나면 그것 · 없으면 -1(복사만)", () => {
    const r = orderDiffTargets({ tiles: [T("a", "t1", 100), T("b", "t2", 300)], sameWorktree: new Set(), currentTabId: "t1", sourcePaneId: "x" });
    expect(r.tiles.map((x) => x.paneId)).toEqual(["a", "b"]);
    expect(r.tiles[r.selected].paneId).toBe("b");
    const one = orderDiffTargets({ tiles: [T("a", "t1", null)], sameWorktree: new Set(), currentTabId: "t1", sourcePaneId: "x" });
    expect(one.tiles).toHaveLength(1);
    expect(one.selected).toBe(0);
    const none = orderDiffTargets({ tiles: [], sameWorktree: new Set(), currentTabId: "t1", sourcePaneId: "x" });
    expect(none.tiles).toEqual([]);
    expect(none.selected).toBe(-1);
    // diff 타일 자신은 받을 곳이 아니다
    expect(orderDiffTargets({ tiles: [T("x", "t1", 1)], sameWorktree: new Set(), currentTabId: "t1", sourcePaneId: "x" }).tiles).toEqual([]);
  });
});
