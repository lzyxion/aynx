import { describe, expect, it } from "vitest";
import {
  dragKind,
  dropLabel,
  dropPlan,
  fsPasteLabel,
  isForeignDrag,
  type DragKind,
  type DropOutcome,
} from "$lib/pane/drop-rules";
import { FS_DRAG_TYPE } from "$lib/fs-drag";
import { HOSTS_DRAG_TYPE } from "$lib/hosts";
import { PANE_DRAG_TYPE, TAB_DRAG_TYPE, type PaneKind } from "$lib/session";
import { TEAR_DRAG_TYPE } from "$lib/tear";
import { translate } from "$lib/i18n/dict";

// ---------------------------------------------------------------------------
// 이 파일은 **판정 표 그대로**다 (docs/log/2026-09-05-refactor-pane-host.md).
// 표의 칸이 하나 바뀌면 여기가 그 자리에서 빨개진다.
// ---------------------------------------------------------------------------

/** 커서 아래 타일 하나 — 신원은 전부 같은 값이라 판정에서 갈리는 것은 `kind` 뿐이다 */
const on = (kind: PaneKind | null) => ({ kind, tabId: "tab-1", paneId: "pane-1" });

/** 문구는 사전을 거친다 — 화면에서는 `t` 가 들어오는 자리다 (`i18n/ko/pane.ts` 머리말) */
const ko = (key: Parameters<typeof translate>[1]) => translate("ko", key);
const en = (key: Parameters<typeof translate>[1]) => translate("en", key);

describe("dragKind", () => {
  it("우리 종류를 알아본다", () => {
    expect(dragKind([HOSTS_DRAG_TYPE])).toBe("hosts");
    expect(dragKind([FS_DRAG_TYPE])).toBe("fsfiles");
    expect(dragKind([TAB_DRAG_TYPE])).toBe("tab");
    expect(dragKind([PANE_DRAG_TYPE])).toBe("pane");
    expect(dragKind(["Files"])).toBe("files");
  });

  it("남의 드래그와 빈 목록은 `null`", () => {
    expect(dragKind(["text/plain", "text/uri-list"])).toBeNull();
    expect(dragKind([])).toBeNull();
    expect(dragKind(undefined)).toBeNull();
  });

  it("내부 종류가 `Files` 보다 **먼저**다 — 플랫폼이 끼워 넣는 `Files` 에 속지 않는다", () => {
    expect(dragKind([PANE_DRAG_TYPE, "Files"])).toBe("pane");
    expect(dragKind(["Files", TAB_DRAG_TYPE])).toBe("tab");
    expect(dragKind(["Files", HOSTS_DRAG_TYPE])).toBe("hosts");
  });

  it("우선순위는 hosts → fsfiles → tab → pane → files", () => {
    expect(dragKind([HOSTS_DRAG_TYPE, FS_DRAG_TYPE, TAB_DRAG_TYPE])).toBe("hosts");
    expect(dragKind([FS_DRAG_TYPE, TAB_DRAG_TYPE, PANE_DRAG_TYPE])).toBe("fsfiles");
    expect(dragKind([TAB_DRAG_TYPE, PANE_DRAG_TYPE])).toBe("tab");
  });

  it("`x-aynx-tear` 는 종류가 아니라 **덧실린 표식**이다", () => {
    expect(dragKind([TEAR_DRAG_TYPE])).toBeNull();
    expect(dragKind([PANE_DRAG_TYPE, TEAR_DRAG_TYPE])).toBe("pane");
  });
});

describe("isForeignDrag", () => {
  const none = { tab: null, pane: null };

  it("tear 표식이 없으면 언제나 이 창의 것이다", () => {
    expect(isForeignDrag([TAB_DRAG_TYPE], "tab", none)).toBe(false);
    expect(isForeignDrag([PANE_DRAG_TYPE], "pane", none)).toBe(false);
  });

  it("tear 표식 + 이 창의 드래그 표시가 비었다 = 남의 창", () => {
    expect(isForeignDrag([TAB_DRAG_TYPE, TEAR_DRAG_TYPE], "tab", none)).toBe(true);
    expect(isForeignDrag([PANE_DRAG_TYPE, TEAR_DRAG_TYPE], "pane", none)).toBe(true);
  });

  it("이 창이 끌고 있으면 tear 가 실려 있어도 내 것이다 (창 안 이동)", () => {
    expect(
      isForeignDrag([TAB_DRAG_TYPE, TEAR_DRAG_TYPE], "tab", { tab: "tab-9", pane: null }),
    ).toBe(false);
    expect(
      isForeignDrag([PANE_DRAG_TYPE, TEAR_DRAG_TYPE], "pane", { tab: null, pane: "pane-9" }),
    ).toBe(false);
  });

  it("탭·타일이 아닌 종류는 창을 넘지 않는다", () => {
    expect(isForeignDrag([HOSTS_DRAG_TYPE, TEAR_DRAG_TYPE], "hosts", none)).toBe(false);
    expect(isForeignDrag(["Files", TEAR_DRAG_TYPE], "files", none)).toBe(false);
  });
});

describe("dropPlan — 판정 표", () => {
  it("커서 아래에 타일이 없으면(분할선 위) 무엇이든 무동작", () => {
    for (const kind of ["hosts", "fsfiles", "tab", "pane", "files"] as DragKind[]) {
      const drag = { kind, foreign: false, sourceTabId: "t", sourcePaneId: "p" };
      const plan = dropPlan(drag, on(null), "left");
      expect(plan.outcome).toBe("none");
      expect(plan.accept).toBe(false);
    }
  });

  // ── 호스트·폴더 ───────────────────────────────────────────────────────────
  describe("호스트·폴더", () => {
    const drag = { kind: "hosts" as const, foreign: false };

    it.each<[PaneKind, DropOutcome]>([
      ["ssh", "open"],
      ["local", "open"],
      ["sftp", "open"],
      ["localfs", "open"],
      ["start", "open"],
      ["doc", "open"],
    ])("%s 타일 위 → %s", (kind, outcome) => {
      expect(dropPlan(drag, on(kind), "left").outcome).toBe(outcome);
    });

    it("여는 조작이라 커서는 `copy` 다 (독의 트리에서 사라지지 않는다)", () => {
      const plan = dropPlan(drag, on("ssh"), "right");
      expect(plan.accept).toBe(true);
      expect(plan.effect).toBe("copy");
      expect(plan.split).toEqual({ dir: "row", side: "after" });
    });

    it("**양보하는 자리가 없다** — 트리를 담는 독은 타일 위에 뜬 층이라 놓는 곳이 아니다", () => {
      const kinds: PaneKind[] = ["ssh", "local", "sftp", "localfs", "start", "doc"];
      for (const kind of kinds) expect(dropPlan(drag, on(kind), "left").accept).toBe(true);
    });
  });

  // ── OS 파일 ───────────────────────────────────────────────────────────────
  describe("OS 파일", () => {
    const drag = { kind: "files" as const, foreign: false };

    it.each<PaneKind>(["local", "ssh"])("%s AI 타일에는 업로드 대신 첨부한다", (kind) => {
      const plan = dropPlan(drag, { ...on(kind), agent: true }, "top");
      expect(plan).toEqual({ outcome: "attach", accept: true, effect: "copy", preview: "all", split: null });
      expect(dropLabel("attach", kind, ko)).toBe("AI 입력창에 파일 첨부");
      expect(dropLabel("attach", kind, en)).toBe("Attach files to the AI prompt");
    });

    it("AI 신원만으로 파일 타일의 복사/업로드 경로를 바꾸지 않는다", () => {
      expect(dropPlan(drag, { ...on("localfs"), agent: true }, "top").outcome).toBe("upload");
    });

    it.each<[PaneKind, DropOutcome]>([
      ["ssh", "upload"],
      ["local", "upload"],
      ["sftp", "upload"],
      ["localfs", "upload"],
      ["start", "upload"],
      ["doc", "upload"], // 문서 타일도 설정처럼 받고 문구로 거절한다
      ["query", "yield"], // 쿼리 타일이 `.sql` 을 새 스크립트 탭으로 스스로 받는다
    ])("%s 타일 위 → %s", (kind, outcome) => {
      expect(dropPlan(drag, on(kind), "top").outcome).toBe(outcome);
    });

    it("4분면이 아니라 **상자 전체**를 덮는다 (나누는 조작이 아니다)", () => {
      const plan = dropPlan(drag, on("ssh"), "top");
      expect(plan.preview).toBe("all");
      expect(plan.split).toBeNull();
      expect(plan.effect).toBe("copy");
    });
  });

  // ── 파일 짐 (파일 타일에서 끌어온 경로 묶음) ────────────────────────────────
  describe("파일 짐", () => {
    const drag = { kind: "fsfiles" as const, foreign: false };

    it.each<[PaneKind, DropOutcome]>([
      ["ssh", "paste"],
      ["local", "paste"],
      ["sftp", "yield"], // 그 브라우저가 폴더 줄·빈 바닥에서 받는다
      ["localfs", "yield"],
      ["start", "none"],
      ["doc", "none"], // 읽기 전용 — 경로 짐을 받을 자리가 없다(기본 NONE)
      ["query", "yield"], // 쿼리 타일이 스스로 받는다(`.sql` → 새 스크립트 탭)
    ])("%s 타일 위 → %s", (kind, outcome) => {
      expect(dropPlan(drag, on(kind), "bottom").outcome).toBe(outcome);
    });

    it("터미널 위에서는 상자 전체를 덮고 받는다", () => {
      const plan = dropPlan(drag, on("local"), "bottom");
      expect(plan.accept).toBe(true);
      expect(plan.preview).toBe("all");
    });
  });

  // ── 탭 ────────────────────────────────────────────────────────
  describe("탭", () => {
    it("다른 탭 위 → 병합", () => {
      const plan = dropPlan(
        { kind: "tab", foreign: false, sourceTabId: "tab-2" },
        on("ssh"),
        "left",
      );
      expect(plan.outcome).toBe("merge");
      expect(plan.effect).toBe("move");
      expect(plan.split).toEqual({ dir: "row", side: "before" });
    });

    it("**자기 자신 위**는 무시한다 (트리를 제 안에 넣는 꼴)", () => {
      const plan = dropPlan({ kind: "tab", foreign: false, sourceTabId: "tab-1" }, on("ssh"), "left");
      expect(plan.outcome).toBe("none");
      expect(plan.accept).toBe(false);
    });

    it("끌린 id 를 모르면(표시가 비었다) 무동작", () => {
      const unknown = dropPlan({ kind: "tab", foreign: false, sourceTabId: null }, on("ssh"), "left");
      const empty = dropPlan({ kind: "tab", foreign: false, sourceTabId: "" }, on("ssh"), "left");
      expect(unknown.outcome).toBe("none");
      expect(empty.outcome).toBe("none");
    });

    it("**다른 창**의 것이면 id 가 같아도 합치기다 (카운터가 창마다 따로 돈다)", () => {
      const plan = dropPlan({ kind: "tab", foreign: true, sourceTabId: "tab-1" }, on("ssh"), "bottom");
      expect(plan.outcome).toBe("adopt");
      expect(plan.split).toEqual({ dir: "col", side: "after" });
    });
  });

  // ── 타일 ─────────────────────────────────────────────────────────────────
  describe("타일", () => {
    it("다른 타일 위 → 이동", () => {
      const plan = dropPlan(
        { kind: "pane", foreign: false, sourcePaneId: "pane-2" },
        on("ssh"),
        "top",
      );
      expect(plan.outcome).toBe("move");
      expect(plan.split).toEqual({ dir: "col", side: "before" });
    });

    it("제자리는 무시한다", () => {
      expect(
        dropPlan({ kind: "pane", foreign: false, sourcePaneId: "pane-1" }, on("ssh"), "top").outcome,
      ).toBe("none");
    });

    it("**다른 창**의 타일이면 id 가 같아도 합치기다", () => {
      expect(
        dropPlan({ kind: "pane", foreign: true, sourcePaneId: "pane-1" }, on("ssh"), "top").outcome,
      ).toBe("adopt");
    });
  });

  // ── 시작 타일의 예외 ──────────────────────────────────────────────────────
  describe("시작 타일", () => {
    it("나누는 조작이어도 미리보기는 **상자 전체**다 (놓으면 교체이기 때문)", () => {
      expect(dropPlan({ kind: "hosts", foreign: false }, on("start"), "left").preview).toBe("all");
      expect(
        dropPlan({ kind: "tab", foreign: false, sourceTabId: "tab-2" }, on("start"), "right").preview,
      ).toBe("all");
      expect(
        dropPlan({ kind: "pane", foreign: false, sourcePaneId: "pane-2" }, on("start"), "top").preview,
      ).toBe("all");
    });

    it("그래도 넣을 자리(4분면)는 그대로 넘긴다 — 잎이 여럿이면 뜻을 갖는다", () => {
      expect(dropPlan({ kind: "hosts", foreign: false }, on("start"), "bottom").split).toEqual({
        dir: "col",
        side: "after",
      });
    });
  });

  it("4분면 넷이 전부 `ZONE_SPLIT` 그대로 나온다", () => {
    const drag = { kind: "hosts" as const, foreign: false };
    expect(dropPlan(drag, on("ssh"), "left").split).toEqual({ dir: "row", side: "before" });
    expect(dropPlan(drag, on("ssh"), "right").split).toEqual({ dir: "row", side: "after" });
    expect(dropPlan(drag, on("ssh"), "top").split).toEqual({ dir: "col", side: "before" });
    expect(dropPlan(drag, on("ssh"), "bottom").split).toEqual({ dir: "col", side: "after" });
  });
});

describe("dropLabel", () => {
  it("붙여넣기는 타일 종류와 무관하게 한 문장이다", () => {
    expect(dropLabel("paste", "ssh", ko)).toBe("터미널에 경로 붙여넣기");
    expect(dropLabel("paste", "local", ko)).toBe("터미널에 경로 붙여넣기");
  });

  it("업로드는 목적지가 문구를 정한다", () => {
    expect(dropLabel("upload", "ssh", ko)).toBe("이 서버로 업로드");
    expect(dropLabel("upload", "sftp", ko)).toBe("이 폴더로 업로드");
    expect(dropLabel("upload", "localfs", ko)).toBe("이 폴더로 복사");
  });

  it("올릴 원격이 없는 타일에는 거절 문구가 뜬다", () => {
    expect(dropLabel("upload", "local", ko)).toBe("SSH 타일에만 업로드할 수 있습니다");
    expect(dropLabel("upload", "start", ko)).toBe("SSH 타일에만 업로드할 수 있습니다");
    expect(dropLabel("upload", "doc", ko)).toBe("SSH 타일에만 업로드할 수 있습니다");
  });
});

describe("dropLabel — 문구는 사전에서 온다", () => {
  it("같은 판정이 언어만 갈아입는다", () => {
    expect(dropLabel("paste", "ssh", en)).toBe("Paste path into the terminal");
    expect(dropLabel("upload", "local", en)).toBe("Uploads are only possible on SSH tiles");
  });
});

describe("fsPasteLabel — 파일 타일 짐의 오버레이 문구", () => {
  it("AI 타일: 다른 서버만 거절 문구, 그 밖은 첨부", () => {
    for (const route of ["same", "upload", "download", null] as const) {
      expect(fsPasteLabel(route, true)).toBe("attach");
    }
    expect(fsPasteLabel("foreign", true)).toBe("attach.otherserver");
  });

  it("일반 셸: 같은 곳(또는 모름)만 붙여넣기, 다른 곳은 놓을 수 없다는 문구", () => {
    expect(fsPasteLabel("same", false)).toBe("paste");
    expect(fsPasteLabel(null, false)).toBe("paste");
    for (const route of ["upload", "download", "foreign"] as const) {
      expect(fsPasteLabel(route, false)).toBe("paste.elsewhere");
    }
  });

  it("새 문구도 사전에서 온다", () => {
    expect(dropLabel("paste.elsewhere", "local", ko)).toBe("이 터미널이 있는 곳의 파일이 아니라 붙여넣을 수 없습니다");
    expect(dropLabel("attach.otherserver", "ssh", en)).toBe("Files from another server cannot be attached to this tile");
  });
});
