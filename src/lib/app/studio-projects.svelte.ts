/**
 * 앨범 저장소 → 등록된 프로젝트. 같은 폴더 판정은 서버(`orchestration_same_dir_index` — 정션 · 대소문자)가 한다.
 * 그리는 중에 불린다 — 찾기는 저장소마다 한 번이고, id 만 쥐어 이름 · 아이콘은 늘 지금 목록의 값이다.
 */
import { invoke } from "$lib/ipc";
import { isRemote, type Project } from "$lib/projects";
import { projects } from "$lib/app/project-list.svelte.js";
import { studioLabelOf } from "$lib/orchestration/model/library";

/** `null` = 등록 안 됨 */
const found = $state<Record<string, string | null>>({});
const asked = new Set<string>();
let listKey = "";

async function look(repo: string, list: readonly Project[]): Promise<void> {
  let index: number | null = null;
  try {
    index = await invoke<number | null>("orchestration_same_dir_index", { path: repo, candidates: list.map((p) => p.path) });
  } catch {
    index = null;
  }
  found[repo] = index === null ? null : (list[index]?.id ?? null);
}

/** 로컬 프로젝트만 — 앨범은 로컬 저장소에서 돈다 */
export function studioProject(repo: string): Project | null {
  const list = projects().filter((p) => !isRemote(p));
  const key = list.map((p) => p.path).join("\n");
  if (key !== listKey) {
    listKey = key;
    asked.clear();
  }
  if (repo && !asked.has(repo)) {
    asked.add(repo);
    void look(repo, list);
  }
  const id = found[repo];
  return id ? (list.find((p) => p.id === id) ?? null) : null;
}

export function studioLabel(repo: string): string {
  return studioLabelOf(studioProject(repo)?.name, repo);
}
