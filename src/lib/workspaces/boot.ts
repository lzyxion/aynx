// 이관 실패에서는 load/migrate 외의 쓰기 명령을 부르지 않는다.
import type { Problem, WorkspaceFile, WorkspaceLoad } from "./schema";

export interface WorkspaceBootIO {
  load: () => Promise<WorkspaceLoad>;
  migrate: () => Promise<unknown>;
}
export type WorkspaceBootResult =
  | { file: WorkspaceFile; problems?: never }
  | { file?: never; problems: Problem[] };

export function migrationProblems(error: unknown): Problem[] {
  if (error && typeof error === "object" && "problems" in error && Array.isArray(error.problems)) {
    return error.problems.map((p: Problem) => ({
      file: p.file.split(/[\\/]/).at(-1) ?? "workspaces.json",
      index: p.index, path: "", code: p.code,
    }));
  }
  return [{ file: "workspaces.json", path: "", code: "loadFailed" }];
}

export async function loadWorkspaceBoot(io: WorkspaceBootIO): Promise<WorkspaceBootResult> {
  try {
    let loaded = await io.load(); // Rust는 이 조회 전에 journal을 회복한다.
    if (loaded.state === "needsMigration" || loaded.state === "empty") {
      await io.migrate();
      loaded = await io.load();
    }
    if (loaded.state === "v2") return { file: loaded.file };
    return { problems: loaded.state === "corrupt" ? migrationProblems(loaded) : migrationProblems(null) };
  } catch (error) {
    return { problems: migrationProblems(error) };
  }
}
