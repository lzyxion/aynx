import { invoke, listen } from "../ipc";
import { parseProjects, type Project } from "$lib/projects";

/** 프로젝트 목록의 창 사본 — 쓰는 것은 Rust `projects.rs` 하나다. 포커스 재로드는 이벤트를 놓친 경우의 그물이다. */

/** Rust `projects::CHANGED_EVENT` 와 같은 글자 */
export const PROJECTS_CHANGED_EVENT = "projects-changed";

let list = $state<Project[]>([]);

export function projects(): readonly Project[] {
  return list;
}

export function projectById(id: string): Project | null {
  return list.find((p) => p.id === id) ?? null;
}

export function putProjectLocal(p: Project): void {
  const i = list.findIndex((x) => x.id === p.id);
  list = i < 0 ? [...list, p] : list.map((x) => (x.id === p.id ? p : x));
}

export function dropProjectLocal(id: string): void {
  list = list.filter((x) => x.id !== id);
}

export async function refreshProjects(): Promise<void> {
  try {
    list = parseProjects(await invoke<unknown>("projects_list"));
  } catch (e) {
    console.warn("[aynx] 프로젝트 목록을 읽지 못했습니다 (무시):", e);
  }
}

export function mountProjects(): () => void {
  void refreshProjects();
  const changed = listen(PROJECTS_CHANGED_EVENT, () => void refreshProjects()).catch(
    () => () => {},
  );
  const onFocus = () => void refreshProjects();
  if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
  return () => {
    void changed.then((un) => un());
    if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
  };
}

export function renameProjectsHost(from: string, to: string): Promise<void> {
  return invoke("project_rename_host", { from, to });
}

export async function forgetProjectsHost(aliases: readonly string[]): Promise<void> {
  for (const alias of aliases) await invoke("projects_forget_host", { alias });
}
