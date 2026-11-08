import { describe, expect, it } from "vitest";
import { WATCH_RELEASE_GRACE_MS, watchPathsOf, watchSwitchDelay, watchWanted } from "./fs-auto-refresh";
import type { FileTreeRow } from "$lib/file-tree";
import type { SftpEntry } from "$lib/sftp-browser";

function dirRow(path: string, expanded: boolean): FileTreeRow {
  return {
    kind: "entry",
    id: path,
    entry: { path, name: path.split("\\").pop() ?? path, kind: "dir" } as unknown as SftpEntry,
    depth: 0,
    parent: "C:\\r",
    expandable: true,
    expanded,
    error: null,
  };
}

describe("watchPathsOf", () => {
  it("cwd 가 맨 앞, 그 뒤로 펼친 폴더만(겹침 없이)", () => {
    const rows: FileTreeRow[] = [
      dirRow("C:\\r\\a", true),
      dirRow("C:\\r\\b", false),
      { kind: "loading", id: "\0l", depth: 1, parent: "C:\\r\\a" },
      dirRow("C:\\r\\a\\c", true),
      dirRow("C:\\r", true),
    ];
    expect(watchPathsOf("C:\\r", rows, false)).toEqual(["C:\\r", "C:\\r\\a", "C:\\r\\a\\c"]);
  });

  it("합성 루트(내 PC)는 감시하지 않는다", () => {
    expect(watchPathsOf("", [], true)).toEqual([]);
  });
});

describe("watchWanted", () => {
  it("설정 · 보임 · 창 활성이 모두 참일 때만", () => {
    expect(watchWanted(true, true, true)).toBe(true);
    expect(watchWanted(false, true, true)).toBe(false);
    expect(watchWanted(true, false, true)).toBe(false);
    expect(watchWanted(true, true, false)).toBe(false);
  });
});

describe("watchSwitchDelay", () => {
  it("같으면 할 일 없음 · 켜기는 곧바로 · 끄기는 유예 뒤", () => {
    expect(watchSwitchDelay(true, true)).toBeNull();
    expect(watchSwitchDelay(false, false)).toBeNull();
    expect(watchSwitchDelay(false, true)).toBe(0);
    expect(watchSwitchDelay(true, false)).toBe(WATCH_RELEASE_GRACE_MS);
  });
});
