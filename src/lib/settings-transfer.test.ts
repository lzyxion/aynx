import { describe, expect, it } from "vitest";
import {
  buildChoices,
  changeCount,
  defaultExportName,
  exportBytes,
  exportOrder,
  importOrder,
  todoKind,
  formatBytes,
  initialPicks,
  itemWrites,
  itemDisplay,
  numberDuplicates,
  statusCounts,
  unresolvedFolders,
  type ImportPreview,
  type PreviewItem,
} from "./settings-transfer";

const it_ = (key: string, status: PreviewItem["status"], aiGrant = false): PreviewItem => ({
  key,
  label: key,
  status,
  aiGrant,
  note: null,
});

const preview: ImportPreview = {
  appVersion: "0.1.3",
  exportedAt: "2026-11-17T00:00:00Z",
  categories: [
    { id: "hosts", items: [it_("host:a", "new"), it_("host:b", "same")], choices: ["overwrite", "skip"], missingFolders: [] },
    {
      id: "ai",
      items: [it_("target:a", "new", true), it_("database:x", "changed", true), it_("settings:automation", "changed")],
      choices: ["overwrite", "skip"],
      missingFolders: [],
    },
    { id: "keys", items: [it_("snippets:s", "same")], choices: ["overwrite", "skip", "both"], missingFolders: [] },
    {
      id: "projects",
      items: [it_("project:p1", "new")],
      choices: ["overwrite", "skip", "both"],
      missingFolders: [{ id: "p1", name: "P", path: "Z:\\x" }],
    },
  ],
};

describe("settings-transfer", () => {
  it("counts statuses", () => {
    expect(statusCounts(preview.categories[1]!.items)).toEqual({ new: 1, changed: 2, same: 0 });
  });

  it("turns on only categories with changes, overwrite by default", () => {
    const picks = initialPicks(preview);
    expect(picks.hosts).toEqual({ on: true, conflict: "overwrite" });
    expect(picks.keys!.on).toBe(false);
  });

  it("change count follows conflict and AI mode — AI permission as-is by default", () => {
    const picks = initialPicks(preview);
    expect(changeCount(preview, picks, "asIs")).toBe(1 + 3 + 1);
    // Off 로 들이기 — 위임 블록 둘이 빠지고 [automation] 은 남는다
    expect(changeCount(preview, picks, "off")).toBe(1 + 1 + 1);
    picks.ai = { on: true, conflict: "skip" };
    expect(changeCount(preview, picks, "asIs")).toBe(1 + 1 + 1);
    picks.hosts = { on: false, conflict: "overwrite" };
    expect(changeCount(preview, picks, "asIs")).toBe(1 + 1);
  });

  it("item rule mirrors the backend", () => {
    const pick = { on: true, conflict: "both" as const };
    expect(itemWrites(it_("x", "same"), pick, "asIs")).toBe(false);
    expect(itemWrites(it_("x", "changed"), pick, "asIs")).toBe(true);
    expect(itemWrites(it_("x", "new", true), pick, "off")).toBe(false);
    expect(itemWrites(it_("x", "new"), { on: false, conflict: "overwrite" }, "asIs")).toBe(false);
  });

  it("builds choices in category order with trimmed remaps", () => {
    const picks = initialPicks(preview);
    const c = buildChoices(picks, "off", { p1: "  C:\\repo ", p2: " " });
    expect(c.categories).toEqual(["hosts", "ai", "projects"]);
    expect(c.conflict).toEqual({ hosts: "overwrite", ai: "overwrite", projects: "overwrite" });
    expect(c.aiMode).toBe("off");
    expect(c.remap).toEqual({ p1: "C:\\repo" });
  });

  it("missing folders until re-picked", () => {
    const cat = preview.categories[3];
    expect(unresolvedFolders(cat, {})).toBe(1);
    expect(unresolvedFolders(cat, { p1: "C:\\repo" })).toBe(0);
    expect(unresolvedFolders(undefined, {})).toBe(0);
  });

  it("sizes and names", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(4.2 * 1024 * 1024)).toBe("4.2 MB");
    expect(formatBytes(42 * 1024 * 1024)).toBe("42 MB");
    expect(
      exportBytes(
        [
          { id: "hosts", count: 1, bytes: 10 },
          { id: "ai", count: 1, bytes: 5 },
        ],
        new Set(["hosts"]),
      ),
    ).toBe(10);
    expect(defaultExportName(new Date(2026, 10, 7))).toBe("aynx-settings-2026-11-07.zip");
  });
});

describe("settings-transfer order and actions", () => {
  it("sinks empty categories, keeping order", () => {
    expect(
      exportOrder([
        { id: "hosts", count: 0, bytes: 0 },
        { id: "ai", count: 2, bytes: 1 },
        { id: "db", count: 0, bytes: 0 },
        { id: "projects", count: 1, bytes: 1 },
      ]).map((c) => c.id),
    ).toEqual(["ai", "projects", "hosts", "db"]);
    expect(importOrder(preview.categories).map((c) => c.id)).toEqual(["hosts", "ai", "projects", "keys"]);
    expect(preview.categories.map(todoKind)).toEqual(["append", "segment", "keep", "add"]);
  });
});

describe("itemDisplay — 미리 보기 항목의 보이는 이름", () => {
  it("settings.toml 의 절 이름을 문구 키로", () => {
    expect(itemDisplay({ key: "settings:app", label: "[app]" })).toEqual({ key: "settings.transfer.section.app", detail: null });
    expect(itemDisplay({ key: "settings:triggers", label: "[[triggers]]" })).toEqual({
      key: "settings.transfer.section.triggers",
      detail: null,
    });
  });
  it("모르는 절은 원래 이름 그대로", () => {
    expect(itemDisplay({ key: "settings:future", label: "[future]" })).toEqual({ key: null, detail: "[future]" });
  });
  it("그림 · 테마 · 지침 파일", () => {
    expect(itemDisplay({ key: "file:wp-2c172e975c89.png", label: "wp-2c172e975c89.png" }).key).toBe("settings.transfer.file.wallpaper");
    expect(itemDisplay({ key: "file:app-icons/user-ab12.png", label: "user-ab12.png" }).key).toBe("settings.transfer.file.avatar");
    expect(itemDisplay({ key: "file:terminal-themes/nord.json", label: "nord.json" })).toEqual({
      key: "settings.transfer.file.termTheme",
      detail: "nord",
    });
    expect(itemDisplay({ key: "file:instructions/review.md", label: "review.md" })).toEqual({ key: null, detail: "review" });
  });
  it("같은 이름은 순서대로 번호 · 하나뿐이면 그대로", () => {
    expect(numberDuplicates(["화면 설정", "월페이퍼 그림", "GPT", "월페이퍼 그림"])).toEqual([
      "화면 설정",
      "월페이퍼 그림 1",
      "GPT",
      "월페이퍼 그림 2",
    ]);
    expect(numberDuplicates([])).toEqual([]);
  });
  it("이름 있는 항목(호스트 · 프로필 등)은 그대로", () => {
    expect(itemDisplay({ key: "host:dev-01", label: "dev-01" })).toEqual({ key: null, detail: "dev-01" });
  });
});
