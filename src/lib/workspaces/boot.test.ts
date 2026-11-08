import { expect, it, vi } from "vitest";
import { loadWorkspaceBoot } from "./boot";
import type { WorkspaceFile } from "./schema";
const file: WorkspaceFile = { kind: "aynx.workspaces", version: 2, revision: 1, activeWorkspaceId: "a", workspaces: [{ id: "a", name: "Default", tabs: [], lastActive: {} }] };

it("v2를 바로 열고 이관을 반복하지 않는다", async () => {
  const migrate = vi.fn();
  expect(await loadWorkspaceBoot({ load: async () => ({ state: "v2", file }), migrate })).toEqual({ file });
  expect(migrate).not.toHaveBeenCalled();
});
it.each(["empty", "needsMigration"] as const)("%s이면 migrate ACK 후 다시 읽는다", async (state) => {
  const load = vi.fn().mockResolvedValueOnce({ state }).mockResolvedValueOnce({ state: "v2", file });
  const migrate = vi.fn().mockResolvedValue(file);
  expect(await loadWorkspaceBoot({ load, migrate })).toEqual({ file });
  expect(migrate).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledTimes(2);
});
it("이관 Invalid는 파일 바이트를 유지하고 민감한 경로 대신 파일/인덱스/코드만 올린다", async () => {
  const files = new Map([["workspaces.json", "v1"], ["layouts.json", "broken"], ["projects.json", "v1"]]);
  const before = [...files];
  const migrate = vi.fn(async () => { throw { code: "invalid", problems: [{ file: "layouts.json", index: 3, path: "tree.cwd", code: "invalidField" }] }; });
  expect(await loadWorkspaceBoot({ load: async () => ({ state: "needsMigration" }), migrate })).toEqual({ problems: [{ file: "layouts.json", index: 3, path: "", code: "invalidField" }] });
  expect([...files]).toEqual(before);
});
it("Corrupt 조회는 이관/새 시작을 호출하지 않는다", async () => {
  const migrate = vi.fn();
  const result = await loadWorkspaceBoot({ load: async () => ({ state: "corrupt", problems: [{ file: "workspaces.json", path: "", code: "invalidJson" }] }), migrate });
  expect(result.problems?.[0].code).toBe("invalidJson");
  expect(migrate).not.toHaveBeenCalled();
});
