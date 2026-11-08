// 앨범 보관함의 순수 판정 — [보관] 단추 · 보관함 줄 표시 · 영구 삭제 상자 · 이벤트.
import { describe, expect, it } from "vitest";
import { ko } from "$lib/i18n/ko/index";
import { en } from "$lib/i18n/en/index";
import { runStatePhrase, shownRunState, interruptedAlbums, LIST_REFRESH_MS, archiveBlockedText, archiveDeleteDialog, archiveGate, archivedRowActions, archivedRowChips, changeAction, libraryRowActions, libraryRowChips, filterLibraryRuns, listRefreshDue, trackCountText, worktreesLeftText, type RunState, type RunSummary } from "$lib/orchestration/model";

import homeSource from "./player/Home.svelte?raw";

const tr = ((key: string) => key) as never;

describe("archiveGate", () => {
  it("도는 앨범에는 단추가 없다", () => {
    for (const state of ["running", "paused", "stopping"] as RunState[]) {
      expect(archiveGate({ state, worktreesLeft: 0 })).toBe("none");
      expect(archiveGate({ state, worktreesLeft: 3 })).toBe("none");
    }
  });
  it("끝난 앨범은 worktree 가 남으면 끄고 없으면 켠다", () => {
    for (const state of ["done", "stopped", "orphaned"] as RunState[]) {
      expect(archiveGate({ state, worktreesLeft: 0 })).toBe("ready");
      expect(archiveGate({ state, worktreesLeft: 2 })).toBe("blocked");
      // 칸이 없는 옛 서버 — 판정은 서버 답에 맡긴다.
      expect(archiveGate({ state })).toBe("ready");
    }
  });
});

describe("앨범 줄의 칩", () => {
  const kinds = (chips: { kind: string }[]) => chips.map((c) => c.kind);
  it("보관함 — 내보내지 않은 결과가 먼저 · 내보냄 · 없음", () => {
    expect(kinds(archivedRowChips({ unexported: true, exportedBranch: null }, tr))).toEqual(["unexported"]);
    expect(kinds(archivedRowChips({ unexported: true, exportedBranch: "orch-1-int" }, tr))).toEqual(["unexported"]);
    expect(archivedRowChips({ unexported: false, exportedBranch: "orch-1-int" }, tr)).toEqual([{ kind: "exported", tone: "ok", icon: "git-branch", label: "orch.archive.chip.exported", title: "orch-1-int" }]);
    expect(archivedRowChips({ unexported: false, exportedBranch: null }, tr)).toEqual([]);
  });
  it("라이브러리 — worktree 남음 · 내보냄 · 둘 다 · 없음", () => {
    expect(kinds(libraryRowChips({ state: "stopped", worktreesLeft: 2 }, tr))).toEqual(["worktrees"]);
    expect(kinds(libraryRowChips({ state: "done", worktreesLeft: 0, exportedBranch: "b" }, tr))).toEqual(["exported"]);
    expect(kinds(libraryRowChips({ state: "done", worktreesLeft: 1, exportedBranch: "b" }, tr))).toEqual(["worktrees", "exported"]);
    expect(libraryRowChips({ state: "done", worktreesLeft: 0, exportedBranch: null }, tr)).toEqual([]);
    expect(libraryRowChips({ state: "running", worktreesLeft: 2 }, tr)).toEqual([]);
    const chip = libraryRowChips({ state: "stopped", worktreesLeft: 2 }, tr)[0];
    expect([chip.tone, chip.icon, chip.title]).toEqual(["warn", "warning", "orch.home.recent.worktrees.many"]);
  });
});

describe("앨범 줄의 아이콘 단추", () => {
  const kinds = (run: Parameters<typeof libraryRowActions>[0]) => libraryRowActions(run, tr).map((a) => a.kind);
  it("상태별로 서는 단추", () => {
    expect(kinds({ state: "running", worktreesLeft: 0 })).toEqual([]);
    expect(kinds({ state: "stopped", worktreesLeft: 0 })).toEqual(["archive"]);
    expect(kinds({ state: "done", worktreesLeft: 0 })).toEqual(["archive"]);
    expect(kinds({ state: "done", worktreesLeft: 1 })).toEqual(["cleanup", "archive"]);
    expect(archivedRowActions(tr).map((a) => a.kind)).toEqual(["restore", "delete"]);
  });
  it("막힌 보관은 끄고 이름 · 툴팁에 이유를 싣는다", () => {
    const blocked = libraryRowActions({ state: "stopped", worktreesLeft: 1 }, tr).find((a) => a.kind === "archive")!;
    expect(blocked.blocked).toBe(true);
    expect(blocked.title).toBe("orch.archive.blocked.tip");
    expect(blocked.aria).toBe("orch.archive.btn (orch.archive.blocked.tip)");
    expect(libraryRowActions({ state: "stopped", worktreesLeft: 0 }, tr)[0].blocked).toBe(false);
  });
  it("아이콘 · 이름은 문구 표와 묶인다 — 위험 색은 영구 삭제만", () => {
    const all = [...libraryRowActions({ state: "done", worktreesLeft: 1 }, tr), ...archivedRowActions(tr)];
    expect(Object.fromEntries(all.map((a) => [a.kind, a.icon]))).toEqual({ cleanup: "cleanup", archive: "archive", restore: "album-restore", delete: "trash" });
    expect(all.filter((a) => a.danger).map((a) => a.kind)).toEqual(["delete"]);
    for (const a of all.filter((x) => !x.blocked)) {
      const key = a.aria.replace(/^orch\./, "");
      expect((ko.orch as Record<string, string>)[key], key).toBeTruthy();
      expect((en.orch as Record<string, string>)[key], key).toBeTruthy();
      expect(a.title).toBeTruthy();
    }
  });
  it("줄 단추는 폰에서도 글자 없이 아이콘 하나다 — 이름은 aria-label · title", () => {
    const buttons = homeSource.match(/<button type="button" class="icon-btn"[^\n]*<\/button>/g) ?? [];
    expect(buttons.length).toBe(2);
    for (const b of buttons) {
      expect(b).toContain("aria-label={act.aria}");
      expect(b).toContain("title={act.title}");
      // 여는 태그 바로 뒤가 아이콘이고 그 뒤가 곧 닫는 태그다 — 글자가 낄 자리가 없다.
      expect(b).toMatch(/\}><UiIcon name=\{act\.icon\} size=\{phone \? 20 : 16\} \/><\/button>$/);
    }
    expect(homeSource).toContain(".home.phone .icon-btn { width: 44px; height: 44px; }");
  });
});

describe("archiveDeleteDialog", () => {
  const results = (a: { unexported: boolean; exportable: boolean }) => archiveDeleteDialog({ name: "A", ...a }, tr).choices.map((c) => c.result);
  it("내보내지 않은 결과가 없으면 경고 · [먼저 내보내기] 없이 [취소] · [영구 삭제]", () => {
    const d = archiveDeleteDialog({ name: "A", unexported: false, exportable: false }, tr);
    expect(d.callout).toBeUndefined();
    expect(results({ unexported: false, exportable: false })).toEqual(["cancel", "delete"]);
  });
  it("내보낼 수 있으면 경고 + [먼저 내보내기] — 취소가 왼쪽 · 위험 단추가 오른쪽 끝", () => {
    const d = archiveDeleteDialog({ name: "A", unexported: true, exportable: true }, tr);
    expect(d.callout).toBe("orch.archive.delete.warn");
    expect(d.choices.map((c) => c.result)).toEqual(["cancel", "export", "delete"]);
    expect(d.choices.filter((c) => c.cancel).map((c) => c.result)).toEqual(["cancel"]);
    expect(d.choices.at(-1)?.tone).toBe("danger");
  });
  it("내보낼 수 없으면(읽기 전용 · 저장소 없음) 경고는 서되 막다른 단추는 없다", () => {
    const d = archiveDeleteDialog({ name: "A", unexported: true, exportable: false }, tr);
    expect(d.callout).toBe("orch.archive.delete.warn.readonly");
    expect(d.choices.map((c) => c.result)).toEqual(["cancel", "delete"]);
  });
  it("남는 것 칸은 늘 있다", () => {
    expect(archiveDeleteDialog({ name: "A", unexported: false, exportable: false }, tr).section.text).toBe("orch.archive.delete.kept.text");
  });
});

describe("목록 다시 읽기 간격", () => {
  it("보일 때만 · 간격이 지났을 때만 · 첫 읽기 전에는 서지 않는다", () => {
    expect(listRefreshDue(true, 1_000, 1_000 + LIST_REFRESH_MS)).toBe(true);
    expect(listRefreshDue(true, 1_000, 1_000 + LIST_REFRESH_MS - 1)).toBe(false);
    expect(listRefreshDue(false, 1_000, 1_000 + LIST_REFRESH_MS)).toBe(false);
    expect(listRefreshDue(true, null, 1_000 + LIST_REFRESH_MS)).toBe(false);
  });
});

describe("수 문구", () => {
  const lang = (table: Record<string, string>) =>
    ((key: string, p?: Record<string, string | number>) => table[key.replace(/^orch\./, "")].replace("{n}", String(p?.n))) as never;
  it("영어는 1 일 때 단수", () => {
    const tr = lang(en.orch as Record<string, string>);
    expect([0, 1, 2].map((n) => trackCountText(n, tr))).toEqual(["0 tracks", "1 track", "2 tracks"]);
    expect(worktreesLeftText(1, tr)).toBe("1 worktree left — clean up, then archive");
    expect(worktreesLeftText(2, tr)).toBe("2 worktrees left — clean up, then archive");
    expect(archiveBlockedText(1, tr)).toMatch(/^1 artist worktree is left\./);
    expect(archiveBlockedText(2, tr)).toMatch(/^2 artist worktrees are left\./);
  });
  it("한국어 트랙 수는 어디서나 '트랙 n' 한 가지", () => {
    const tr = lang(ko.orch as Record<string, string>);
    expect([0, 1, 2].map((n) => trackCountText(n, tr))).toEqual(["트랙 0", "트랙 1", "트랙 2"]);
    for (const key of ["library.row.meta", "archive.row.meta", "home.card.meta"]) {
      expect((ko.orch as Record<string, string>)[key]).not.toContain("트랙");
      expect((en.orch as Record<string, string>)[key]).not.toContain("} tracks");
    }
  });
});

describe("보관함 필터와 이벤트", () => {
  const run = (runId: string, state: RunState) => ({ runId, state, repo: "r", updatedAt: 1, createdAt: 1 }) as RunSummary;
  it("보관함 칩이 골라져 있으면 라이브러리 줄은 없다(다른 목록이다)", () => {
    const list = [run("a", "running"), run("b", "done")];
    expect(filterLibraryRuns(list, "archived", null)).toEqual([]);
    expect(filterLibraryRuns(list, "ended", null).map((r) => r.runId)).toEqual(["b"]);
    expect(filterLibraryRuns(list, "live", null).map((r) => r.runId)).toEqual(["a"]);
  });
  it("보던 앨범이 복원되면 seq 가 같아도 다시 읽는다 · 보관되면 사라진다", () => {
    expect(changeAction({ runId: "r", seq: 5, archive: true }, "r", 5)).toBe("refetch");
    expect(changeAction({ runId: "r", seq: 5, archive: true, closed: true }, "r", 5)).toBe("closed");
    expect(changeAction({ runId: "x", seq: 5, archive: true }, "r", 5)).toBe("skip");
    expect(changeAction({ runId: "r", seq: 5 }, "r", 5)).toBe("skip");
  });
});

describe("shownRunState — 사람에게 보일 상태", () => {
  it("서버 재시작 뒤에는 재시작 전의 끝난 상태 · 그 밖은 그대로", () => {
    expect(shownRunState("orphaned", "done")).toBe("done");
    expect(shownRunState("orphaned", "stopped")).toBe("stopped");
    expect(shownRunState("orphaned", "running")).toBe("orphaned");
    expect(shownRunState("orphaned", null)).toBe("orphaned");
    expect(shownRunState("running", null)).toBe("running");
  });

  it("읽기 전용 띠는 돌던 중 멈춘 앨범에만", () => {
    const phrase = (previousState: RunState | null) => runStatePhrase({ state: "orphaned", pauseReason: null, previousState }, tr);
    expect(phrase("done")).toBeNull();
    expect(phrase("stopped")).toBeNull();
    expect(phrase("running")).not.toBeNull();
    expect(phrase(null)).not.toBeNull();
  });

  it("앱을 켤 때 알릴 앨범 = 돌던 중 멈춘 것만", () => {
    const r = (orphaned: boolean, previousState?: string | null) => ({ orphaned, previousState });
    const list = [r(true, "done"), r(true, "stopped"), r(true, "stopping"), r(true, null), r(true), r(false, "running"), r(true, "running"), r(true, "paused")];
    expect(interruptedAlbums(list).map((x) => x.previousState)).toEqual(["running", "paused"]);
  });
});
